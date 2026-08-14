import type { StudioModel, StudioParams } from "@/features/studio/types";
import type { GenerationOperation } from "@/services/ai/types";

/**
 * Which operation the composer's current state describes.
 *
 * ## Derived, not chosen
 *
 * There is no "mode" control in the studio, and that is deliberate. Sprint 6
 * hard-coded `text-to-image` here, which worked while there was one thing to do;
 * with video there are four, and the obvious fix — a tab bar of operations —
 * asks the user to state something the interface already knows. They picked a
 * video model; they attached a reference or they did not. Those two facts
 * determine the operation completely.
 *
 * ## Capability wins over intent
 *
 * A model that declares only `text-to-video` gets `text-to-video` even with a
 * reference attached. Sending an operation the model does not support would be
 * rejected by the adapter *after* the request left the browser, so the fallback
 * happens here where the interface can still be honest about it — see
 * `operationNote` below, which the composer shows.
 */
export function operationFor(
  model: StudioModel,
  params: StudioParams,
): GenerationOperation {
  const supported = model.capabilities.operations;
  const hasReference = params.references.length > 0;
  const video = model.modality === "VIDEO";

  // Audio has exactly one operation and no reference-image variant, so the
  // branching below — which is entirely about whether a reference was
  // attached — has nothing to decide. Handled first rather than folded into
  // the ternary, where it would read as an afterthought and fall through to
  // "text-to-image" on any future model that lists more than one operation.
  if (model.modality === "AUDIO") return "text-to-audio";

  const preferred: GenerationOperation = video
    ? hasReference
      ? "image-to-video"
      : "text-to-video"
    : hasReference
      ? "image-to-image"
      : "text-to-image";

  if (supported.includes(preferred)) return preferred;

  // Fall back to the model's plain generation operation, then to whatever it
  // does support. `[0]` is not arbitrary — adapters list the operation a model
  // is primarily for first.
  const base: GenerationOperation = video ? "text-to-video" : "text-to-image";
  if (supported.includes(base)) return base;

  return supported[0] ?? "text-to-image";
}

/** Human label for an operation. Used in the composer and in history. */
export const OPERATION_LABELS: Record<GenerationOperation, string> = {
  "text-to-image": "Text to image",
  "image-to-image": "Image to image",
  upscale: "Upscale",
  "remove-background": "Background removal",
  variations: "Variations",
  "text-to-video": "Text to video",
  "image-to-video": "Image to video",
  "text-to-audio": "Text to audio",
};

/**
 * A sentence explaining what will happen, when it is not what was asked for.
 *
 * Returns null when the derived operation matches the obvious reading of the
 * composer — most of the time. It is non-null exactly in the case that would
 * otherwise be a silent surprise: a reference is attached and the model is
 * going to ignore it.
 */
export function operationNote(
  model: StudioModel,
  params: StudioParams,
): string | null {
  const operation = operationFor(model, params);
  const usesReference =
    operation === "image-to-image" || operation === "image-to-video";

  if (params.references.length > 0 && !usesReference) {
    return `${model.displayName} cannot start from an image, so your reference will not be used.`;
  }

  return null;
}
