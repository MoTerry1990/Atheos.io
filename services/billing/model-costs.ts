import "server-only";

import type { Modality } from "@/lib/generated/prisma/enums";
import type { ProviderId } from "@/services/ai/types";

/**
 * What every model costs **us**, what we charge for it, and whether that gap is
 * wide enough to survive.
 *
 * ## Why this file exists
 *
 * `REVENUE_READINESS_AUDIT.md` § 8 found that Motion Pro cost more to run than
 * it earned — a subscription that loses money faster the more the customer
 * enjoys it. The cause was structural rather than arithmetic: credit prices
 * lived in the provider adapters, provider costs lived in `services/ai/cost.ts`,
 * and nothing anywhere compared the two. A price could drift below cost and no
 * test, type or review step would notice.
 *
 * This module is that comparison, made mandatory. Every enabled model declares
 * both numbers and the margin it must clear, and `tests/unit/model-costs.test.ts`
 * fails the build if any of them stops clearing it.
 *
 * ## `server-only`, and why that is not decoration
 *
 * These are supplier costs. Shipping them to the browser tells every customer
 * and every competitor exactly what Atheos pays per clip and exactly how much
 * margin is in each plan. The import on line 1 makes that a build error rather
 * than a code-review habit.
 *
 * ## The credit is the unit of account, and it needed a value
 *
 * Credits are a product abstraction — they exist so a customer never reasons
 * about eleven vendors' price lists. But "is this price safe?" cannot be
 * answered in credits, only in money, so a credit needs an exchange rate.
 *
 * `CREDIT_VALUE_MICRO_USD` is that rate, and it is *chosen*, not measured. The
 * derivation is written out below so a future change is an argument about the
 * assumption rather than a silent edit to a magic number.
 */

/** One US dollar, in micro-USD. Re-exported so callers need one import. */
export const MICRO_USD = 1_000_000;

/**
 * What one credit is worth in real money: **$0.005**.
 *
 * ## Where the number comes from
 *
 * Not from what credits cost to produce — from what a subscription can afford
 * to give away. The audit's § 8 target is a provider allowance of **≤ $2.50 per
 * month on the $9.99 Creator plan**, which is a 73% gross margin after Stripe's
 * 2.9% + $0.30.
 *
 * The rate then falls out of the *most expensive* thing a plan can reach, not
 * the cheapest. Motion Pro at 180 credits must cover $0.27 of provider spend at
 * a 3× margin:
 *
 *   180 credits x rate  >=  3 x $0.27      =>  rate >= $0.0045
 *
 * Rounded up to $0.005 for a round number and a little headroom. The audit's
 * own table used $0.0011; that figure came from dividing an allowance by a
 * guessed credit count, which is the circular direction. This runs it the other
 * way — from the worst unit cost outward — which is the direction that cannot
 * produce a negative margin.
 *
 * ## What it deliberately does *not* change
 *
 * The existing credit prices, and therefore every existing balance. Picking the
 * rate to fit the catalogue rather than rescaling the catalogue to fit a round
 * rate means the 100 credits sitting in an account today buy exactly what they
 * bought yesterday. A rescale would have needed a balance backfill, and a
 * backfill of live money is a risk taken for cosmetics.
 *
 * Two models did have to move — see `flux-dev` and `gpt-image-1` below.
 */
export const CREDIT_VALUE_MICRO_USD = 5_000;

/**
 * How confident we are in a cost figure. Drives what the model is allowed to do.
 *
 *   `verified`   reconciled against the provider's own invoice or a metered run
 *   `estimated`  derived from published list prices or observed run time
 *   `unknown`    no figure at all
 *
 * There is no fourth value meaning "probably fine". A cost we have not
 * established is `unknown`, and an unknown cost cannot be sold — rule 1 of the
 * sprint brief and the only rule here that has no exceptions.
 */
export type CostVerification = "verified" | "estimated" | "unknown";

/**
 * How the provider charges.
 *
 * `per_second` models are the dangerous ones: their cost scales with a number
 * the *customer* picks, so a safe price has to be checked against the longest
 * duration the model offers rather than the default one.
 */
export type BillingUnit = "per_output" | "per_second" | "free";

export interface ModelCostEntry {
  /** Catalogue model id — the join key to `services/ai/registry.ts`. */
  modelId: string;
  provider: ProviderId | "mock";
  modality: Modality;

  /**
   * Fixed cost per output, in micro-USD. Null when the cost is unknown.
   *
   * Null and zero are different claims: zero says "the vendor charges nothing",
   * null says "we have not found out". Conflating them is how a loss-making
   * model shows up as the most profitable row in a margin report.
   */
  perOutputMicroUsd: number | null;

  /** Additional cost per second of output, for duration-priced models. */
  perSecondMicroUsd?: number;

  billingUnit: BillingUnit;

  /**
   * The assumptions a cost figure depends on. Recorded because a cost is only
   * meaningful alongside them — "$0.27" means nothing without "for 5 seconds".
   */
  assumptions?: {
    /** Longest duration the catalogue offers. The worst case is priced on it. */
    maxDurationSeconds?: number;
    resolution?: string;
    note?: string;
  };

  /** What the customer pays, per output at the model's *base* duration. */
  creditCost: number;

  /**
   * Whether the model may run at all.
   *
   * Disabled models stay in the catalogue rather than being deleted, so the
   * reason they are off is visible next to the cost that caused it.
   */
  enabled: boolean;

  /**
   * Whether a Free-plan account may run it.
   *
   * Every video model is `false` regardless of margin. Margin protects the
   * *unit*; it does nothing about volume, and the free plan's whole exposure is
   * volume by people who have paid nothing. § 9 of the audit rates parallel
   * free video generation as Critical.
   */
  freeTierEligible: boolean;

  /**
   * Revenue must be at least this multiple of worst-case cost.
   *
   * 2.5x is the audit's stated exit criterion — a 60% gross margin. Video sits
   * at 3.0x because its cost is measured from a single invoice and scales with
   * a customer-chosen duration, so it has the most room to be wrong.
   */
  minimumMarginMultiple: number;

  verification: CostVerification;

  /** When the figure was last checked, and against what. */
  checked: string;
}

/**
 * The catalogue, financially.
 *
 * Ordered by modality. Every model the registry can resolve must appear here —
 * `tests/unit/model-costs.test.ts` asserts the two lists agree, so adding a
 * model without a cost entry fails the build rather than shipping an unpriced
 * generation.
 */
export const MODEL_COSTS: readonly ModelCostEntry[] = [
  // ------------------------------------------------------------------------
  // Image
  // ------------------------------------------------------------------------
  {
    modelId: "replicate/flux-schnell",
    provider: "replicate",
    modality: "IMAGE",
    perOutputMicroUsd: 3_000,
    billingUnit: "per_output",
    assumptions: { resolution: "1024x1024" },
    creditCost: 4,
    enabled: true,
    freeTierEligible: true,
    minimumMarginMultiple: 2.5,
    verification: "estimated",
    checked: "2026-08 (Replicate published list price)",
  },
  {
    modelId: "replicate/flux-dev",
    provider: "replicate",
    modality: "IMAGE",
    perOutputMicroUsd: 25_000,
    billingUnit: "per_output",
    assumptions: { resolution: "1024x1024" },
    // Was 12. At 12 credits the margin was 2.4x — under the 2.5x floor, which
    // is the smaller half of B5: not a loss, but thinner than the plan
    // allowances were built on. 13 restores it with nothing to spare, which is
    // the honest number rather than a comfortable one.
    creditCost: 13,
    enabled: true,
    freeTierEligible: true,
    minimumMarginMultiple: 2.5,
    verification: "estimated",
    checked: "2026-08 (Replicate published list price)",
  },
  {
    modelId: "replicate/real-esrgan",
    provider: "replicate",
    modality: "IMAGE",
    perOutputMicroUsd: 2_300,
    billingUnit: "per_output",
    creditCost: 3,
    enabled: true,
    freeTierEligible: true,
    minimumMarginMultiple: 2.5,
    verification: "estimated",
    checked: "2026-08 (Replicate published list price)",
  },
  {
    modelId: "replicate/remove-bg",
    provider: "replicate",
    modality: "IMAGE",
    perOutputMicroUsd: 1_500,
    billingUnit: "per_output",
    creditCost: 2,
    enabled: true,
    freeTierEligible: true,
    minimumMarginMultiple: 2.5,
    verification: "estimated",
    checked: "2026-08 (Replicate published list price)",
  },
  {
    modelId: "openai/gpt-image-1",
    provider: "openai",
    modality: "IMAGE",
    perOutputMicroUsd: 40_000,
    billingUnit: "per_output",
    assumptions: { resolution: "1024x1024, quality=medium" },
    // Was 16, a 2.0x margin — the worst image ratio in the catalogue and the
    // one most likely to be chosen, because it is the model people recognise.
    // 20 credits is the floor at 2.5x.
    creditCost: 20,
    enabled: true,
    freeTierEligible: false,
    minimumMarginMultiple: 2.5,
    verification: "estimated",
    checked: "2026-08 (OpenAI published list price)",
  },
  {
    modelId: "google/gemini-2.5-flash-image",
    provider: "google",
    modality: "IMAGE",
    // Never established. Not zero, not "probably cheap" — unknown.
    perOutputMicroUsd: null,
    billingUnit: "per_output",
    creditCost: 8,
    // Rule 1: an unknown cost cannot be offered for money. Eight credits might
    // be generous or it might be a loss, and there is no way to tell from here.
    // One metered run closes this; until then it is off.
    enabled: false,
    freeTierEligible: false,
    minimumMarginMultiple: 2.5,
    verification: "unknown",
    checked: "never",
  },

  /**
   * Smart Image — google/nano-banana-2, behind `ENABLE_SMART_IMAGE`.
   *
   * Priced on **2K**, which is what Atheos asks for, not on the provider's own
   * 1K default. Pricing the cheap end of a ladder the product does not use is
   * how a margin table reports health that the invoice does not share.
   *
   *   1K $0.067   2K $0.101   4K $0.151   per output image
   *
   * 55 credits = $0.275 against $0.101 = 2.72x. The 4K tier is 80 credits
   * = $0.400 against $0.151 = 2.65x; `image-capabilities.ts` holds the full
   * ladder, and this entry holds the worst case the catalogue can reach at the
   * default resolution.
   */
  {
    modelId: "replicate/nano-banana-2",
    provider: "replicate",
    modality: "IMAGE",
    perOutputMicroUsd: 101_000,
    billingUnit: "per_output",
    assumptions: {
      resolution: "2K",
      note: "4K is 151000 and 80 credits — 2.65x, also above the floor.",
    },
    creditCost: 55,
    enabled: true,
    // An image that costs us ten cents is not something to hand out free.
    freeTierEligible: false,
    minimumMarginMultiple: 2.5,
    verification: "estimated",
    checked: "2026-08-24 (Replicate published per-resolution pricing panel)",
  },
  /**
   * Pro Image — google/nano-banana-pro.
   *
   *   1K $0.150   2K $0.150   4K $0.300   per output image
   *
   * 1K and 2K cost the provider the same, which is why Pro defaults to 2K:
   * asking for the smaller one would cost the customer the same and give them
   * less.
   */
  {
    modelId: "replicate/nano-banana-pro",
    provider: "replicate",
    modality: "IMAGE",
    perOutputMicroUsd: 150_000,
    billingUnit: "per_output",
    assumptions: {
      resolution: "2K",
      note: "4K is 300000 and 160 credits — the same 2.67x.",
    },
    creditCost: 80,
    enabled: true,
    freeTierEligible: false,
    minimumMarginMultiple: 2.5,
    verification: "estimated",
    checked: "2026-08-24 (Replicate published per-resolution pricing panel)",
  },
  /**
   * Studio Image — black-forest-labs/flux-2-pro. Audited, not sold.
   *
   * `$0.015/run + $0.015 per input megapixel + $0.015 per output megapixel`.
   * The input term is the customer's to choose, so the cost of a run is not
   * knowable from the catalogue — four 4MP references add $0.24 to a job quoted
   * from the output size alone. `perOutputMicroUsd` is therefore null rather
   * than the 2MP figure: recording the output-only cost as *the* cost is
   * precisely the mistake that would make this look profitable.
   */
  {
    modelId: "replicate/flux-2-pro",
    provider: "replicate",
    modality: "IMAGE",
    perOutputMicroUsd: null,
    billingUnit: "per_output",
    assumptions: {
      note: "Output-only cost at 2MP is 45000, but inputs are customer-controlled and unbounded.",
    },
    creditCost: 0,
    enabled: false,
    freeTierEligible: false,
    minimumMarginMultiple: 2.5,
    verification: "unknown",
    checked: "2026-08-24 (schema and pricing read; cost is input-dependent)",
  },

  // ------------------------------------------------------------------------
  // Video — the expensive modality, and the one B5 was about
  // ------------------------------------------------------------------------
  {
    modelId: "replicate/video-gen",
    provider: "replicate",
    modality: "VIDEO",
    perOutputMicroUsd: 0,
    perSecondMicroUsd: 20_000,
    billingUnit: "per_second",
    assumptions: {
      maxDurationSeconds: 7.5,
      note: "wan-2.2 caps at 121 frames @ 16fps; 7.5s is the model's ceiling, not a policy",
    },
    creditCost: 90,
    enabled: true,
    freeTierEligible: false,
    minimumMarginMultiple: 3.0,
    verification: "verified",
    checked: "2026-08-13 (apportioned from a real Replicate invoice)",
  },
  {
    modelId: "replicate/video-pro",
    provider: "replicate",
    modality: "VIDEO",
    perOutputMicroUsd: 0,
    perSecondMicroUsd: 54_000,
    billingUnit: "per_second",
    assumptions: { maxDurationSeconds: 12 },
    creditCost: 180,
    enabled: true,
    freeTierEligible: false,
    minimumMarginMultiple: 3.0,
    verification: "verified",
    checked: "2026-08-13 (apportioned from a real Replicate invoice)",
  },

  // ------------------------------------------------------------------------
  // Audio
  // ------------------------------------------------------------------------
  /**
   * The Veo 3.1 tiers, behind `ENABLE_VEO_31`.
   *
   * Costs read from Replicate's published pricing panels on 2026-08-24 and
   * re-verified the same day before these numbers were written down:
   *
   *   veo-3.1        $0.40/s with audio, $0.20/s silent
   *   veo-3.1-fast   $0.15/s with audio, $0.10/s silent
   *   veo-3.1-lite   $0.05/s at 720p,    $0.08/s at 1080p (audio always on)
   *
   * Every entry is priced with **audio on**, at the model's *base* duration —
   * `creditCost` is the base price and `services/ai/pricing.ts` scales it by
   * `durationSeconds / min(durations)`, so a floor that holds at 4 seconds holds
   * at 8 as well. `assumptions.maxDurationSeconds` records the longest clip for
   * the audit trail.
   *
   * Only `veo-3.1-fast` was actually mispriced: 288 credits against a $0.60
   * base cost is 2.40x, under the 3.0x video floor. The other two were already
   * correct.
   *
   * Still `estimated`: these are Replicate's list prices, not a reconciled
   * invoice line. One metered run closes that, and until it does the models
   * stay behind the flag.
   *
   * ## Priced on the Replicate route, deliberately
   *
   * Replicate is the operational path — it is the only adapter that exists, and
   * every Veo generation goes through it. The rates below are Replicate's own,
   * per model, and they are **not** interchangeable:
   *
   *   veo-3.1        $0.40/s     veo-3.1-fast   $0.15/s     veo-3.1-lite $0.05-$0.08/s
   *
   * Applying one tier's rate to the others is the specific mistake this comment
   * exists to prevent: $0.15/s against `veo-3.1`'s real $0.40/s would price it
   * at **1.13x**, well under the 3.0x floor, while overcharging Lite by ~3x.
   *
   * TODO(google-direct): Google's own API is cheaper for the Fast tier —
   * $0.10/s at 720p and $0.12/s at 1080p against Replicate's flat $0.15/s, a
   * 33%/20% saving (verified 2026-08-24, `docs/UNIT_ECONOMICS.md` § 3). Lite
   * and Standard are identically priced on both, so only Fast justifies a
   * direct adapter. Building one needs `GOOGLE_AI_API_KEY`,
   * `ENABLE_GOOGLE_DIRECT`, a route-selection layer and a second set of cost
   * entries keyed by route — a sprint of its own. Until then these figures are
   * the ones that bill.
   */
  {
    /**
     * Cinematic Next — Google's video model, direct.
     *
     * ## $0.10/s, and only for 720p
     *
     * Google publishes that figure specifically for 720p output, and it is
     * independently derivable from the token rate: $17.50 per 1M output tokens
     * at 5,792 tokens per second of 720p = $0.1014/s. Two routes to one number
     * is the closest thing to a reconciled invoice line that exists before the
     * first real run.
     *
     * 1080p and 4K are documented outputs whose token consumption the pricing
     * page does not establish. They are **not** priced here and not sold — an
     * invented rate for an upscaled output is exactly the kind of made-up
     * number this table exists to keep out.
     *
     * ## Priced on the maximum, because the length is the model's decision
     *
     * This model has no duration enum: it produces 3–10 seconds and does not
     * commit to an exact requested length. A quote is issued before the length
     * is known, so the honest options are to charge the stated maximum, or to
     * reserve the maximum and capture the measured cost afterwards. The second
     * needs partial release in the ledger and duration parsing from the MP4;
     * neither is proven, so this is the first.
     *
     * `perSecondMicroUsd` is therefore multiplied by the **maximum** 10
     * seconds rather than by a base duration, and the studio says "Up to 10
     * seconds" rather than naming a length it cannot promise.
     *
     * ## Input tokens
     *
     * Billed separately at $1.50/1M. A prompt is a few hundred tokens against
     * a video costing a dollar, so rather than model it the worst case is
     * absorbed by a documented buffer: the credit price below is computed on
     * $1.05/clip, which is $1.00 of output plus 5% — comfortably more than any
     * plausible prompt, and stated so nobody later assumes input was free.
     */
    modelId: "google/omni-1.1-flash",
    provider: "google-omni",
    modality: "VIDEO",
    perOutputMicroUsd: 0,
    perSecondMicroUsd: 100_000,
    billingUnit: "per_second",
    assumptions: {
      maxDurationSeconds: 10,
      resolution: "720p only — 1080p and 4K are unpriced and not sold",
      note: "Duration is model-decided across 3-10s, so the price is fixed on the 10s maximum. Includes a 5% buffer for input tokens. Audio is always generated and cannot be disabled, so there is no cheaper silent rate.",
    },
    /**
     * 10s x $0.10 x 1.05 buffer = $1.05 worst case. x3.0 video floor = $3.15,
     * / $0.005 per credit = 630.
     *
     * Charged in full whatever length comes back, which is what "Up to 10
     * seconds" means. It can only ever be generous relative to what the
     * customer was told.
     */
    creditCost: 630,
    /**
     * Off, because no adapter can currently serve it.
     *
     * `tests/unit/catalogue-integrity.test.ts` holds the invariant that every
     * priced *and enabled* row must be servable, so an enabled row nothing can
     * run is a catalogue promising work it cannot do. The adapter needs both
     * `GOOGLE_AI_API_KEY` and `ENABLE_GOOGLE_OMNI` and has neither.
     *
     * Same convention `flux-2-pro` uses: audited, priced, deliberately not
     * sold — kept rather than deleted so the reason stays next to the cost.
     */
    enabled: false,
    freeTierEligible: false,
    minimumMarginMultiple: 3,
    verification: "estimated",
    checked:
      "2026-09-02 (Google published pricing page; cross-checked against the token rate)",
  },
  {
    modelId: "replicate/veo-3.1-fast",
    provider: "replicate",
    modality: "VIDEO",
    perOutputMicroUsd: 0,
    perSecondMicroUsd: 150_000,
    billingUnit: "per_second",
    assumptions: {
      maxDurationSeconds: 8,
      resolution: "720p or 1080p — Replicate charges one flat rate",
      note: "With audio. Silent is $0.10/s; priced on the dearer variant.",
    },
    // Base duration is 4s; the charge scales x2 at 8s via durationMultiplier.
    // 4s x $0.15 x 3.0 / $0.005 = 360.
    creditCost: 360,
    enabled: true,
    freeTierEligible: false,
    minimumMarginMultiple: 3,
    verification: "estimated",
    checked: "2026-08-24 (Replicate published pricing panel)",
  },
  {
    modelId: "replicate/veo-3.1",
    provider: "replicate",
    modality: "VIDEO",
    perOutputMicroUsd: 0,
    perSecondMicroUsd: 400_000,
    billingUnit: "per_second",
    assumptions: {
      maxDurationSeconds: 8,
      note: "With audio. Silent is $0.20/s; priced on the dearer variant.",
    },
    // 4s x $0.40 x 3.0 / $0.005 = 960, scaling to 1,920 at 8s.
    creditCost: 960,
    enabled: true,
    freeTierEligible: false,
    minimumMarginMultiple: 3,
    verification: "estimated",
    checked: "2026-08-24 (Replicate published pricing panel)",
  },
  {
    modelId: "replicate/music",
    provider: "replicate",
    modality: "AUDIO",
    perOutputMicroUsd: 0,
    perSecondMicroUsd: 3_000,
    billingUnit: "per_second",
    assumptions: { maxDurationSeconds: 30 },
    creditCost: 20,
    enabled: true,
    freeTierEligible: true,
    minimumMarginMultiple: 2.5,
    verification: "estimated",
    checked:
      "2026-08-13 (inferred from observed A100 run time, not an invoice)",
  },
  {
    modelId: "replicate/sfx",
    provider: "replicate",
    modality: "AUDIO",
    perOutputMicroUsd: 0,
    perSecondMicroUsd: 2_000,
    billingUnit: "per_second",
    assumptions: { maxDurationSeconds: 8 },
    creditCost: 10,
    enabled: true,
    freeTierEligible: true,
    minimumMarginMultiple: 2.5,
    verification: "estimated",
    checked:
      "2026-08-13 (inferred from observed A100 run time, not an invoice)",
  },

  // ------------------------------------------------------------------------
  // Mock — costs nothing, and says so explicitly rather than by omission
  // ------------------------------------------------------------------------
  {
    modelId: "mock/standard",
    provider: "mock",
    modality: "IMAGE",
    perOutputMicroUsd: 0,
    billingUnit: "free",
    creditCost: 4,
    enabled: true,
    freeTierEligible: true,
    minimumMarginMultiple: 0,
    verification: "verified",
    checked: "n/a — no provider call is made",
  },
  {
    modelId: "mock/motion",
    provider: "mock",
    modality: "VIDEO",
    perOutputMicroUsd: 0,
    perSecondMicroUsd: 0,
    billingUnit: "free",
    assumptions: { maxDurationSeconds: 10 },
    creditCost: 40,
    enabled: true,
    // The mock is how the pipeline is exercised without spending money, and a
    // free account is exactly who should be able to do that.
    freeTierEligible: true,
    minimumMarginMultiple: 0,
    verification: "verified",
    checked: "n/a — no provider call is made",
  },
];

const BY_ID = new Map(MODEL_COSTS.map((entry) => [entry.modelId, entry]));

export function costEntry(modelId: string): ModelCostEntry | null {
  return BY_ID.get(modelId) ?? null;
}

/**
 * The most this model can cost for one output, in micro-USD.
 *
 * Null when the cost is unknown. **Priced on the longest duration offered**,
 * never the default: the customer chooses the duration, so the default is the
 * cheapest case rather than the safe one. Checking margin against a 5-second
 * clip on a model that also offers 12 is how B5 stayed invisible.
 */
export function worstCaseCostMicroUsd(entry: ModelCostEntry): number | null {
  if (entry.perOutputMicroUsd === null) return null;

  const seconds = entry.assumptions?.maxDurationSeconds ?? 0;
  return entry.perOutputMicroUsd + (entry.perSecondMicroUsd ?? 0) * seconds;
}

/**
 * Revenue for one output at the model's worst case, in micro-USD.
 *
 * Mirrors `creditsFor()` in `services/ai/pricing.ts`: credits scale with
 * duration by the same ratio the cost does, so a long clip earns proportionally
 * more. The two have to be computed the same way or the margin check is
 * comparing a long clip's cost against a short clip's price.
 *
 * The base duration is not stored here — it comes from the catalogue's
 * `durations[0]`, and the caller passes it. Duplicating it would give the
 * ratio two sources that could disagree.
 */
export function worstCaseRevenueMicroUsd(
  entry: ModelCostEntry,
  baseDurationSeconds: number | undefined,
): number {
  const max = entry.assumptions?.maxDurationSeconds;
  const multiplier =
    max && baseDurationSeconds && baseDurationSeconds > 0
      ? Math.max(1, max / baseDurationSeconds)
      : 1;

  return Math.ceil(entry.creditCost * multiplier) * CREDIT_VALUE_MICRO_USD;
}

export interface SafetyVerdict {
  safe: boolean;
  /** Revenue ÷ cost at the worst case. Null when either side is unknown. */
  marginMultiple: number | null;
  /** The smallest credit price that would clear the floor. Null if unknown. */
  minimumSafeCredits: number | null;
  reason: string;
}

/**
 * Is this model's price safe to sell at?
 *
 * The single question the whole module exists to answer, and the one the test
 * suite runs over every enabled model.
 */
export function assessPrice(
  entry: ModelCostEntry,
  baseDurationSeconds: number | undefined,
): SafetyVerdict {
  const cost = worstCaseCostMicroUsd(entry);

  if (cost === null) {
    return {
      safe: false,
      marginMultiple: null,
      minimumSafeCredits: null,
      reason: "provider cost is unknown, so no price can be shown to be safe",
    };
  }

  // Free to run. Any price clears any margin, and dividing by zero to prove it
  // would produce Infinity rather than an answer.
  if (cost === 0) {
    return {
      safe: true,
      marginMultiple: null,
      minimumSafeCredits: 0,
      reason: "no provider cost",
    };
  }

  const revenue = worstCaseRevenueMicroUsd(entry, baseDurationSeconds);
  const marginMultiple = revenue / cost;

  const max = entry.assumptions?.maxDurationSeconds;
  const durationMultiplier =
    max && baseDurationSeconds && baseDurationSeconds > 0
      ? Math.max(1, max / baseDurationSeconds)
      : 1;

  const minimumSafeCredits = Math.ceil(
    (cost * entry.minimumMarginMultiple) /
      CREDIT_VALUE_MICRO_USD /
      durationMultiplier,
  );

  return {
    safe: marginMultiple >= entry.minimumMarginMultiple,
    marginMultiple,
    minimumSafeCredits,
    reason: `worst-case margin ${marginMultiple.toFixed(2)}x against a ${entry.minimumMarginMultiple}x floor`,
  };
}

/** Models the registry must refuse to run. */
export function disabledModelIds(): readonly string[] {
  return MODEL_COSTS.filter((entry) => !entry.enabled).map(
    (entry) => entry.modelId,
  );
}

/** Whether a Free-plan account may reach this model. Unknown model: no. */
export function isFreeTierEligible(modelId: string): boolean {
  return costEntry(modelId)?.freeTierEligible ?? false;
}

/** Whether the model may run at all. Unknown model: no. */
export function isModelEnabled(modelId: string): boolean {
  return costEntry(modelId)?.enabled ?? false;
}
