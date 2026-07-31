import type { StudioModel } from "@/features/studio/types";

/**
 * The model catalog.
 *
 * ## These are placeholders, and the names are deliberately invented
 *
 * No AI provider is connected — that is Sprint 6. Naming real vendors and real
 * models here would put claims in the interface that the product cannot honour:
 * a user reading "GPT Image" would reasonably expect that model, and we would be
 * advertising an integration that does not exist.
 *
 * So the models are fictional and obviously so. The **shapes** are real: each
 * one declares capabilities in the `ModelCapabilities` contract from Sprint 0,
 * and the composer renders itself from those declarations. Swapping this array
 * for a provider-backed `listModels()` call changes no component.
 *
 * ## Capabilities are the point
 *
 * This is where the provider abstraction stops being theoretical. The composer
 * does not know that "Lumen" is an image model — it knows the selected model
 * reports `supportsNegativePrompt: false`, and hides that field. A real catalog
 * with genuinely different capabilities exercises that logic; a uniform one
 * would let capability bugs hide until the second provider was added.
 */
export const STUDIO_MODELS: StudioModel[] = [
  {
    id: "lumen-1",
    providerId: "placeholder",
    providerName: "Placeholder",
    displayName: "Lumen 1",
    description:
      "General-purpose image model. Balanced speed and fidelity, strong at lighting.",
    modality: "IMAGE",
    creditCost: 8,
    typicalSeconds: 12,
    badge: "fastest",
    capabilities: {
      supportsNegativePrompt: true,
      supportsImageInput: true,
      supportsSeed: true,
      aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"],
      maxOutputs: 4,
    },
  },
  {
    id: "lumen-1-hd",
    providerId: "placeholder",
    providerName: "Placeholder",
    displayName: "Lumen 1 HD",
    description:
      "Higher resolution and finer detail. Slower, and noticeably better on texture.",
    modality: "IMAGE",
    creditCost: 20,
    typicalSeconds: 38,
    badge: "highest-quality",
    capabilities: {
      supportsNegativePrompt: true,
      supportsImageInput: true,
      supportsSeed: true,
      aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
      maxOutputs: 2,
    },
  },
  {
    id: "atlas-mini",
    providerId: "placeholder",
    providerName: "Placeholder",
    displayName: "Atlas Mini",
    description:
      "Fast drafts for exploring composition. No negative prompt support.",
    modality: "IMAGE",
    creditCost: 3,
    typicalSeconds: 5,
    capabilities: {
      // Deliberately different. The composer must hide the negative prompt for
      // this model, which is the behaviour worth having a test case for.
      supportsNegativePrompt: false,
      supportsImageInput: false,
      supportsSeed: true,
      aspectRatios: ["1:1", "16:9", "9:16"],
      maxOutputs: 4,
    },
  },
  {
    id: "helix-motion",
    providerId: "placeholder",
    providerName: "Placeholder",
    displayName: "Helix Motion",
    description:
      "Short video from a prompt or a still. Minutes, not seconds — plan for it.",
    modality: "VIDEO",
    creditCost: 60,
    typicalSeconds: 210,
    badge: "new",
    capabilities: {
      supportsNegativePrompt: true,
      supportsImageInput: true,
      // No seed: this model does not expose one, so the control disappears
      // rather than being shown and quietly ignored.
      supportsSeed: false,
      aspectRatios: ["16:9", "9:16", "1:1"],
      maxOutputs: 1,
      maxDurationSeconds: 10,
    },
  },
];

export const DEFAULT_MODEL_ID = STUDIO_MODELS[0].id;

export function findModel(id: string): StudioModel {
  return STUDIO_MODELS.find((model) => model.id === id) ?? STUDIO_MODELS[0];
}

/**
 * Resolution options for a model.
 *
 * Capped by modality rather than by a per-model list: video at 2048px is a
 * request no provider would accept, and offering it only to reject it later
 * wastes the user's time and their credits.
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
