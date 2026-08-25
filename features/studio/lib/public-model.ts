import { AUDIO_CAPABILITIES } from "@/services/ai/audio-strategy";
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
}

/**
 * Catalogue id → public id.
 *
 * Hand-written rather than derived, because a derivation would leak the shape
 * it is meant to hide: stripping the prefix off `replicate/veo-3.1-fast`
 * leaves `veo-3.1-fast`, which still names Google's model and its version.
 */
const PUBLIC_IDS: Record<string, string> = {
  "replicate/flux-schnell": "atheos-image-fast",
  "replicate/flux-dev": "atheos-image-realistic",
  "replicate/real-esrgan": "atheos-upscale",
  "replicate/remove-bg": "atheos-cutout",
  "replicate/video-gen": "motion-1",
  "replicate/video-pro": "motion-pro",
  "replicate/veo-3.1-fast": "cinematic-fast",
  "replicate/veo-3.1": "cinematic",
  "replicate/veo-3.1-lite": "cinematic-lite",
  "replicate/music": "score",
  "replicate/sfx": "foley",
};

/**
 * Catalogue id → the name a customer sees.
 *
 * The id was not the only leak: `displayName: "FLUX Schnell"` names Black
 * Forest Labs' model family as plainly as the path did, and a customer reading
 * it can look up exactly which vendor and weights are behind the button.
 *
 * The names are the product's own. Where a model already had one that says
 * nothing about its vendor — Motion 1, Score, Foley — it is kept, because
 * renaming a familiar label to prove a point costs recognition and buys
 * nothing.
 */
const PUBLIC_NAMES: Record<string, string> = {
  "replicate/flux-schnell": "Atheos Image Fast",
  "replicate/flux-dev": "Atheos Image Realistic",
  "replicate/real-esrgan": "Atheos Upscale",
  "replicate/remove-bg": "Atheos Cutout",
  "replicate/video-gen": "Motion 1",
  "replicate/video-pro": "Motion Pro",
  "replicate/veo-3.1-fast": "Cinematic Fast",
  "replicate/veo-3.1": "Cinematic",
  "replicate/veo-3.1-lite": "Cinematic Lite",
  "replicate/music": "Score",
  "replicate/sfx": "Foley",
};

/**
 * The customer-facing name.
 *
 * Falls back to the catalogue's own `displayName` only when the model is
 * mapped; an unmapped model gets a neutral label rather than whatever the
 * adapter happened to call it, for the same reason its id gets a hash.
 */
export function publicModelName(catalogueId: string, fallback: string): string {
  const mapped = PUBLIC_NAMES[catalogueId];
  if (mapped) return mapped;

  // Unmapped: never pass the adapter's name through, since that is where a
  // vendor's model family shows up.
  return /flux|veo|wan|seedance|sdxl|kling|imagen/i.test(fallback)
    ? "Atheos Model"
    : fallback;
}

/** Reverse map, built once. The server resolves a public id back to a model. */
const CATALOGUE_IDS: Record<string, string> = Object.fromEntries(
  Object.entries(PUBLIC_IDS).map(([catalogue, publicId]) => [
    publicId,
    catalogue,
  ]),
);

/**
 * The public id for a catalogue model.
 *
 * An unmapped model gets a hashed id rather than its catalogue path. A new
 * model must never leak its provider just because somebody forgot this table —
 * the failure mode has to be an ugly id, not a disclosure.
 */
export function publicModelId(catalogueId: string): string {
  const mapped = PUBLIC_IDS[catalogueId];
  if (mapped) return mapped;

  let hash = 0;
  for (let i = 0; i < catalogueId.length; i++) {
    hash = (hash * 31 + catalogueId.charCodeAt(i)) >>> 0;
  }
  return `model-${hash.toString(36)}`;
}

/** The catalogue id behind a public one, or null. Server use only. */
export function catalogueModelId(publicId: string): string | null {
  return CATALOGUE_IDS[publicId] ?? null;
}

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
export function toPublicModel(model: StudioModel): PublicStudioModel {
  const { audio, audioNote } = audioCapabilityOf(model.id, model.modality);

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
  };
}
