import "server-only";

import {
  CREDIT_VALUE_MICRO_USD,
  MICRO_USD,
  type CostVerification,
} from "@/services/billing/model-costs";

/**
 * Provider cost in, credits out.
 *
 * ## Why a formula rather than a table
 *
 * Credit prices used to be typed in two places — the adapter and the cost table
 * — and `REVENUE_READINESS_AUDIT.md` § 8 found Motion Pro costing more to run
 * than it earned because nothing compared them. A per-model number that a human
 * writes is a number that drifts from the cost it was derived from.
 *
 * This turns the relationship into arithmetic: given a verified provider cost
 * and a target margin, there is exactly one correct credit price, and it is
 * computed the same way on the quote screen and on the invoice.
 *
 * ## Everything that moves the cost has to move the quote
 *
 * Duration, resolution, audio and the number of provider calls all change what
 * a generation costs us. A quote that ignores any of them is a quote that is
 * wrong for exactly the requests that cost the most — a ten-second 1080p clip
 * with audio priced as though it were four seconds of silent 720p.
 *
 * ## Rounding is always upward
 *
 * `Math.ceil`, everywhere, without exception. A half-credit rounded down is a
 * half-credit of margin given away on every generation forever, and at volume
 * that is the difference between the floor holding and not.
 */

/** What one credit is worth to a subscriber, in dollars. The canonical rate. */
export const SUBSCRIPTION_CREDIT_VALUE_USD = CREDIT_VALUE_MICRO_USD / MICRO_USD;

/**
 * Margin floors, as a fraction of revenue.
 *
 * `preferred` applies when the request goes to the cheapest verified route.
 * `fallback` is the lowest Atheos will accept at all — below it a model is
 * top-up-only or unavailable rather than subsidised.
 */
export const MARGIN_FLOOR = {
  preferred: 0.6,
  fallback: 0.55,
} as const;

/**
 * A reserve for the costs that are real but not on the provider's invoice:
 * storage, egress, the polling requests, and the occasional job that is paid
 * for and then fails its delivery gate.
 *
 * 8% of provider cost. Not a guess dressed as precision — it is a deliberate
 * conservative pad, and it is applied *before* the margin so it cannot be
 * eroded by it.
 */
export const OVERHEAD_RESERVE = 0.08;

/**
 * The multiplier applied to a cost we have not proven.
 *
 * An `estimated` figure is a published list price nobody has reconciled against
 * an invoice; `unknown` has no figure at all. Treating an estimate as exact is
 * how a model gets sold below cost — so an estimate is priced as though it were
 * 25% worse than it looks, and an unknown cost cannot be priced at all.
 */
export const UNVERIFIED_COST_CEILING = 1.25;

export interface QuoteInput {
  /** Provider cost per output, micro-USD. Null when unknown. */
  perOutputMicroUsd: number | null;
  /** Additional cost per second, for duration-priced models. */
  perSecondMicroUsd?: number;
  /** Seconds of output. Required when `perSecondMicroUsd` is set. */
  durationSeconds?: number;
  /**
   * How many provider calls this workflow makes.
   *
   * Atheos sound design is two calls — the video, then the audio model — and
   * quoting only the first is how a workflow gets sold at half its cost.
   */
  providerCalls?: number;
  /** How much we trust the cost figure. */
  verification: CostVerification;
  /** Which floor applies. `preferred` for the cheapest verified route. */
  route?: keyof typeof MARGIN_FLOOR;
  outputs?: number;
}

export interface Quote {
  /** What the customer is charged. Always a whole number, always rounded up. */
  credits: number;
  /** What we expect to pay the provider, micro-USD, after the unverified pad. */
  providerCostMicroUsd: number;
  /** Revenue at the canonical credit value, micro-USD. */
  revenueMicroUsd: number;
  /** Realised margin. At or above the floor by construction. */
  margin: number;
  floor: number;
  /** Why this number, in one line, for the audit trail. */
  basis: string;
}

export class UnpricedModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnpricedModelError";
  }
}

/**
 * The raw provider cost of a request, before margin.
 *
 * Exported because the router needs to compare routes on cost alone, without
 * the margin arithmetic on top.
 */
export function providerCostOf(input: QuoteInput): number {
  if (input.perOutputMicroUsd === null) {
    throw new UnpricedModelError(
      "This model has no verified cost and cannot be priced.",
    );
  }

  const perSecond = input.perSecondMicroUsd ?? 0;
  if (perSecond > 0 && (input.durationSeconds ?? 0) <= 0) {
    // A per-second model quoted without a duration would price at zero.
    throw new UnpricedModelError(
      "This model is priced per second and no duration was given.",
    );
  }

  const perCall =
    input.perOutputMicroUsd + perSecond * (input.durationSeconds ?? 0);

  const calls = Math.max(1, input.providerCalls ?? 1);
  const outputs = Math.max(1, input.outputs ?? 1);

  return perCall * calls * outputs;
}

/**
 * Price a generation.
 *
 * Throws rather than returning a default when the cost is unknown. A model
 * nobody has costed must be unavailable, not cheap — returning a fallback
 * number here is precisely how an unpriced model reaches a customer.
 */
export function quoteCredits(input: QuoteInput): Quote {
  const raw = providerCostOf(input);

  // An unproven cost is treated as worse than it looks, before margin.
  const padded =
    input.verification === "verified" ? raw : raw * UNVERIFIED_COST_CEILING;

  const withOverhead = padded * (1 + OVERHEAD_RESERVE);

  const floor = MARGIN_FLOOR[input.route ?? "fallback"];

  /**
   * revenue >= cost / (1 - floor)
   *
   * At a 60% floor that is 2.5x cost, which is the same multiple
   * `model-costs.ts` asserts per model — the two are the same rule expressed
   * once as a check and once as a calculation.
   */
  const requiredRevenue = withOverhead / (1 - floor);

  // Upward. Always.
  const credits = Math.ceil(requiredRevenue / CREDIT_VALUE_MICRO_USD);

  const revenue = credits * CREDIT_VALUE_MICRO_USD;

  return {
    credits,
    providerCostMicroUsd: Math.ceil(withOverhead),
    revenueMicroUsd: revenue,
    margin: (revenue - withOverhead) / revenue,
    floor,
    basis: [
      `provider $${(raw / MICRO_USD).toFixed(4)}`,
      input.verification !== "verified"
        ? `x${UNVERIFIED_COST_CEILING} (${input.verification})`
        : null,
      `x${1 + OVERHEAD_RESERVE} overhead`,
      `floor ${Math.round(floor * 100)}%`,
      `-> ${credits} credits`,
    ]
      .filter(Boolean)
      .join(", "),
  };
}

/**
 * Whether an existing hand-set credit price still clears a floor.
 *
 * The catalogue carries prices set before this module existed. Rather than
 * rewriting them — which would change what customers pay — this checks them,
 * so a drifting cost surfaces as a failing test rather than as a thin month.
 */
export function clearsFloor(
  credits: number,
  input: QuoteInput,
): { ok: boolean; margin: number; required: number } {
  const required = quoteCredits(input).credits;
  const cost = providerCostOf(input) * (1 + OVERHEAD_RESERVE);
  const revenue = credits * CREDIT_VALUE_MICRO_USD;

  return {
    ok: credits >= required,
    margin: (revenue - cost) / revenue,
    required,
  };
}

/**
 * The most credits a plan can grant and still clear a margin floor.
 *
 * Worst case: the subscriber burns the whole allowance on the thinnest model in
 * the catalogue. `costPerCreditMicroUsd` is `credit value / lowest margin
 * multiple` — $0.002 while the floor is 2.5x.
 *
 * Stripe's fee and a refund allowance come off the top, because they come off
 * the top in reality and a plan margin computed on gross revenue is a number
 * that flatters itself.
 */
export function maxSafeAllowance(input: {
  monthlyPriceCents: number;
  costPerCreditMicroUsd: number;
  floor: number;
  stripePercent?: number;
  stripeFixedCents?: number;
  refundAllowance?: number;
}): number {
  const price = input.monthlyPriceCents / 100;
  const stripe =
    price * (input.stripePercent ?? 0.029) +
    (input.stripeFixedCents ?? 30) / 100;
  const net = (price - stripe) * (1 - (input.refundAllowance ?? 0.05));

  const affordableCostUsd = net * (1 - input.floor);
  return Math.floor(
    (affordableCostUsd * MICRO_USD) / input.costPerCreditMicroUsd,
  );
}
