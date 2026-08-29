import "server-only";

/**
 * Everything about a sequence model that a browser must never receive.
 *
 * ## The split
 *
 * `sequence-models.public.ts` describes what a model can *do* — durations,
 * resolution, frame rate, whether it makes sound. Three client components
 * import it, so it is a public artefact whether or not anyone intended that.
 *
 * This file holds what a model *is* and what it costs: the catalogue path, the
 * platform that runs it, our per-second spend, the margin working and the
 * price we charge. `server-only` makes importing it from a client component a
 * build error rather than a disclosure.
 *
 * ## Why the price is on this side
 *
 * It was on the public side, and the browser also received the per-second cost
 * the price was derived from — and the Studio rendered that cost as a
 * "Provider cost" row, handing the customer the markup on their own work.
 *
 * The price the browser needs already reaches it through the public model DTO
 * from `/api/generations`, computed server-side per request. A static price
 * table beside the capabilities was a second source of truth for money.
 *
 * ## Why this file exists
 *
 * These were fields on `SequenceModelFacts`, and three client components
 * import that table — so `reachableVia: "replicate"`, notes reading "Google
 * published price, Replicate margin unverified", and `perSecondMicroUsd`, our
 * per-second cost, all shipped to every browser that opened the Studio.
 *
 * Worse, the Studio *rendered* the last one: a "Provider cost" row showing
 * what Atheos pays, from which any customer could compute the markup on their
 * own generation. That was not a leak through a bundle; it was on the screen.
 *
 * None of this is a model capability. It is commercial working notes, and it
 * was living on a capability object — which is why it travelled. `server-only`
 * makes a client import a build error rather than a disclosure.
 *
 * Keyed by public id, like everything else that crosses this boundary.
 */
export interface SequenceCostNote {
  /** Which platform actually runs it. */
  reachableVia: "replicate" | "google-direct" | "unavailable";
  /** Our cost per generated second, in micro-USD. */
  perSecondMicroUsd: number;
  /** How that figure was arrived at, for the margin review. */
  costBasis: string;
}

/**
 * Public id → catalogue path.
 *
 * The only place the translation happens for sequences. A caller hands us a
 * public id; nothing hands us a catalogue path and is believed.
 */
export const SEQUENCE_INTERNAL_IDS: Record<string, string> = {
  "motion-1": "replicate/video-gen",
  "motion-pro": "replicate/video-pro",
  "cinematic-fast": "replicate/veo-3.1-fast",
  cinematic: "replicate/veo-3.1",
  "cinematic-lite": "replicate/veo-3.1-lite",
};

/**
 * There is no price table here, and there must not be one.
 *
 * A `SEQUENCE_BASE_CREDITS` map lived at this spot for exactly one turn. It
 * was a second source of truth for money and it had already drifted: it quoted
 * Cinematic Fast at 288 credits while the registry charged 360.
 *
 * `creditCost` on the provider registry is the price, `priceFor` is the only
 * function that reads it, and `services/connectors/sequence-quote.ts` is where
 * a sequence gets one. Copying a number out of the registry to save a lookup
 * is how the two disagree.
 */
export const SEQUENCE_COST_NOTES: Record<string, SequenceCostNote> = {
  "motion-1": {
    reachableVia: "replicate",
    perSecondMicroUsd: 20_000,
    costBasis: "apportioned from a real Replicate invoice, 2026-08-13",
  },
  "motion-pro": {
    reachableVia: "replicate",
    perSecondMicroUsd: 54_000,
    costBasis: "apportioned from a real Replicate invoice, 2026-08-13",
  },
  "cinematic-fast": {
    reachableVia: "replicate",
    perSecondMicroUsd: 120_000,
    costBasis:
      "Google published price, 2026-08-22. Replicate margin unverified — confirm on first invoice.",
  },
  cinematic: {
    reachableVia: "replicate",
    perSecondMicroUsd: 400_000,
    costBasis:
      "Google published price, 2026-08-22. Replicate margin unverified — confirm on first invoice.",
  },
  "cinematic-lite": {
    reachableVia: "replicate",
    perSecondMicroUsd: 80_000,
    costBasis:
      "Google published price, 2026-08-22. Replicate margin unverified — confirm on first invoice.",
  },
};

/**
 * What a quote will cost Atheos, as opposed to what it charges.
 *
 * Split out of `quoteSequence` so the quote itself can be handed to a browser.
 * The overspend guard needs this figure; a customer does not, and giving it to
 * them hands over the margin.
 */
export function providerCostMicroUsdFor(input: {
  publicModelId: string;
  generatedSeconds: number;
}): number {
  const note = SEQUENCE_COST_NOTES[input.publicModelId];
  if (!note) return 0;

  return Math.round(input.generatedSeconds * note.perSecondMicroUsd);
}
