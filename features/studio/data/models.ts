import type { StudioModel } from "@/features/studio/types";

/**
 * Model helpers.
 *
 * The **catalog is gone**. Until Sprint 6 this file held a hard-coded list of
 * fictional models so the interface had something to render; models now come
 * from `services/ai/registry` over the API and live in the studio store.
 *
 * What remains here is arithmetic that has no business being duplicated in four
 * components.
 */

/** A safe fallback so the composer can render before models have loaded. */
export const PLACEHOLDER_MODEL: StudioModel = {
  id: "",
  providerId: "",
  providerName: "",
  displayName: "Loading models…",
  description: "",
  modality: "IMAGE",
  creditCost: 0,
  typicalSeconds: 0,
  capabilities: {
    supportsNegativePrompt: false,
    supportsImageInput: false,
    supportsSeed: false,
    aspectRatios: ["1:1"],
    maxOutputs: 1,
    operations: ["text-to-image"],
  },
};

export function findModelIn(models: StudioModel[], id: string): StudioModel {
  return (
    models.find((model) => model.id === id) ?? models[0] ?? PLACEHOLDER_MODEL
  );
}

/**
 * Resolution options for a model.
 *
 * Capped by modality rather than per model: video at 2048px is a request no
 * provider would accept, and offering it only to reject it later wastes the
 * user's time and their credits.
 */
export function resolutionOptions(model: StudioModel): number[] {
  return model.modality === "VIDEO"
    ? [720, 1080]
    : [512, 768, 1024, 1536, 2048];
}

/**
 * Pixel dimensions for an aspect ratio at a given longest edge.
 *
 * Rounded to a multiple of 8 because diffusion models operate on latents at
 * 1/8 scale — an odd dimension is silently rounded by the provider, and the
 * returned image then does not match what the interface promised.
 */
export function dimensionsFor(
  aspectRatio: string,
  longestEdge: number,
): { width: number; height: number } {
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!w || !h) return { width: longestEdge, height: longestEdge };

  const round8 = (n: number) => Math.max(8, Math.round(n / 8) * 8);

  return w >= h
    ? { width: round8(longestEdge), height: round8((longestEdge * h) / w) }
    : { width: round8((longestEdge * w) / h), height: round8(longestEdge) };
}
