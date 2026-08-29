import "server-only";

import { priceFor } from "@/services/ai/registry";
import {
  quoteSequence,
  type SequenceMode,
  type SequenceQuote,
} from "@/services/ai/sequence";
import { SEQUENCE_MODEL_FACTS } from "@/services/ai/sequence-models.public";
import { providerCostMicroUsdFor } from "@/services/ai/sequence-models.server";
import { buildDirectorPlan } from "@/services/ai/video-director";
import type { Caller } from "@/services/ai/model-policy";
import {
  connectorModelById,
  DurationError,
  exactDuration,
  resolveConnectorModel,
} from "@/services/connectors/catalogue";

/**
 * What a sequence will cost, decided on the server.
 *
 * ## Why this exists
 *
 * `quoteSequence` used to run in the browser against a price table that lived
 * beside the model capabilities. That was two problems wearing one shape: the
 * price list shipped to every visitor, and it was a *second* source of truth
 * for money — one that had already drifted, quoting Cinematic Fast at 288
 * credits while the registry charged 360.
 *
 * Prices are `creditCost` on the provider registry, scaled by
 * `durationMultiplier`, and `priceFor` is the only function that reads them.
 * Nothing else may hold a copy. Change a price there and every quote moves,
 * including this one — which is the property `tests/unit/sequence-pricing.test.ts`
 * pins.
 *
 * ## What the browser sends and what it gets
 *
 * It sends a public id and the settings a person chose. It gets a description
 * of the work and a number. It never sends a price, and if it did nothing here
 * would read it: `priceFor` is called with the settings, not with anything the
 * client asserted about their cost.
 */

export interface SequenceQuoteRequest {
  publicModelId: string;
  mode: SequenceMode;
  prompt: string;
  durationSeconds: number;
  outputs?: number;
  hasReferenceImage?: boolean;
  requestedResolution?: string;
  wantsAudio?: boolean;
}

export type SequenceQuoteFailure =
  "model_unavailable" | "model_setting_unavailable";

export interface SequenceQuoteResult {
  ok: boolean;
  /** Present when `ok`. Public shape: no provider, no internal id, no cost. */
  quote?: SequenceQuote & { creditCost: number };
  reason?: SequenceQuoteFailure;
  /** Safe to show a customer. Names no vendor and no licence. */
  message?: string;
}

/**
 * Price a sequence for one caller.
 *
 * Policy first, settings second, price last — in that order, because pricing a
 * model the caller may not run is an offer we would then have to withdraw, and
 * because an impossible duration must be refused rather than rounded into
 * something cheaper than it was asked for.
 */
export function quoteSequenceForCaller(
  input: SequenceQuoteRequest,
  caller: Caller,
): SequenceQuoteResult {
  // A public id, resolved against what this caller may actually run. Returns
  // null for an unknown id, a provider path, a blocked model, or one that is
  // not theirs — without saying which.
  const internalId = resolveConnectorModel(input.publicModelId, caller);
  const model = connectorModelById(input.publicModelId, caller);

  if (!internalId || !model) {
    return {
      ok: false,
      reason: "model_unavailable",
      message: "That model is not available.",
    };
  }

  let durationSeconds: number | undefined;
  try {
    durationSeconds = exactDuration(model, input.durationSeconds);
  } catch (error) {
    if (error instanceof DurationError) {
      return {
        ok: false,
        reason: "model_setting_unavailable",
        message: `That clip length is not available. ${error.message}`,
      };
    }
    throw error;
  }

  const outputs = input.outputs ?? 1;
  if (!Number.isInteger(outputs) || outputs < 1 || outputs > model.maxOutputs) {
    return {
      ok: false,
      reason: "model_setting_unavailable",
      message:
        model.maxOutputs === 1
          ? "This model produces a single output per generation."
          : `Choose a whole number of outputs between 1 and ${model.maxOutputs}.`,
    };
  }

  const facts = SEQUENCE_MODEL_FACTS[input.publicModelId];
  if (!facts) {
    // A model in the catalogue with no sequence facts cannot be planned, and
    // guessing its shape would price work nobody can run.
    return {
      ok: false,
      reason: "model_unavailable",
      message: "That model is not available.",
    };
  }

  /**
   * The authoritative price, from the one function that knows it.
   *
   * `priceFor` reads `creditCost` off the provider registry and scales it by
   * the chosen duration. Nothing in this file holds a price, so there is no
   * copy to fall out of step.
   */
  const creditCost = priceFor(internalId, outputs, durationSeconds);

  const quote = quoteSequence({
    baseCredits: creditCost,
    plan: buildDirectorPlan({
      prompt: input.prompt,
      durationSeconds: durationSeconds ?? input.durationSeconds,
    }),
    facts,
    mode: input.mode,
    hasReferenceImage: input.hasReferenceImage,
    requestedResolution: input.requestedResolution,
    wantsAudio: input.wantsAudio,
  });

  return { ok: true, quote: { ...quote, creditCost } };
}

/**
 * What a sequence will cost Atheos. Server callers only.
 *
 * Deliberately not part of `SequenceQuoteResult`: the quote is handed to a
 * browser, and a provider cost on it is the margin. The overspend guard needs
 * this; a customer does not.
 */
export function sequenceProviderCost(quote: SequenceQuote): number {
  return providerCostMicroUsdFor({
    publicModelId: quote.modelId,
    generatedSeconds: quote.generatedSeconds,
  });
}
