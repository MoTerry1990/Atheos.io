import "server-only";

import {
  isOfferedToOwner,
  isPubliclyOffered,
  type Caller,
} from "@/services/ai/model-policy";
import { publicModelId, publicModelName } from "@/services/ai/public-ids";
import { AUDIO_CAPABILITIES } from "@/services/ai/audio-strategy";
import { findModel, listModels } from "@/services/ai/registry";
import type { ProviderModel } from "@/services/ai/types";

/**
 * One catalogue for every connector.
 *
 * ## Why this exists rather than each surface deciding for itself
 *
 * MCP built its own answer and got three things wrong at once. `list_models`
 * returned `listModels()` straight through, so every API-key holder was shown
 * `replicate/video-gen` and `FLUX Schnell` — the provider abstraction the whole
 * public-model contract exists to maintain, bypassed on the one surface aimed
 * at other people's software. The same list advertised **Score**, which is
 * blocked outright, and **Motion Pro** and both Cinematic tiers, which no
 * customer may buy.
 *
 * Submission would have refused all four. That is not a defence: a catalogue
 * is an offer, and offering what the server will refuse is the defect this
 * codebase has now fixed on the marketing pages, the Studio picker and the
 * quote endpoint. A connector is not exempt because its reader is a machine.
 *
 * REST will call this too. Policy, pricing and model resolution are decided
 * here once, so the two surfaces cannot drift into disagreeing about what
 * Atheos sells.
 *
 * ## Public ids only, in both directions
 *
 * Nothing here returns a provider path, an endpoint, a version or a vendor's
 * model name, and `resolveConnectorModel` refuses to accept one as input. An
 * integrator who wires `replicate/video-gen` into their code has built
 * something that breaks the day Atheos changes host — so it must never work
 * even once.
 */

export interface ConnectorModel {
  /** The public Atheos id. Never a provider path. */
  id: string;
  name: string;
  modality: ProviderModel["modality"];
  /** Base price. Longer clips scale from here. */
  credits: number;
  /** Exact clip lengths this model accepts. Empty for stills. */
  durations: readonly number[];
  resolutions: readonly string[];
  aspectRatios: readonly string[];
  maxOutputs: number;
  /** `native` when the model generates sound in the same pass. */
  audio: "native" | "silent" | "not_applicable";
  /** One honest line about sound. */
  audioNote: string;
  takesReference: boolean;
}

/** What this model does about sound, from the audited capability table. */
function audioOf(model: ProviderModel): {
  audio: ConnectorModel["audio"];
  audioNote: string;
} {
  if (model.modality === "AUDIO") {
    return { audio: "native", audioNote: "Generates sound as its output." };
  }
  if (model.modality !== "VIDEO") {
    return { audio: "not_applicable", audioNote: "" };
  }

  const capability = AUDIO_CAPABILITIES[model.id];

  /**
   * Absent means silent, not unknown.
   *
   * A video model with no entry has not been audited for audio, and the safe
   * description of an unaudited model is the one that promises nothing.
   */
  if (!capability) {
    return {
      audio: "silent",
      audioNote: "This model generates no audio. The finished video is silent.",
    };
  }

  return {
    audio: capability.strategies.includes("NATIVE") ? "native" : "silent",
    audioNote: capability.note,
  };
}

function toConnectorModel(model: ProviderModel): ConnectorModel {
  const { audio, audioNote } = audioOf(model);
  /**
   * Widened locally, as the studio DTO does.
   *
   * `ModelCapabilities` does not declare `imageResolutions` — some adapters
   * carry it and some do not — so it is read defensively rather than added to
   * the shared type on the strength of one caller.
   */
  const capabilities = model.capabilities as typeof model.capabilities & {
    imageResolutions?: readonly string[];
  };

  return {
    id: publicModelId(model.id),
    name: publicModelName(model.id, model.displayName),
    modality: model.modality,
    credits: model.creditCost,
    durations: capabilities.durations ?? [],
    resolutions: capabilities.imageResolutions ?? [],
    aspectRatios: capabilities.aspectRatios ?? [],
    maxOutputs: capabilities.maxOutputs ?? 1,
    audio,
    audioNote,
    takesReference: Boolean(capabilities.supportsImageInput),
  };
}

/**
 * The models this caller may actually run.
 *
 * `caller` is resolved from the session or the key's owner by whoever calls
 * this — never from a request field. A blocked model is in neither list.
 */
export function connectorModels(caller: Caller): ConnectorModel[] {
  const permitted = caller === "owner" ? isOfferedToOwner : isPubliclyOffered;

  return listModels()
    .filter((model) => permitted(model.id))
    .map(toConnectorModel);
}

/**
 * The catalogue id behind a public one, if this caller may run it.
 *
 * Returns null for an unknown id, a provider path, a blocked model, or one
 * this caller is not permitted — deliberately without distinguishing between
 * them, because "that model exists but is not for you" tells an integrator
 * that an owner-only catalogue exists.
 */
export function resolveConnectorModel(
  publicId: string,
  caller: Caller,
): string | null {
  // A provider path is refused before it is looked up, so it cannot become a
  // working input by accident.
  if (publicId.includes("/")) return null;

  const match = connectorModels(caller).find((model) => model.id === publicId);
  if (!match) return null;

  const catalogueId = listModels().find(
    (model) => publicModelId(model.id) === publicId,
  )?.id;

  return catalogueId ?? null;
}

/** The model a connector uses when the caller named none. */
export function defaultConnectorModel(
  modality: ProviderModel["modality"],
  caller: Caller,
): ConnectorModel | undefined {
  return connectorModels(caller).find((model) => model.modality === modality);
}

export class DurationError extends Error {
  constructor(readonly allowed: readonly number[]) {
    super(
      allowed.length === 0
        ? "This model does not take a duration."
        : `Choose one of: ${allowed.join(", ")} seconds.`,
    );
    this.name = "DurationError";
  }
}

/**
 * The requested duration, or a refusal.
 *
 * **Never the nearest.** `resolveDuration` in the generation pipeline snaps a
 * request to the closest allowed value, which is right for a Studio slider
 * bounded by the same list and wrong for an API: MCP advertised 5 and 10
 * seconds, Motion 1 accepts 5 and 7.5, and asking for 10 quietly produced a
 * 7.5-second clip priced as 7.5 while the tool description promised "ten
 * seconds costs twice five". Three untruths from one hand-written enum.
 *
 * An integrator who asks for something impossible needs to be told, not
 * accommodated — they are writing code against the answer.
 */
export function exactDuration(
  model: ConnectorModel,
  requested: number | undefined,
): number | undefined {
  /**
   * A model with no enum decides its own length.
   *
   * Returning `undefined` is right — there is no duration to send and the
   * price is fixed on the maximum. But a caller who *asked* for a specific
   * length must be told it cannot be honoured, rather than having the value
   * quietly dropped: silently discarding a request is the same class of defect
   * as silently rounding one, and this codebase refuses the second everywhere
   * else.
   *
   * The interface never sends one for these models — it renders "Up to N
   * seconds" and no picker — so this is reached by a forged request or an
   * integrator working from the wrong assumption. Both deserve the same
   * answer.
   */
  if (model.durations.length === 0) {
    /**
     * Only a **video** model refuses here.
     *
     * Two different situations share "no duration enum". A video model with no
     * enum chooses its own length, and a caller who asked for a specific one
     * must be told it cannot be honoured — dropping the value silently is the
     * same defect as silently rounding it.
     *
     * An *image* model has no duration because duration is meaningless for a
     * still. A client that sends a stray `durationSeconds` alongside an image
     * request has not asked for anything impossible; it has sent a field that
     * does not apply. Refusing that would break working integrations over a
     * value nobody meant, which is exactly what the first version of this
     * check did — `tests/unit/prepare-generation.test.ts` caught it.
     */
    if (requested !== undefined && model.modality === "VIDEO") {
      throw new DurationError([]);
    }
    return undefined;
  }

  if (requested === undefined) return Math.min(...model.durations);

  if (!model.durations.includes(requested)) {
    throw new DurationError(model.durations);
  }
  return requested;
}

/** The catalogue entry behind a public id, for callers that need capabilities. */
export function connectorModelById(
  publicId: string,
  caller: Caller,
): ConnectorModel | undefined {
  return connectorModels(caller).find((model) => model.id === publicId);
}

/** Re-exported so callers need not reach past this service. */
export { findModel };
