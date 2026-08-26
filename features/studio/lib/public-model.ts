import { AUDIO_CAPABILITIES } from "@/services/ai/audio-strategy";
import { policyFor } from "@/services/ai/model-policy";
import {
  catalogueModelId,
  publicModelId,
  publicModelName,
} from "@/services/ai/public-ids";
import type { StudioModel } from "@/features/studio/types";

/**
 * The model, as a customer may see it.
 *
 * ## What was leaking, measured
 *
 * The live `/api/generations` response contained **56 occurrences of
 * "replicate"** — `providerId: "replicate"` on every model, and worse, the id
 * itself is provider-prefixed: `replicate/flux-schnell`. A customer's browser
 * was therefore told which vendor runs every generation, which vendor a
 * finished video came from, and — through the id — the vendor's own model
 * slug.
 *
 * That matters beyond tidiness. "Many vendors, one interface" is the product
 * promise; a client that knows the vendor has already broken it, and the
 * moment a price or an API changes, the leak is what makes the switch visible
 * to customers rather than invisible.
 *
 * ## Public ids are opaque and stable
 *
 * A public id maps to a catalogue id server-side and carries no provider,
 * no version hash and no vendor slug. It is stable across a provider swap,
 * which is the point: moving `flux-schnell` to a different host must not
 * change a single id a browser has seen.
 *
 * ## Audio capability travels with the model
 *
 * The Studio had no audio information at all — `AUDIO_CAPABILITIES` lived
 * server-side and the model DTO carried no field for it, so the picker could
 * not say that Motion 1 is silent however honest the marketing page was.
 */

export type PublicAudioCapability = "native" | "silent" | "not_applicable";

export interface PublicStudioModel {
  /** Opaque and stable. Never a provider path. */
  id: string;
  displayName: string;
  modality: StudioModel["modality"];
  description: string;
  creditCost: number;
  typicalSeconds: number;
  capabilities: StudioModel["capabilities"];
  badge?: StudioModel["badge"];

  /**
   * What this model does about sound, in the customer's terms.
   *
   * `silent` is a statement about the finished file, not a setting: Motion 1
   * and Motion Pro produce no audio track at all, and no prompt changes that.
   */
  audio: PublicAudioCapability;
  /** One honest line about sound, shown beside the model. */
  audioNote: string;
  /** True when the model can start from a supplied image. */
  takesReference: boolean;

  /** Coarse quality band, so a picker can group without naming a vendor. */
  qualityTier: "draft" | "standard" | "premium";
  /** Clip lengths in seconds. Empty for stills. */
  durations: readonly number[];
  aspectRatios: readonly string[];
  /** Output sizes a customer may choose, in customer terms. */
  resolutions: readonly string[];
  /** A range, never a promise. Rendered as "usually 2-4 minutes". */
  typicalWait: { minSeconds: number; maxSeconds: number };
  /** `available` today, or why not. Never a silent absence. */
  availability: "available" | "owner_beta";
}

/**
 * Catalogue id → public id.
 *
 * Hand-written rather than derived, because a derivation would leak the shape
 * it is meant to hide: stripping the prefix off `replicate/veo-3.1-fast`
 * leaves `veo-3.1-fast`, which still names Google's model and its version.
 */
/** What this model does about sound. */
export function audioCapabilityOf(
  catalogueId: string,
  modality: StudioModel["modality"],
): { audio: PublicAudioCapability; audioNote: string } {
  if (modality === "AUDIO") {
    return {
      audio: "native",
      audioNote: "Generates sound as its output.",
    };
  }

  if (modality !== "VIDEO") {
    return { audio: "not_applicable", audioNote: "" };
  }

  const entry = AUDIO_CAPABILITIES[catalogueId];

  /**
   * Native only when the provider's own schema produces it.
   *
   * Everything else is silent, and says so without hedging. "Atheos adds sound
   * afterwards" was the previous wording and it described a pipeline that has
   * never been built.
   */
  if (entry?.strategies.includes("NATIVE")) {
    return {
      audio: "native",
      audioNote: "Generates synchronised sound in the same pass.",
    };
  }

  return {
    audio: "silent",
    audioNote: "Silent — the finished video has no audio track.",
  };
}

/**
 * Strip a model down to what a browser may see.
 *
 * `providerId` and the catalogue id are dropped rather than renamed. A field
 * that is merely renamed comes back the next time somebody needs "the real id"
 * for debugging; a field that does not exist cannot.
 */
/**
 * A quality band, from what the model costs us to run.
 *
 * Price is the only signal available that tracks quality across modalities
 * without naming a vendor's tier. It is coarse on purpose — three bands a
 * customer can reason about, rather than a number that invites comparison
 * shopping against the provider's own pricing page.
 */
function qualityTierOf(model: StudioModel): PublicStudioModel["qualityTier"] {
  if (model.creditCost <= 5) return "draft";
  if (model.creditCost >= 150) return "premium";
  return "standard";
}

/**
 * A wait range rather than a single number.
 *
 * The old DTO carried one `typicalSeconds`, which reads as a promise and is
 * wrong the moment a provider queues. A range is honest about variance and is
 * what the interface should have been showing all along.
 */
function typicalWaitOf(model: StudioModel): PublicStudioModel["typicalWait"] {
  const base = model.typicalSeconds;
  return {
    minSeconds: Math.max(1, Math.round(base * 0.6)),
    maxSeconds: Math.round(base * 1.6),
  };
}

export function toPublicModel(model: StudioModel): PublicStudioModel {
  const { audio, audioNote } = audioCapabilityOf(model.id, model.modality);
  const capabilities = model.capabilities as StudioModel["capabilities"] & {
    durations?: readonly number[];
    aspectRatios?: readonly string[];
    imageResolutions?: readonly string[];
  };

  return {
    id: publicModelId(model.id),
    displayName: publicModelName(model.id, model.displayName),
    modality: model.modality,
    description: model.description,
    creditCost: model.creditCost,
    typicalSeconds: model.typicalSeconds,
    capabilities: model.capabilities,
    ...(model.badge ? { badge: model.badge } : {}),
    audio,
    audioNote,
    takesReference: Boolean(model.capabilities.supportsImageInput),
    qualityTier: qualityTierOf(model),
    durations: capabilities.durations ?? [],
    aspectRatios: capabilities.aspectRatios ?? [],
    resolutions: capabilities.imageResolutions ?? [],
    typicalWait: typicalWaitOf(model),
    /**
     * Read from the licence registry, not hardcoded.
     *
     * `owner_beta` is what makes the "Owner evaluation" badge honest: it marks
     * a model the owner may run and no customer may buy. A customer never sees
     * the value because the catalogue filters those models out before this
     * runs — but if the filter ever regressed, the badge would say so rather
     * than presenting an unsellable model as ordinary stock.
     */
    availability:
      policyFor(model.id)?.status === "OWNER_EVALUATION_ONLY_PENDING_TERMS"
        ? "owner_beta"
        : "available",
  };
}

// ---------------------------------------------------------------------------
// Generations
// ---------------------------------------------------------------------------

/**
 * A finished generation, as a customer may see it.
 *
 * The stored row keeps the catalogue id — reconciliation, cost accounting and
 * admin diagnostics all need to know which provider ran the job. What a
 * browser receives is the public id and the friendly name, so a customer can
 * read their history without learning who Atheos buys inference from.
 *
 * Historical rows resolve correctly because the mapping is by catalogue id,
 * not by anything stored at generation time: a video made months ago still
 * shows "Cinematic Fast".
 */
export interface PublicGeneration {
  id: string;
  status: string;
  operation: string;
  /** Opaque. Never a provider path. */
  modelId: string;
  /** The friendly name, so history need not resolve it against the catalogue. */
  modelName: string;
  prompt: string;
  negativePrompt: string | null;
  creditCost: number;
  /** Already sanitised upstream; never a raw provider exception. */
  error: string | null;
  createdAt: number;
  completedAt: number | null;
  parameters: Record<string, unknown> | null;
  outputs: {
    id: string;
    storageKey: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  }[];
}

/** Strip a generation DTO down to the public contract. */
export function toPublicGenerationFrom(dto: {
  id: string;
  status: string;
  operation: string;
  modelId: string;
  prompt: string;
  negativePrompt: string | null;
  creditCost: number;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
  parameters: Record<string, unknown> | null;
  outputs: PublicGeneration["outputs"];
}): PublicGeneration {
  return {
    ...dto,
    modelId: publicModelId(dto.modelId),
    modelName: publicModelName(dto.modelId, dto.modelId),
    /**
     * `parameters` is a stored blob and can carry anything an older version
     * wrote, so it is filtered rather than trusted. `creativePlan` holds only
     * hashes and counts and is safe; everything else is dropped unless it is a
     * known display field.
     */
    parameters: dto.parameters ? publicParameters(dto.parameters) : null,
  };
}

/** Known-safe parameter keys. Anything unrecognised is dropped, not renamed. */
const PUBLIC_PARAMETER_KEYS = new Set([
  "operation",
  "aspectRatio",
  "durationSeconds",
  "outputs",
  "seed",
  "imageResolution",
  "cameraMotion",
  "promptSource",
  "creativePlan",
]);

function publicParameters(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (PUBLIC_PARAMETER_KEYS.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Re-exported so the studio keeps one import for the whole public contract.
 * The mapping itself lives in `services/ai/public-ids.ts`.
 */
export { catalogueModelId, publicModelId, publicModelName };
