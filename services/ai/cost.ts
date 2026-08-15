import "server-only";

import { creditsFor } from "@/services/ai/pricing";
import { MICRO_USD, costEntry } from "@/services/billing/model-costs";
import type { ProviderId, ProviderModel } from "@/services/ai/types";

/**
 * What a generation costs **us**.
 *
 * ## The gap this closes
 *
 * `pricing.ts` answers "what do we charge" — in credits, which are ours to
 * define. Nothing answered "what do we pay", so `PROJECT_AUDIT.md` recorded
 * that unit economics were unmeasurable: we could see revenue and we could see
 * usage, and we could not see whether a generation made or lost money.
 *
 * That is not a reporting inconvenience. A product priced in credits with an
 * unknown provider cost can be sold enthusiastically at a loss, and the
 * enthusiasm is what makes the loss large.
 *
 * ## Two different currencies, deliberately not unified
 *
 *   - **Credits** are a product abstraction. They exist so a user does not have
 *     to reason about eleven vendors' price lists, and so we can change vendor
 *     without changing the price of anything.
 *   - **Cost** is real money, in **micro-USD** (millionths of a dollar).
 *
 * Micro-USD because per-image costs are genuinely sub-cent — a fast image model
 * can be $0.003 — and cents would round most of the catalogue to zero. Integers
 * because floating-point money is how a ledger stops adding up. Same reasoning
 * as the credit ledger.
 *
 * ## These numbers are estimates, and the code says so
 *
 * Provider prices are published, change without notice, and vary by account.
 * `estimatedCostMicroUsd` is named for what it is. The authoritative figure is
 * the vendor's own invoice, and reconciling against it is work nobody has done.
 * Anything rendered from this must be labelled approximate — the same rule
 * already applied to recorded revenue (§ 6).
 */

/**
 * ## One source, since Sprint 4
 *
 * This file used to hold its own `COST_BASIS` map. `services/billing/model-costs.ts`
 * now owns those figures, because the margin check needs them next to the
 * credit price and two maps of provider costs would eventually disagree — with
 * the margin report reading one and the pricing gate reading the other.
 *
 * What stays here is the *estimator*: turning a basis plus a request into a
 * number, which is a different job from deciding what the basis is.
 */
export { MICRO_USD } from "@/services/billing/model-costs";

export interface ModelCostBasis {
  /** What the vendor charges per output, in micro-USD. */
  perOutputMicroUsd: number;
  /**
   * Additional cost per second of video, in micro-USD.
   *
   * Separate from `perOutputMicroUsd` because video vendors price by duration
   * and image vendors do not. Folding them together would make a 10-second clip
   * cost the same as a 5-second one.
   */
  perSecondMicroUsd?: number;
  /** When this figure was last checked against the vendor's public pricing. */
  checked: string;
}

/**
 * The basis for a model, or null when it has none.
 *
 * A model absent from the configuration has **unknown** cost, which is reported
 * as such rather than assumed to be zero — assuming zero is how a loss-making
 * model looks like the most profitable one in the table.
 */
function basisFor(modelId: string): ModelCostBasis | null {
  const entry = costEntry(modelId);
  if (!entry || entry.perOutputMicroUsd === null) return null;

  return {
    perOutputMicroUsd: entry.perOutputMicroUsd,
    ...(entry.perSecondMicroUsd !== undefined
      ? { perSecondMicroUsd: entry.perSecondMicroUsd }
      : {}),
    checked: entry.checked,
  };
}

export interface CostEstimate {
  /** Null when the model has no recorded basis. Never silently zero. */
  costMicroUsd: number | null;
  /** What we charge, for the same request. */
  credits: number;
  /**
   * Cost as a share of revenue, where both are known and revenue is non-zero.
   *
   * Null rather than Infinity or NaN when it cannot be computed — a margin
   * column full of `Infinity` is worse than one full of blanks.
   */
  marginRatio: number | null;
  basisChecked: string | null;
}

/**
 * What one request will cost us, and what we will charge for it.
 *
 * `creditValueMicroUsd` is what a credit is worth in real money, derived from
 * the plans. It is a parameter rather than a constant because it changes with
 * pricing and a hard-coded value would silently make every historical margin
 * figure wrong.
 */
export function estimateCost(
  model: ProviderModel,
  outputs: number,
  options: {
    durationSeconds?: number;
    creditValueMicroUsd?: number;
  } = {},
): CostEstimate {
  const credits = creditsFor(model, outputs, options.durationSeconds);
  const basis = basisFor(model.id);

  if (!basis) {
    return {
      costMicroUsd: null,
      credits,
      marginRatio: null,
      basisChecked: null,
    };
  }

  const count = Math.max(1, outputs);
  const seconds = options.durationSeconds ?? 0;

  const costMicroUsd =
    basis.perOutputMicroUsd * count +
    (basis.perSecondMicroUsd ?? 0) * seconds * count;

  const creditValue = options.creditValueMicroUsd;
  const revenue = creditValue ? credits * creditValue : 0;

  return {
    costMicroUsd,
    credits,
    marginRatio: revenue > 0 ? costMicroUsd / revenue : null,
    basisChecked: basis.checked,
  };
}

/** Models with no recorded cost. The gap, countable. */
export function modelsWithoutCostBasis(
  models: readonly ProviderModel[],
): readonly string[] {
  return models.filter((m) => !basisFor(m.id)).map((m) => m.id);
}

/**
 * A recorded cost, for persisting alongside a generation.
 *
 * Deliberately **not** written to the credit ledger. That ledger is the record
 * of what a *user* was charged and must stay readable as exactly that; mixing
 * our supplier costs into it would make "explain this balance" ambiguous.
 *
 * There is no column for this yet — see AI_ENGINE.md. This shape is what the
 * migration should carry.
 */
export interface RecordedCost {
  generationId: string;
  providerId: ProviderId;
  modelId: string;
  costMicroUsd: number | null;
  creditsCharged: number;
  outputs: number;
  durationSeconds?: number;
}

export function toRecordedCost(
  generationId: string,
  model: ProviderModel,
  estimate: CostEstimate,
  outputs: number,
  durationSeconds?: number,
): RecordedCost {
  return {
    generationId,
    providerId: model.providerId,
    modelId: model.id,
    costMicroUsd: estimate.costMicroUsd,
    creditsCharged: estimate.credits,
    outputs,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
  };
}

/**
 * Micro-USD as a display string. Rounds to cents only at the edge.
 *
 * `null` is "unknown", never `$0.00` — the same rule the usage aggregates
 * follow. A provider that did not report a cost has not told us the cost is
 * zero, and printing zero turns missing data into a margin claim.
 *
 * The threshold is on the **magnitude**. Sprint 21 grew a second copy of this
 * function in `services/billing/usage.ts` that compared `micro` directly, so a
 * −$2.50 refund printed as `$-2.5000` while +$2.50 printed as `$2.50`. RC1
 * deleted that copy and kept its `Math.abs`, which was the correct half of the
 * divergence.
 */
export function formatMicroUsd(micro: number | null): string {
  if (micro === null) return "unknown";
  return `$${(micro / MICRO_USD).toFixed(Math.abs(micro) < 10_000 ? 4 : 2)}`;
}
