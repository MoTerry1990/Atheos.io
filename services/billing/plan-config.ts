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
 * ## The four plans
 *
 * `PlanTier` has exactly four values and each one is the plan's name:
 *
 *   FREE     $0
 *   CREATOR  $9.99
 *   PRO      $34.99
 *   STUDIO   $89.99
 *
 * Sprint 4 left the old five-value enum in place and mapped it — `AGENCY` for
 * the plan called Studio, `STUDIO` for the plan called Creator — on the
 * reasoning that a stored entitlement must not change meaning when marketing
 * renames a plan. That reasoning is sound and it did not apply here: no
 * subscription row has ever existed, because Stripe has never been configured.
 * What the mapping actually bought was a codebase where the top tier's
 * identifier was the name of a plan that had been deleted.
 *
 * Sprint 4.1 rotated the values to match, once, while it was free. See
 * `prisma/schema.prisma` for why the migration rebuilds the type instead of
 * renaming values in place, and `docs/OPERATIONS.md` § 6 for the pre-flight
 * check that `subscriptions` is still empty. **After that window closes, add a
 * value; never rotate one.**
 *
 * ## Credit allocations are deliberately unfinished
 *
 * `creditsPerMonth` was **null** on every paid plan until Sprint 6A proved the
 * margin arithmetic and promoted the provisional figures unchanged. See
 * `services/billing/catalogue.ts` for the derivation. Four of the six sellable
 * models have `estimated` or `unknown` costs (`model-costs.ts`), and an
 * allocation derived from an estimate is a promise the backend might not be
 * able to honour. `provisionalCreditsPerMonth` records the arithmetic so the
 * work is not lost, and `status: "launch_disabled"` keeps it off the pricing
 * page until the costs are measured.
 *
 * The Free plan is the exception: 300 credits, bounded by being one-time, and
 * its worst case is ~$0.23 of image generation because video is not reachable
 * from it at all and the `economical` class ceiling caps the rest. The grant is
 * also gated on a verified, non-disposable address and recorded against an
 * address hash that survives account deletion — see
 * `services/users/signup-grant.ts`.
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

  /**
   * Jobs per rolling day, per modality. Absent means uncapped.
   *
   * Distinct from `generationsPerHour`, which is a burst control shared across
   * every modality. This is a *volume* control and it is per-modality because
   * the modalities cost wildly different amounts: ten draft images is about
   * $0.03, ten clips is about $1.00.
   *
   * Enforced server-side at reservation, inside the same check that refuses an
   * over-concurrency request — see `services/limits/generation-limits.ts`. A
   * cap enforced in the client is a cap enforced for honest users only.
   */
  dailyJobCaps?: Partial<Record<Modality, number>>;
  maxModelClass: ModelClass;

  /**
   * `active`          sellable and enforceable today
   * `launch_disabled` configured, priced, and not offered — credits unverified
   *
   * No `retired`. Sprint 4.1 deleted the one retired tier from the enum, so
   * there is nothing left for a retired config to resolve.
   */
  status: "active" | "launch_disabled";
}

export const PLAN_CONFIGS: readonly PlanConfig[] = [
  {
    tier: "FREE",
    displayName: "Free",
    monthlyPriceCents: 0,
    // Not monthly — a **one-time** grant. Sprint 4 changed this; see
    // `services/billing/free-grant.ts` for why the renewal was a liability.
    creditsPerMonth: 300,
    provisionalCreditsPerMonth: 300,
    /**
     * Worst-case provider spend, once, per account: 300 x $0.002 = $0.60.
     *
     * That figure uses the catalogue-wide worst case. The *reachable* worst
     * case is far lower, because Free is capped at the `economical` class: 300
     * credits buys 75 draft images at $0.003, about **$0.23**. The larger
     * number is kept because it is the one that holds if the class ceiling ever
     * moves.
     */
    providerAllowanceUsd: 0.6,
    // One at a time. The audit rates parallel free generation as Critical, and
    // a concurrency of 1 is what makes the 20-parallel-request attack a queue
    // rather than a bill.
    maxConcurrentJobs: 1,
    generationsPerHour: 10,
    generationsPerMinute: 3,
    // No video. Not a margin decision — a volume one. See `freeTierEligible`.
    eligibleModalities: ["IMAGE", "AUDIO"],
    /**
     * Ten images and two clips a day.
     *
     * The video cap is **defence in depth, not the active control**: `VIDEO` is
     * absent from `eligibleModalities`, so a free account is refused a clip
     * before the cap is ever consulted. It is declared anyway so that enabling
     * video on Free is a one-line change with a limit already attached, rather
     * than a one-line change that quietly uncaps it.
     *
     * Ten images at the economical ceiling is ~$0.10 of provider spend per day,
     * against a 300-credit grant that is exhausted after 75 of them.
     */
    dailyJobCaps: { IMAGE: 10, VIDEO: 2 },
    maxModelClass: "economical",
    status: "active",
  },
  {
    tier: "CREATOR",
    displayName: "Creator",
    monthlyPriceCents: 999,
    /**
     * 1,900, not the 2,000 that was proposed.
     *
     * At 100% burn on the thinnest model in the catalogue (`gpt-image-1`, which
     * sits exactly on the 2.5x floor at $0.002 per credit), 2,000 credits gives
     * a 55.2% margin against net revenue — nine credits above the 55% floor.
     * A single international card at 3.9% takes it to 54.7%, and a 6% refund
     * rate does the same. The ceiling under an international card is 1,987,
     * which is *below* the proposal.
     *
     * 1,900 gives 57.5%, and 55.4% under the same shock. Still 3.8x today's
     * 500. `docs/UNIT_ECONOMICS.md` § 4 carries the full sensitivity table.
     */
    creditsPerMonth: 1_900,
    provisionalCreditsPerMonth: 1_900,
    /**
     * Worst-case **provider spend**, not retail value: 1,900 x $0.002.
     *
     * The old figures set this to `credits x $0.005`, the retail rate — which
     * made the budget 2.5x larger than any customer could actually cost us and
     * turned the field into a second, looser copy of the allowance. It is the
     * real cost basis now, which is what the name says and what
     * `tests/unit/spending-controls.test.ts` compares against.
     */
    providerAllowanceUsd: 3.8,
    maxConcurrentJobs: 3,
    generationsPerHour: 60,
    generationsPerMinute: 12,
    eligibleModalities: ["IMAGE", "VIDEO", "AUDIO"],
    maxModelClass: "standard",
    status: "launch_disabled",
  },
  {
    tier: "PRO",
    displayName: "Pro",
    monthlyPriceCents: 3499,
    // 56.2% at full burn, 55.6% under an international card. Adopted as
    // proposed — Pro has 198 credits of slack against the 55% floor.
    creditsPerMonth: 7_000,
    provisionalCreditsPerMonth: 7_000,
    // 7,000 x $0.002 worst case.
    providerAllowanceUsd: 14,
    maxConcurrentJobs: 5,
    generationsPerHour: 200,
    generationsPerMinute: 20,
    eligibleModalities: ["IMAGE", "VIDEO", "AUDIO"],
    maxModelClass: "premium",
    status: "launch_disabled",
  },
  {
    tier: "STUDIO",
    displayName: "Studio",
    monthlyPriceCents: 8999,
    // 56.5% at full burn, 55.8% under an international card. Adopted as
    // proposed — 613 credits of slack.
    creditsPerMonth: 18_000,
    provisionalCreditsPerMonth: 18_000,
    // 18,000 x $0.002 worst case.
    providerAllowanceUsd: 36,
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
];

const BY_TIER = new Map(PLAN_CONFIGS.map((plan) => [plan.tier, plan]));

/**
 * The plan for a tier. Falls back to Free.
 *
 * The fallback is the *least* privileged plan on purpose. An unrecognised tier
 * is a bug, and a bug must not hand somebody the top tier's concurrency.
 */
export function planConfigFor(tier: PlanTier | null | undefined): PlanConfig {
  return (tier && BY_TIER.get(tier)) || BY_TIER.get("FREE")!;
}

/** Plans that may be shown and sold. */
export function sellablePlans(): readonly PlanConfig[] {
  return PLAN_CONFIGS.filter((plan) => plan.status === "active");
}

/** Whether the tier is the free one. Used by every gate that treats it apart. */
export function isFreeTier(tier: PlanTier | null | undefined): boolean {
  return planConfigFor(tier).tier === "FREE";
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
  return Math.round(
    (allowanceUsd * MICRO_USD) / WORST_CASE_COST_PER_CREDIT_MICRO_USD,
  );
}

/**
 * What one credit can cost Atheos, at worst: **$0.002**.
 *
 * Not the retail rate. A credit *retails* at $0.005, but every enabled model
 * clears at least a 2.5x margin floor, so the most a credit can ever cost in
 * provider spend is `$0.005 / 2.5`. `openai/gpt-image-1` sits exactly on that
 * floor, so this is a real model's number rather than a theoretical bound.
 *
 * `creditsForAllowance` divided by the *retail* rate until the competitive
 * pricing sprint, which made every plan's budget 2.5x smaller than the plan
 * could actually spend — conservative, but it is why Atheos was shipping a
 * quarter of the credits a competitor gives away at the same price.
 */
export const WORST_CASE_COST_PER_CREDIT_MICRO_USD =
  CREDIT_VALUE_MICRO_USD / 2.5;
