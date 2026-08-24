import type { Compatibility } from "@/services/ai/brief-routing";
import type { ImageBrief } from "@/services/ai/image-brief";
import {
  IMAGE_MODEL_CAPABILITIES,
  creditsForImage,
  type ImageModelCapability,
  type ImageResolution,
} from "@/services/ai/image-capabilities";

/**
 * Which image models can actually make this brief.
 *
 * The video counterpart is `brief-routing.ts` and the reasoning is identical:
 * a mismatch that is known before submission must be a refusal, not a note next
 * to a working button. What is new here is that the mismatches are mostly about
 * *size and shape* rather than duration and audio — the benchmark's gap was a
 * 1024x1024 square where the brief wanted a cinematic 2K wide, and every part of
 * that was knowable from the schema.
 */

export interface ImageRoutingVerdict {
  model: ImageModelCapability;
  compatibility: Compatibility;
  /** What this model cannot do. Plain sentences, shown to the user. */
  conflicts: string[];
  /** What it can do, but worse than asked. */
  caveats: string[];
  /** The resolution it would actually render. */
  effectiveResolution: ImageResolution;
  /** Null when the model cannot be priced, which blocks submission. */
  credits: number | null;
  estimatedSeconds: number;
}

/** Rank order for "bigger than". */
const SIZE_ORDER: ImageResolution[] = ["1K", "2K", "4K"];

export function assessImageModel(
  brief: ImageBrief,
  model: ImageModelCapability,
): ImageRoutingVerdict {
  const conflicts: string[] = [];
  const caveats: string[] = [];

  if (!model.enabled) {
    conflicts.push(
      model.disabledReason ?? `${model.label} is not currently available.`,
    );
  }

  // --- size --------------------------------------------------------------
  const wanted = brief.resolution.value;
  let effectiveResolution = wanted;

  if (!model.resolutions.includes(wanted)) {
    const best = model.resolutions
      .slice()
      .sort((a, b) => SIZE_ORDER.indexOf(b) - SIZE_ORDER.indexOf(a))[0];
    effectiveResolution = best;

    const asked = SIZE_ORDER.indexOf(wanted);
    const gets = SIZE_ORDER.indexOf(best);
    if (gets < asked) {
      /**
       * A caveat rather than a conflict when the user only defaulted into 2K,
       * and a conflict when they chose it. Blocking a Draft generation because
       * the *default* was 2K would make the cheap tier unreachable.
       */
      const line = `${model.label} renders ${model.pixelsFor[best]}, not ${wanted}`;
      if (
        brief.resolution.from === "explicit" ||
        brief.resolution.from === "confirmed"
      ) {
        conflicts.push(`${line} — and you asked for ${wanted}`);
      } else {
        caveats.push(line);
      }
    }
  }

  // --- shape -------------------------------------------------------------
  if (!model.aspectRatios.includes(brief.aspectRatio.value)) {
    conflicts.push(`${model.label} cannot render ${brief.aspectRatio.value}`);
  }

  // --- references --------------------------------------------------------
  const refs = brief.references.value;
  if (refs.count > 0) {
    if (!model.acceptsReferenceImages) {
      conflicts.push(
        `${model.label} has no image input — it would draw a new picture rather than using yours`,
      );
    } else {
      if (refs.count > model.maxReferenceImages) {
        caveats.push(
          `${model.label} uses ${model.maxReferenceImages} of your ${refs.count} references`,
        );
      }
      if (refs.use === "preserve_exactly" && !model.preservesSubjectIdentity) {
        conflicts.push(
          `${model.label} uses a reference as a starting image; it cannot keep your subject identical`,
        );
      }
    }
  }

  // --- exclusions --------------------------------------------------------
  if (brief.exclusions.value.length > 0 && !model.supportsNegativePrompt) {
    // Not a conflict: the compiler states them in the prompt instead. But the
    // user should know they are a request rather than a guarantee.
    caveats.push(
      `${model.label} has no negative prompt, so exclusions are asked for in words rather than enforced`,
    );
  }

  // --- short prompts -----------------------------------------------------
  if (brief.overallConfidence < 0.6 && !model.interpretsShortPrompts) {
    caveats.push(
      `${model.label} follows keywords rather than reasoning about a short prompt — a fuller description helps it`,
    );
  }

  const credits = creditsForImage(model, effectiveResolution);
  if (credits === null && conflicts.length === 0) {
    conflicts.push(`${model.label} has no price, so it cannot be run`);
  }

  const compatibility: Compatibility =
    conflicts.length > 0
      ? "incompatible"
      : caveats.length > 0
        ? "partial"
        : "compatible";

  return {
    model,
    compatibility,
    conflicts,
    caveats,
    effectiveResolution,
    credits,
    estimatedSeconds: model.estimatedSeconds,
  };
}

export interface ImageRecommendation {
  verdicts: ImageRoutingVerdict[];
  recommended: ImageRoutingVerdict | null;
  /** Requirements no available model can meet at all. */
  blockingRequirements: string[];
}

/**
 * Rank the catalogue for this brief.
 *
 * Compatible before partial, then cheapest. Cheapest-of-the-adequate rather
 * than best-of-everything: a user who asked for a picture of a dragon has not
 * asked to spend 160 credits, and a default that quietly picks the most
 * expensive capable model is a pricing decision disguised as a recommendation.
 */
export function recommendImageModels(brief: ImageBrief): ImageRecommendation {
  const verdicts = IMAGE_MODEL_CAPABILITIES.filter((m) => m.enabled).map((m) =>
    assessImageModel(brief, m),
  );

  const usable = verdicts
    .filter((v) => v.compatibility !== "incompatible" && v.credits !== null)
    .sort((a, b) => {
      if (a.compatibility !== b.compatibility) {
        return a.compatibility === "compatible" ? -1 : 1;
      }
      return (a.credits ?? Infinity) - (b.credits ?? Infinity);
    });

  const blockingRequirements =
    usable.length === 0
      ? [...new Set(verdicts.flatMap((v) => v.conflicts))]
      : [];

  return {
    verdicts,
    recommended: usable[0] ?? null,
    blockingRequirements,
  };
}
