import "server-only";

import { emit } from "@/lib/events";
import { checkRateLimit, type LimitPolicy } from "@/lib/rate-limit";
import { activeJobCount } from "@/services/billing/ledger";
import { planConfigFor, type PlanConfig } from "@/services/billing/plan-config";
import { prisma } from "@/lib/prisma";
import type { Modality, PlanTier } from "@/lib/generated/prisma/enums";

/**
 * Plan-aware limits on starting a generation.
 *
 * ## Three different questions, deliberately kept apart
 *
 *   1. **Rate** — how often may this account *start* work? Defends the provider
 *      account against a loop.
 *   2. **Concurrency** — how much may be *in flight*? Defends against the
 *      parallel-burst attack, which a rate limit alone does not stop: twenty
 *      simultaneous requests are one window's worth of requests and twenty
 *      simultaneous provider bills.
 *   3. **Credits** — can they afford it? Answered by the ledger, not here.
 *
 * The audit's § 9 rates parallel free generation as Critical precisely because
 * (1) was the only control that existed. A limit of twelve a minute permits
 * twelve *at once*, and twelve at once on Motion Pro is $3.24 of provider spend
 * from an account that has paid nothing.
 *
 * ## Concurrency is the free tier's real defence
 *
 * Free is capped at one job in flight. That is not a degraded experience for a
 * legitimate free user — they are evaluating the product, one generation at a
 * time — and it converts the entire class of burst attacks into a queue.
 *
 * ## Why the limits are per plan rather than per endpoint
 *
 * The endpoint does not know what it costs; the plan knows what it is worth.
 * A Studio subscriber paying $89.99 and a free account hitting the same route
 * are not the same risk, and one number for both is either too tight for the
 * customer or too loose for the attacker.
 */

export type LimitBlockReason =
  "rate_limited" | "too_many_active_jobs" | "daily_cap_reached";

export interface LimitVerdict {
  allowed: boolean;
  reason?: LimitBlockReason;
  /** Seconds the caller should wait. Feeds `Retry-After`. */
  retryAfterSeconds?: number;
  /** Included so a message can say "3 of 3" without a second query. */
  activeJobs?: number;
  maxConcurrentJobs?: number;
  /** Set only when a daily cap refused the request. */
  dailyUsed?: number;
  dailyCap?: number;
  modality?: Modality;
  plan: PlanConfig;
}

/** Midnight is not the boundary — a rolling 24 hours is. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Jobs of one modality this user started in the last 24 hours.
 *
 * Counted from `generations` rather than a rate-limit bucket, deliberately.
 * The bucket store is best-effort and sweeps expired rows; this number decides
 * whether somebody may spend money, so it is read from the durable record of
 * what they actually started.
 *
 * Failed and refunded generations count. That is the correct direction: a
 * failure still cost a provider call, and not counting them would make failure
 * the cheapest way to exceed the cap.
 */
async function dailyJobCount(
  userId: string,
  modality: Modality,
): Promise<number> {
  return prisma.generation.count({
    where: {
      userId,
      modality,
      createdAt: { gte: new Date(Date.now() - DAY_MS) },
    },
  });
}

/**
 * How long until the oldest job in the window ages out.
 *
 * A real number rather than a guess: the caller renders it as `Retry-After`,
 * and "try again in 6 hours" is actionable where "try again later" is not.
 */
async function secondsUntilDailyWindowOpens(
  userId: string,
  modality: Modality,
): Promise<number> {
  const oldest = await prisma.generation.findFirst({
    where: {
      userId,
      modality,
      createdAt: { gte: new Date(Date.now() - DAY_MS) },
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  if (!oldest) return 60;

  const opensAt = oldest.createdAt.getTime() + DAY_MS;
  return Math.max(60, Math.ceil((opensAt - Date.now()) / 1000));
}

/**
 * A policy derived from the plan, rather than one of the fixed `POLICIES`.
 *
 * The namespace includes the tier so that changing plan does not inherit the
 * old plan's counter — an upgrade should take effect immediately, and it would
 * not if a Free user's exhausted window followed them onto Creator.
 */
function policyFor(plan: PlanConfig, scale: "minute" | "hour"): LimitPolicy {
  return scale === "minute"
    ? {
        name: `gen-min:${plan.tier}`,
        limit: plan.generationsPerMinute,
        windowMs: 60_000,
        failMode: "closed",
      }
    : {
        name: `gen-hr:${plan.tier}`,
        limit: plan.generationsPerHour,
        windowMs: 60 * 60_000,
        failMode: "closed",
      };
}

/**
 * May this user start another generation right now?
 *
 * Checked **before** credits are reserved. Reserving first and then discovering
 * the account is at its concurrency cap means releasing credits that never
 * needed to move, and every avoidable ledger round trip is a chance for the
 * release to be the write that fails.
 */
export async function checkGenerationLimits(input: {
  userId: string;
  tier: PlanTier | null | undefined;
  /**
   * What is being generated. Needed for the per-modality daily cap.
   *
   * Optional so existing callers keep compiling, but a caller that omits it
   * skips the cap — `services/generation.ts` passes it, and
   * `tests/unit/generation-limits.test.ts` asserts the cap fires when it is
   * supplied.
   */
  modality?: Modality;
}): Promise<LimitVerdict> {
  const plan = planConfigFor(input.tier);

  // Minute first: it is the tighter window, so it rejects a loop sooner and
  // costs one round trip instead of two when it does.
  for (const scale of ["minute", "hour"] as const) {
    const result = await checkRateLimit(policyFor(plan, scale), input.userId);

    if (!result.ok) {
      return {
        allowed: false,
        reason: "rate_limited",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((result.resetAt - Date.now()) / 1000),
        ),
        plan,
      };
    }
  }

  /**
   * The daily cap, before the concurrency check.
   *
   * Ordered first because it is the cheaper refusal to be given: somebody who
   * has used their ten images for the day should be told that, not told to wait
   * for a slot that will never help.
   */
  const dailyCap = input.modality
    ? plan.dailyJobCaps?.[input.modality]
    : undefined;

  if (dailyCap !== undefined && input.modality) {
    const usedToday = await dailyJobCount(input.userId, input.modality);

    if (usedToday >= dailyCap) {
      emit("limit.daily_cap_blocked", {
        userId: input.userId,
        tier: plan.tier,
        modality: input.modality,
        usedToday,
        cap: dailyCap,
      });

      return {
        allowed: false,
        reason: "daily_cap_reached",
        // Until the oldest job in the window ages out. Computed rather than
        // guessed, so the client can show a real time.
        retryAfterSeconds: await secondsUntilDailyWindowOpens(
          input.userId,
          input.modality,
        ),
        dailyUsed: usedToday,
        dailyCap,
        modality: input.modality,
        plan,
      };
    }
  }

  const active = await activeJobCount(input.userId);

  if (active >= plan.maxConcurrentJobs) {
    emit("limit.concurrency_blocked", {
      userId: input.userId,
      tier: plan.tier,
      active,
      max: plan.maxConcurrentJobs,
    });

    return {
      allowed: false,
      reason: "too_many_active_jobs",
      // Not a rate window, so there is nothing precise to say. Ten seconds is
      // roughly how long a fast image takes, which makes it a useful guess
      // rather than a made-up one.
      retryAfterSeconds: 10,
      activeJobs: active,
      maxConcurrentJobs: plan.maxConcurrentJobs,
      plan,
    };
  }

  return { allowed: true, activeJobs: active, plan };
}

/**
 * What the customer reads.
 *
 * Says what to do, not what the internal limit is. "You have 3 of 3 running" is
 * actionable; "you exceeded the per-tier concurrency policy" is not.
 */
export function limitMessage(verdict: LimitVerdict): string {
  if (verdict.reason === "daily_cap_reached") {
    const noun = verdict.modality === "VIDEO" ? "videos" : "images";
    const hours = Math.ceil((verdict.retryAfterSeconds ?? 3600) / 3600);

    // Names the limit and when it lifts. "You have hit a limit" tells somebody
    // nothing they can act on, and an upgrade prompt with no number reads as a
    // sales pitch rather than an explanation.
    return `Your plan includes ${verdict.dailyCap} ${noun} a day and you have used ${verdict.dailyUsed}. This resets in about ${hours} ${hours === 1 ? "hour" : "hours"}, or you can upgrade for more.`;
  }

  if (verdict.reason === "too_many_active_jobs") {
    return `You already have ${verdict.activeJobs} of ${verdict.maxConcurrentJobs} generations running. This one will be ready to start as soon as one finishes.`;
  }

  const seconds = verdict.retryAfterSeconds ?? 60;
  return seconds > 90
    ? `You have reached this plan's hourly limit. Try again in ${Math.ceil(seconds / 60)} minutes.`
    : `That is a lot of generations at once. Try again in ${seconds} seconds.`;
}
