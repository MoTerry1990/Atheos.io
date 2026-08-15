import "server-only";

import type { Modality } from "@/lib/generated/prisma/enums";
import type { PlanTier } from "@/lib/generated/prisma/enums";
import {
  CREDIT_VALUE_MICRO_USD,
  MICRO_USD,
} from "@/services/billing/model-costs";

/**
 * The canonical plan configuration.
 *
 * ## Why a second file next to `catalogue.ts`
 *
 * `catalogue.ts` is the **marketing** description — names, feature bullets,
 * money in Stripe's minor units. It is read by the pricing page and it exists to
 * be read by a customer.
 *
 * This is the **entitlement** description: what a plan may actually do, how many
 * jobs it may run at once, which models it may reach. Those are enforcement
 * inputs, they are consulted on every generation, and they must never be
 * derived from a marketing string. Sprint 25 renamed four plans; if concurrency
 * had been keyed off the display name, that rename would have silently changed
 * what people were allowed to run.
 *
 * `server-only` because the fields below include the provider allowance each
 * plan is budgeted for, which is a margin disclosure.
 *
 * ## The four plans, and the enum values behind them
 *
 * The stored `PlanTier` enum has five values and predates this sprint. It is
 * **not** being changed, because a migration that rewrites stored entitlements
 * is a risk taken for tidiness. The mapping:
 *
 *   STARTER  ->  Free      $0
 *   BASIC    ->  retired   was "Starter" $5 — no longer sold
 *   STUDIO   ->  Creator   $9.99
 *   SCALE    ->  Pro       $34.99
 *   AGENCY   ->  Studio    $89.99   (was "Agency" $199)
 *
 * `AGENCY` now denotes the $89.99 top tier rather than the $199 one. That is
 * only safe because **no subscription row exists on any tier** — Stripe has
 * never been configured, so nothing has ever been sold. It is listed as a
 * manual pre-flight check in `docs/OPERATIONS.md`: confirm `subscriptions` is
 * empty before this reaches production, and if it is not, add a real enum value
 * instead of reusing one.
 *
 * ## Credit allocations are deliberately unfinished
 *
 * `creditsPerMonth` is **null** on every paid plan. Four of the six sellable
 * models have `estimated` or `unknown` costs (`model-costs.ts`), and an
 * allocation derived from an estimate is a promise the backend might not be
 * able to honour. `provisionalCreditsPerMonth` records the arithmetic so the
 * work is not lost, and `status: "launch_disabled"` keeps it off the pricing
 * page until the costs are measured.
 *
 * The Free plan is the exception: 100 credits is what it already grants, it is
 * bounded by being one-time, and its worst case is ~$0.18 of image generation
 * because video is not reachable from it at all.
 */

/**
 * How expensive a model is allowed to be, per plan.
 *
 * A class rather than a list of model ids: a list has to be edited every time a
 * model is added, and the one that gets forgotten is the expensive one.
 *
 *   economical  <= $0.01 worst case   fast image models, the mock
 *   standard    <= $0.15 worst case   quality image models, the fast video model
 *   premium     anything enabled      Motion Pro, GPT Image
 */
export type ModelClass = "economical" | "standard" | "premium";

export const MODEL_CLASS_CEILING_MICRO_USD: Record<ModelClass, number> = {
  economical: 10_000,
  standard: 150_000,
  premium: Number.POSITIVE_INFINITY,
};

export interface PlanConfig {
  tier: PlanTier;
  /** Customer-facing name. The enum value is the identity; this is the label. */
  displayName: string;

  /** Monthly price in US cents. Monthly only — there is no annual billing. */
  monthlyPriceCents: number;

  /**
   * Credits granted per billing period.
   *
   * **Null means not yet decided**, not zero. Nothing may render a number from
   * this field; `provisionalCreditsPerMonth` exists for internal planning and
   * carries no promise.
   */
  creditsPerMonth: number | null;

  /**
   * The arithmetic, recorded: `providerAllowanceUsd / $0.005`.
   *
   * Internal only. It is the number the plan *would* get if today's estimated
   * costs turn out to be right, and it is written down so re-deriving it after
   * measurement is a check rather than a rebuild.
   */
  provisionalCreditsPerMonth: number | null;

  /** Provider spend this plan is budgeted for, in US dollars per month. */
  providerAllowanceUsd: number;

  /** Generations that may be in flight at once. */
  maxConcurrentJobs: number;

  /** Generation starts permitted per hour and per minute. */
  generationsPerHour: number;
  generationsPerMinute: number;

  eligibleModalities: readonly Modality[];
  maxModelClass: ModelClass;

  /**
   * `active`         sellable and enforceable today
   * `launch_disabled` configured, priced, and not offered — credits unverified
   * `retired`        exists only so historical rows resolve to something
   */
  status: "active" | "launch_disabled" | "retired";
}

export const PLAN_CONFIGS: readonly PlanConfig[] = [
  {
    tier: "STARTER",
    displayName: "Free",
    monthlyPriceCents: 0,
    // Not monthly — a **one-time** grant. Sprint 4 changed this; see
    // `services/billing/free-grant.ts` for why the renewal was a liability.
    creditsPerMonth: 100,
    provisionalCreditsPerMonth: 100,
    // $0.50 of retail value, once, per account. Worst case is ~7 flux-dev
    // images at $0.025 = $0.18 of real provider spend.
    providerAllowanceUsd: 0.5,
    // One at a time. The audit rates parallel free generation as Critical, and
    // a concurrency of 1 is what makes the 20-parallel-request attack a queue
    // rather than a bill.
    maxConcurrentJobs: 1,
    generationsPerHour: 10,
    generationsPerMinute: 3,
    // No video. Not a margin decision — a volume one. See `freeTierEligible`.
    eligibleModalities: ["IMAGE", "AUDIO"],
    maxModelClass: "economical",
    status: "active",
  },
  {
    tier: "STUDIO",
    displayName: "Creator",
    monthlyPriceCents: 999,
    creditsPerMonth: null,
    provisionalCreditsPerMonth: 500, // $2.50 / $0.005
    providerAllowanceUsd: 2.5,
    maxConcurrentJobs: 3,
    generationsPerHour: 60,
    generationsPerMinute: 12,
    eligibleModalities: ["IMAGE", "VIDEO", "AUDIO"],
    maxModelClass: "standard",
    status: "launch_disabled",
  },
  {
    tier: "SCALE",
    displayName: "Pro",
    monthlyPriceCents: 3499,
    creditsPerMonth: null,
    provisionalCreditsPerMonth: 1_800, // $9.00 / $0.005
    providerAllowanceUsd: 9,
    maxConcurrentJobs: 5,
    generationsPerHour: 200,
    generationsPerMinute: 20,
    eligibleModalities: ["IMAGE", "VIDEO", "AUDIO"],
    maxModelClass: "premium",
    status: "launch_disabled",
  },
  {
    tier: "AGENCY",
    displayName: "Studio",
    monthlyPriceCents: 8999,
    creditsPerMonth: null,
    provisionalCreditsPerMonth: 4_800, // $24.00 / $0.005
    providerAllowanceUsd: 24,
    // Eight, not unlimited. "No unlimited generation" is a founder constraint
    // and it applies to concurrency as much as to volume — an unbounded top
    // tier is a single customer able to reach the $500 ceiling alone.
    maxConcurrentJobs: 8,
    generationsPerHour: 500,
    generationsPerMinute: 40,
    eligibleModalities: ["IMAGE", "VIDEO", "AUDIO"],
    maxModelClass: "premium",
    status: "launch_disabled",
  },
  {
    tier: "BASIC",
    displayName: "Starter (retired)",
    monthlyPriceCents: 500,
    creditsPerMonth: null,
    provisionalCreditsPerMonth: null,
    providerAllowanceUsd: 0,
    // Retired plans resolve to the Free plan's limits. A row that should not
    // exist must not be the most permissive thing in the table.
    maxConcurrentJobs: 1,
    generationsPerHour: 10,
    generationsPerMinute: 3,
    eligibleModalities: ["IMAGE", "AUDIO"],
    maxModelClass: "economical",
    status: "retired",
  },
];

const BY_TIER = new Map(PLAN_CONFIGS.map((plan) => [plan.tier, plan]));

/**
 * The plan for a tier. Falls back to Free.
 *
 * The fallback is the *least* privileged plan on purpose. An unrecognised tier
 * is a bug, and a bug must not hand somebody the top tier's concurrency.
 */
export function planConfigFor(tier: PlanTier | null | undefined): PlanConfig {
  return (tier && BY_TIER.get(tier)) || BY_TIER.get("STARTER")!;
}

/** Plans that may be shown and sold. */
export function sellablePlans(): readonly PlanConfig[] {
  return PLAN_CONFIGS.filter((plan) => plan.status === "active");
}

/** Whether the tier is the free one. Used by every gate that treats it apart. */
export function isFreeTier(tier: PlanTier | null | undefined): boolean {
  return planConfigFor(tier).tier === "STARTER";
}

/**
 * May this plan reach a model of this worst-case cost and modality?
 *
 * Both conditions, not either: a cheap video model is still video, and the
 * free plan's video exclusion is about volume rather than unit price.
 */
export function planAllowsModel(
  plan: PlanConfig,
  input: { modality: Modality; worstCaseCostMicroUsd: number | null },
): boolean {
  if (!plan.eligibleModalities.includes(input.modality)) return false;

  // Unknown cost cannot be shown to be within any ceiling.
  if (input.worstCaseCostMicroUsd === null) return false;

  return (
    input.worstCaseCostMicroUsd <=
    MODEL_CLASS_CEILING_MICRO_USD[plan.maxModelClass]
  );
}

/**
 * The credits an allowance implies, at the current credit value.
 *
 * Exported so `tests/unit/plan-config.test.ts` can check that every
 * `provisionalCreditsPerMonth` still matches its allowance — the two drift the
 * moment somebody edits one and not the other, and the drift is invisible.
 */
export function creditsForAllowance(allowanceUsd: number): number {
  return Math.round((allowanceUsd * MICRO_USD) / CREDIT_VALUE_MICRO_USD);
}
