import "server-only";

import { env } from "@/lib/env";
import { emit } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { MICRO_USD, costEntry } from "@/services/billing/model-costs";

/**
 * The spending circuit breaker.
 *
 * ## What it is defending
 *
 * A self-funded founder with a hard ceiling of **$500 a month** and a preferred
 * range of $175–$300. Before this, nothing in the system knew what it had
 * spent. Every control was a per-request check — enough credits, under the rate
 * limit — and none of them could see the total. A hundred users each behaving
 * perfectly within their allowance is still a bill nobody agreed to.
 *
 * This is the control that looks at the total.
 *
 * ## The ladder, not a switch
 *
 * A single ceiling has one behaviour: fine, fine, fine, off. That is the worst
 * possible shape, because the product dies at the exact moment it is working.
 * So the levers come in order of what they cost the business:
 *
 *   $100  review                 nothing changes; a marker to look at usage
 *   $175  alert                  nothing changes; the preferred range's top
 *   $225  free generations stop  free usage earns nothing, so it goes first
 *   $275  expensive models off   video for everyone drops to the cheap tier
 *   $350  nonessential paused    enhancement, upscales, background removal
 *   $425  paid + economical only  the product still works, for customers
 *   $475  emergency shutdown     everything stops
 *   $500  absolute ceiling       must never be reached; $475 exists so it is not
 *
 * Paying customers keep working until $425. That ordering is deliberate: a
 * subscriber whose generations stop has been sold something we did not deliver,
 * which costs a refund and a reputation, while a free user who is throttled has
 * lost nothing they paid for.
 *
 * ## Where the spend number comes from, honestly
 *
 * There is no provider spend API wired up. Pretending otherwise would be worse
 * than having no breaker, because a breaker reading a fabricated number gives
 * confidence without protection.
 *
 * What exists instead:
 *
 *   1. **Our own estimate**, accumulated in `budget_usage.spentMicroUsd` as
 *      each generation is captured, priced from `model-costs.ts`.
 *   2. **A manual baseline**, `ATHEOS_MANUAL_SPEND_USD`, which the operator
 *      sets from the provider's dashboard during reconciliation.
 *
 * The breaker reads the **sum**. So an underestimate is always correctable
 * upward without a deploy, and the manual figure can absorb everything the
 * estimate misses — the four unverified model costs, failed runs that were
 * still billed, storage, egress.
 *
 * Synchronising directly against Replicate's billing API is Sprint 5 work and
 * is named as such in the audit rather than implied to exist.
 *
 * ## Failing safe means failing *loud*, not failing open
 *
 * If the spend row cannot be read, the level is `emergency`. A breaker that
 * cannot see its input has to assume the worst — the alternative is a database
 * hiccup silently disarming the only thing standing between a runaway loop and
 * a $500 bill.
 */

/** The ladder, in micro-USD, ascending. */
export const THRESHOLDS_USD = {
  review: 100,
  alert: 175,
  stopFree: 225,
  restrictExpensive: 275,
  pauseNonessential: 350,
  economicalOnly: 425,
  emergency: 475,
  ceiling: 500,
} as const;

export type SpendLevel =
  | "normal"
  | "review"
  | "alert"
  | "free_stopped"
  | "expensive_restricted"
  | "nonessential_paused"
  | "economical_only"
  | "emergency";

/**
 * Reason codes for a blocked request.
 *
 * Structured so the interface can pick its own wording per locale, and so a log
 * search for "why did generation stop on the 14th" has something to match. The
 * customer-facing sentence lives in `blockMessage()` and deliberately never
 * names a dollar figure — a stranger being told "we have spent $431 this month"
 * is an operational disclosure they did not ask for and cannot act on.
 */
export type BlockReason =
  | "kill_switch"
  | "spend_emergency"
  | "spend_free_stopped"
  | "spend_expensive_restricted"
  | "spend_nonessential_paused"
  | "spend_economical_only"
  | "provider_disabled"
  | "model_disabled"
  | "model_unpriced"
  | "free_plan_ineligible";

export interface SpendStatus {
  level: SpendLevel;
  /** Estimate + manual baseline, in micro-USD. */
  totalMicroUsd: number;
  /** Our own accumulated estimate alone. */
  estimatedMicroUsd: number;
  /** The operator-entered figure alone. */
  manualMicroUsd: number;
  period: string;
  /** True when the number could not be read and the level was forced. */
  degraded: boolean;
}

/** `2026-08`, UTC. Matches `grantPeriod()` so the two never disagree. */
export function spendPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function levelFor(totalMicroUsd: number): SpendLevel {
  const usd = totalMicroUsd / MICRO_USD;

  if (usd >= THRESHOLDS_USD.emergency) return "emergency";
  if (usd >= THRESHOLDS_USD.economicalOnly) return "economical_only";
  if (usd >= THRESHOLDS_USD.pauseNonessential) return "nonessential_paused";
  if (usd >= THRESHOLDS_USD.restrictExpensive) return "expensive_restricted";
  if (usd >= THRESHOLDS_USD.stopFree) return "free_stopped";
  if (usd >= THRESHOLDS_USD.alert) return "alert";
  if (usd >= THRESHOLDS_USD.review) return "review";
  return "normal";
}

/** Exported for the tests; the ladder is the part most worth pinning. */
export const __levelFor = levelFor;

/**
 * Read this month's spend and derive the level.
 *
 * A missing row is **not** degraded — it is a month in which nothing has been
 * spent yet, which is the ordinary state on the first of the month. Only a
 * failed read is degraded.
 */
export async function spendStatus(
  now: Date = new Date(),
): Promise<SpendStatus> {
  const period = spendPeriod(now);
  const manualMicroUsd = Math.round(
    (env.ATHEOS_MANUAL_SPEND_USD ?? 0) * MICRO_USD,
  );

  try {
    const row = await prisma.budgetUsage.findUnique({ where: { period } });

    const estimatedMicroUsd = Number(
      (row?.spentMicroUsd ?? 0n) + (row?.manualBaselineMicroUsd ?? 0n),
    );

    const totalMicroUsd = estimatedMicroUsd + manualMicroUsd;

    return {
      level: levelFor(totalMicroUsd),
      totalMicroUsd,
      estimatedMicroUsd,
      manualMicroUsd,
      period,
      degraded: false,
    };
  } catch (error) {
    emit("spend.blocked", {
      period,
      cause: "budget_usage_unreadable",
      error: error instanceof Error ? error.name : "unknown",
    });

    return {
      level: "emergency",
      totalMicroUsd: Number.NaN,
      estimatedMicroUsd: Number.NaN,
      manualMicroUsd,
      period,
      degraded: true,
    };
  }
}

/**
 * Models that are expensive enough to be restricted at $275.
 *
 * Defined by cost, not by name. "Expensive" as a hard-coded list of model ids
 * goes stale the moment a model is added, and the one that gets forgotten is
 * the one that costs the most.
 */
const EXPENSIVE_COST_MICRO_USD = 100_000; // $0.10 per output, worst case

/**
 * Operations that stop at $350.
 *
 * Chosen because each has a cheaper substitute or is a convenience rather than
 * the product: enhancement is optional, upscaling improves something that
 * already exists, background removal is an edit. Generating an image or a
 * video is what somebody subscribed for.
 */
const NONESSENTIAL_MODELS = new Set([
  "replicate/real-esrgan",
  "replicate/remove-bg",
]);

export interface GateInput {
  modelId: string;
  provider: string;
  /** Whether the requester is on the Free plan. */
  isFree: boolean;
  /** Worst-case provider cost for this specific request, in micro-USD. */
  requestCostMicroUsd: number | null;
}

export interface GateVerdict {
  allowed: boolean;
  reason?: BlockReason;
  level: SpendLevel;
}

/**
 * May this specific request run?
 *
 * Ordered cheapest-check-first, and manual switches before spend-derived ones —
 * an operator who has armed the kill switch wants it to win regardless of what
 * the spend number says.
 */
export async function gateGeneration(
  input: GateInput,
  now: Date = new Date(),
): Promise<GateVerdict> {
  // ---- Manual switches. Environment only; no request can reach them. -----
  if (env.ATHEOS_KILL_SWITCH === "1") {
    emit("spend.emergency_stop", { modelId: input.modelId, source: "manual" });
    return { allowed: false, reason: "kill_switch", level: "emergency" };
  }

  if (disabledSet(env.ATHEOS_DISABLED_PROVIDERS).has(input.provider)) {
    emit("model.disabled", { provider: input.provider, source: "manual" });
    return { allowed: false, reason: "provider_disabled", level: "normal" };
  }

  if (disabledSet(env.ATHEOS_DISABLED_MODELS).has(input.modelId)) {
    emit("model.disabled", { modelId: input.modelId, source: "manual" });
    return { allowed: false, reason: "model_disabled", level: "normal" };
  }

  // ---- Catalogue state. A model with no safe price never runs. -----------
  const entry = costEntry(input.modelId);

  if (!entry || !entry.enabled) {
    emit("model.disabled", { modelId: input.modelId, source: "catalogue" });
    return {
      allowed: false,
      reason: entry ? "model_disabled" : "model_unpriced",
      level: "normal",
    };
  }

  if (input.isFree && !entry.freeTierEligible) {
    emit("plan.ineligible", { modelId: input.modelId, plan: "free" });
    return { allowed: false, reason: "free_plan_ineligible", level: "normal" };
  }

  if (
    env.ATHEOS_FREE_GENERATION_DISABLED === "1" &&
    input.isFree &&
    // The mock costs nothing, so stopping it protects no money and only
    // prevents a free user from seeing that the product works at all.
    entry.provider !== "mock"
  ) {
    emit("spend.blocked", { plan: "free", source: "manual" });
    return { allowed: false, reason: "spend_free_stopped", level: "normal" };
  }

  // ---- Spend-derived levels ---------------------------------------------
  const status = await spendStatus(now);
  const { level } = status;

  const expensive =
    (input.requestCostMicroUsd ?? 0) >= EXPENSIVE_COST_MICRO_USD ||
    entry.modality === "VIDEO";

  const paidOnly = entry.provider !== "mock";

  if (level === "emergency") {
    emit("spend.emergency_stop", {
      modelId: input.modelId,
      period: status.period,
      degraded: status.degraded,
    });
    return { allowed: false, reason: "spend_emergency", level };
  }

  if (level === "economical_only" && paidOnly && (input.isFree || expensive)) {
    emit("spend.blocked", { modelId: input.modelId, level });
    return { allowed: false, reason: "spend_economical_only", level };
  }

  if (
    level === "nonessential_paused" &&
    NONESSENTIAL_MODELS.has(entry.modelId)
  ) {
    emit("spend.blocked", { modelId: input.modelId, level });
    return { allowed: false, reason: "spend_nonessential_paused", level };
  }

  if (level === "expensive_restricted" && expensive && paidOnly) {
    emit("spend.blocked", { modelId: input.modelId, level });
    return { allowed: false, reason: "spend_expensive_restricted", level };
  }

  if (
    (level === "free_stopped" ||
      level === "expensive_restricted" ||
      level === "nonessential_paused") &&
    input.isFree &&
    paidOnly
  ) {
    emit("spend.blocked", { plan: "free", level });
    return { allowed: false, reason: "spend_free_stopped", level };
  }

  if (level === "review" || level === "alert") {
    // Advisory only. Recorded so the crossing is visible in the log, without
    // changing what the user experiences.
    emit("spend.threshold", { level, period: status.period });
  }

  return { allowed: true, level };
}

function disabledSet(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

/**
 * What the customer is told.
 *
 * No dollar amounts, no thresholds, no provider names. Every message is true,
 * and none of them discloses the financial position of the business to whoever
 * happened to click generate.
 */
export function blockMessage(reason: BlockReason): string {
  switch (reason) {
    case "kill_switch":
    case "spend_emergency":
      return "Generation is paused right now. Nothing was charged — please try again shortly.";
    case "spend_free_stopped":
    case "free_plan_ineligible":
      return "This model is not available on the Free plan. Upgrading unlocks it.";
    case "spend_expensive_restricted":
    case "spend_economical_only":
      return "This model is temporarily unavailable. A faster model is ready now, and nothing was charged.";
    case "spend_nonessential_paused":
      return "This tool is temporarily paused. Nothing was charged.";
    case "provider_disabled":
    case "model_disabled":
    case "model_unpriced":
      return "That model is unavailable at the moment. Nothing was charged.";
  }
}

/**
 * Add a captured generation's cost to the month's running total.
 *
 * Best-effort by design: a failure here must not fail a generation the user has
 * already paid for and the provider has already run. The consequence of missing
 * one increment is that the estimate reads low, and the manual baseline is the
 * mechanism that corrects for exactly that.
 *
 * `null` cost is skipped rather than treated as zero — the same rule the margin
 * report follows. An unknown cost is not evidence of a cheap one.
 */
export async function recordSpend(input: {
  costMicroUsd: number | null;
  isFree: boolean;
  now?: Date;
}): Promise<void> {
  if (input.costMicroUsd === null || input.costMicroUsd <= 0) return;

  const period = spendPeriod(input.now ?? new Date());
  const amount = BigInt(Math.round(input.costMicroUsd));

  try {
    await prisma.budgetUsage.upsert({
      where: { period },
      create: {
        period,
        spentMicroUsd: amount,
        freeSpentMicroUsd: input.isFree ? amount : 0n,
      },
      update: {
        spentMicroUsd: { increment: amount },
        ...(input.isFree ? { freeSpentMicroUsd: { increment: amount } } : {}),
      },
    });
  } catch (error) {
    emit("spend.blocked", {
      period,
      cause: "spend_record_failed",
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
