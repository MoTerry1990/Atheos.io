import "server-only";

import { emit } from "@/lib/events";
import { checkRateLimit, type LimitPolicy } from "@/lib/rate-limit";
import { activeJobCount } from "@/services/billing/ledger";
import { planConfigFor, type PlanConfig } from "@/services/billing/plan-config";
import type { PlanTier } from "@/lib/generated/prisma/enums";

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

export type LimitBlockReason = "rate_limited" | "too_many_active_jobs";

export interface LimitVerdict {
  allowed: boolean;
  reason?: LimitBlockReason;
  /** Seconds the caller should wait. Feeds `Retry-After`. */
  retryAfterSeconds?: number;
  /** Included so a message can say "3 of 3" without a second query. */
  activeJobs?: number;
  maxConcurrentJobs?: number;
  plan: PlanConfig;
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
  if (verdict.reason === "too_many_active_jobs") {
    return `You already have ${verdict.activeJobs} of ${verdict.maxConcurrentJobs} generations running. This one will be ready to start as soon as one finishes.`;
  }

  const seconds = verdict.retryAfterSeconds ?? 60;
  return seconds > 90
    ? `You have reached this plan's hourly limit. Try again in ${Math.ceil(seconds / 60)} minutes.`
    : `That is a lot of generations at once. Try again in ${seconds} seconds.`;
}
