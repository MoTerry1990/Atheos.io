import type {
  Provenance,
  ReferenceUse,
  Sourced,
} from "@/services/ai/creative-brief";
import type {
  ImageAspectRatio,
  ImageResolution,
} from "@/services/ai/image-capabilities";

/**
 * The Image Brief — what Atheos understood, before an image is generated.
 *
 * ## Why this is a sibling of CreativeBrief rather than more fields on it
 *
 * The video brief carries shots, cuts, audio strategy and continuity rules;
 * none of them mean anything for a still. Folding both into one type would make
 * every image plan carry a `cutStyle` nobody chose, and — worse — put it inside
 * the hash the plan token signs, so a meaningless field would be part of what
 * the user is held to.
 *
 * They share what actually is shared: `Sourced<T>` and provenance. A value's
 * origin is the thing the confirmation panel exists to show, and it must mean
 * exactly the same for an image as for a clip.
 *
 * ## What the benchmark showed this has to carry
 *
 * `a red dragon on a castle throwing fire from its mouth` produced a 1024x1024
 * square in which the dragon and the castle were separate objects. Nothing in
 * the pipeline had a field for "the dragon is *on* the castle", so nothing could
 * notice the spatial relationship had been dropped, and nothing could tell the
 * user it had been. `spatialRelationships` is that field, and it is why this
 * type is long: each of these was a thing the old path silently had no opinion
 * about.
 */

export const IMAGE_BRIEF_VERSION = 1;

export type ImageRealism = "photorealistic" | "stylised" | "illustrated";

export interface ImageBrief {
  /** Discriminant, so a video brief cannot be submitted as an image plan. */
  kind: "image";
  version: number;
  /** Never modified. Not normalised, not trimmed, not re-cased. */
  originalPrompt: string;

  // --- subject -----------------------------------------------------------
  primarySubject: Sourced<string>;
  /** Colour, size, material, condition — what makes it *this* dragon. */
  subjectAttributes: Sourced<string[]>;
  action: Sourced<string>;
  setting: Sourced<string>;
  /**
   * How the things in the frame stand relative to each other.
   *
   * The benchmark's whole failure in one field: "on a castle" is a relationship,
   * and a model given a bag of nouns will happily place them side by side.
   */
  spatialRelationships: Sourced<string[]>;

  // --- camera and light --------------------------------------------------
  composition: Sourced<string>;
  cameraFraming: Sourced<string>;
  cameraAngle: Sourced<string>;
  lensLook: Sourced<string>;
  lighting: Sourced<string>;
  colorPalette: Sourced<string>;
  mood: Sourced<string>;
  realism: Sourced<ImageRealism>;

  // --- depth -------------------------------------------------------------
  foreground: Sourced<string>;
  middleGround: Sourced<string>;
  background: Sourced<string>;

  // --- output ------------------------------------------------------------
  aspectRatio: Sourced<ImageAspectRatio>;
  resolution: Sourced<ImageResolution>;
  references: Sourced<{ count: number; use: ReferenceUse }>;
  /** Words that must appear *in* the image. Empty means none, which is normal. */
  textRequirements: Sourced<string[]>;
  /** Things the user said they do not want. Never invented. */
  exclusions: Sourced<string[]>;

  /** Fields the user must not have silently overridden. */
  required: readonly (keyof ImageBrief)[];
  /** 0–1 across the brief as a whole. Low means ask questions. */
  overallConfidence: number;
}

/**
 * Anything carrying `Sourced` fields and a `required` list.
 *
 * The provenance helpers work on shape, not on which brief it is — an
 * assumption is an assumption in both. Typed here rather than duplicating the
 * three functions per brief type.
 */
export type AnyBrief = {
  originalPrompt: string;
  required: readonly string[];
  [key: string]: unknown;
};

/** Every value the user did not actually choose. */
export function imageAssumptionsIn(
  brief: ImageBrief,
): { field: string; value: unknown; because: string }[] {
  const out: { field: string; value: unknown; because: string }[] = [];
  for (const [key, entry] of Object.entries(brief)) {
    if (!entry || typeof entry !== "object" || !("from" in entry)) continue;
    const sourced = entry as Sourced<unknown>;
    if (sourced.from === "inferred" || sourced.from === "default") {
      out.push({
        field: key,
        value: sourced.value,
        because: sourced.because ?? "Atheos chose this",
      });
    }
  }
  return out;
}

/** True when every required field is the user's own. */
export function imageBriefConfirmed(brief: ImageBrief): boolean {
  return brief.required.every((field) => {
    const entry = brief[field] as unknown;
    if (!entry || typeof entry !== "object" || !("from" in entry)) return false;
    const from = (entry as Sourced<unknown>).from;
    return from === "explicit" || from === "confirmed" || from === "edited";
  });
}

/** Mark a field as the user's own. Returns a new brief; never mutates. */
export function confirmImageField<K extends keyof ImageBrief>(
  brief: ImageBrief,
  field: K,
  value: ImageBrief[K] extends Sourced<infer V> ? V : never,
  how: Extract<Provenance, "confirmed" | "edited"> = "confirmed",
): ImageBrief {
  const current = brief[field] as unknown as Sourced<unknown>;
  return {
    ...brief,
    [field]: { ...current, value, from: how, confidence: undefined },
  };
}
