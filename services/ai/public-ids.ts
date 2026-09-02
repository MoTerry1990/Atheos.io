import "server-only";

/**
 * The public identity of a model: its id and its name.
 *
 * ## Why this is in `services/` and not beside the studio DTO
 *
 * It started in `features/studio/lib`, which was right while only the studio
 * used it. Then `services/sequences` needed to resolve a public id too — and
 * a `services/` module importing from `features/` is the dependency rule
 * running backwards, which is how a foundation turns into a ball of mud.
 *
 * The mapping is the more fundamental thing anyway. It is the boundary
 * between what Atheos calls a model internally and what the world is allowed
 * to call it, and everything above this layer depends on it rather than the
 * other way round.
 *
 * ## The two leaks it closes
 *
 * The catalogue path names the vendor: `replicate/flux-schnell` says who runs
 * the job and which weights do it. So does the adapter's `displayName` —
 * "FLUX Schnell" is exactly as identifying as the path. Both are replaced,
 * and an unmapped model gets a hashed id and a neutral label rather than
 * whatever the adapter happened to call it.
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
  "google/omni-1.1-flash": "cinematic-next",
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
  "google/omni-1.1-flash": "Cinematic Next",
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
