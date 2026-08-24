import type { CompiledRequest } from "@/services/ai/compile-for-model";
import type { ImageBrief } from "@/services/ai/image-brief";
import {
  type ImageModelCapability,
  type ImageResolution,
} from "@/services/ai/image-capabilities";

/**
 * One confirmed brief, compiled differently for each image model.
 *
 * ## Why a compiler rather than a prompt string
 *
 * The benchmark generation submitted this:
 *
 *   "a red dragon on a castle throwing fire from its mouth, cinematic lighting,
 *    anamorphic, shallow depth of field, film grain, high-contrast monochrome,
 *    hard shadows, single-source light, cinematic lighting, anamorphic, shallow
 *    depth of field, film grain, high contrast monochrome, hard shadows,
 *    single source light"
 *
 * Two style blocks, duplicated, one of them ordering **monochrome** for a
 * subject the user had described as *red*. Nothing assembled that on purpose:
 * `assemblePrompt()` concatenated the composer's preset fragments onto a prompt
 * that already contained style words, and no layer compared the result against
 * what the user asked for.
 *
 * A compiler makes that structurally impossible. It builds from the confirmed
 * brief's fields, so a style can only enter through a field, and a field that
 * contradicts another is a conflict the panel shows rather than a string the
 * provider receives.
 *
 * ## Each model gets what its schema actually has
 *
 * Every parameter emitted below was read from the live Replicate schema. None
 * of these models has `negative_prompt` — so `negativePrompt` is always empty
 * and exclusions are folded into the prompt text instead, which is the honest
 * way to express them to a model that cannot take them separately.
 */

export const IMAGE_COMPILER_VERSION = 1;

export class ImageCapabilityConflictError extends Error {
  constructor(
    message: string,
    public readonly conflicts: string[],
  ) {
    super(message);
    this.name = "ImageCapabilityConflictError";
  }
}

/** The sentence that carries the composition. Never dropped. */
function spatialLine(brief: ImageBrief): string {
  const rels = brief.spatialRelationships.value;
  if (rels.length === 0) return "";
  // Stated as a requirement rather than a description: "on a castle" as a noun
  // phrase reads as two objects; as an instruction it reads as one arrangement.
  return `The ${subjectNoun(brief)} is physically ${rels.join(", and ")} — in contact with it, not beside it.`;
}

function subjectNoun(brief: ImageBrief): string {
  return brief.primarySubject.value.trim() || "subject";
}

/** Subject with its attributes, once, in front. */
function subjectLine(brief: ImageBrief): string {
  const attrs = brief.subjectAttributes.value;
  const subject = subjectNoun(brief);
  const described = attrs.length ? `${attrs.join(", ")} ${subject}` : subject;
  const action = brief.action.value.trim();
  return action ? `${described}, ${action}` : described;
}

function depthLines(brief: ImageBrief): string[] {
  const out: string[] = [];
  if (brief.middleGround.from !== "default")
    out.push(`Middle ground: ${brief.middleGround.value}.`);
  if (brief.background.from !== "default")
    out.push(`Background: ${brief.background.value}.`);
  if (brief.foreground.from !== "default")
    out.push(`Foreground: ${brief.foreground.value}.`);
  return out;
}

/**
 * Exclusions, in prose.
 *
 * None of the audited image models has a `negative_prompt` input, so an
 * exclusion has exactly one place to go. Saying so in the compiled prompt is
 * honest; sending a `negative_prompt` field the schema does not have is a
 * rejected job on a model that has already reserved credits.
 */
function exclusionLine(brief: ImageBrief): string {
  const ex = brief.exclusions.value;
  return ex.length ? `Do not include: ${ex.join(", ")}.` : "";
}

function textLine(brief: ImageBrief): string {
  const t = brief.textRequirements.value;
  return t.length
    ? `Render this text exactly, spelled correctly: ${t.map((x) => `"${x}"`).join(", ")}.`
    : "";
}

/**
 * The resolution the model will actually be asked for.
 *
 * Downgrades rather than failing when a tier does not offer what the brief
 * wants, and returns what was lost so the panel can say so. A silent downgrade
 * is how a user pays for 4K and receives 1K.
 */
function resolveResolution(
  brief: ImageBrief,
  model: ImageModelCapability,
): { resolution: ImageResolution; omitted: string[] } {
  const wanted = brief.resolution.value;
  if (model.resolutions.includes(wanted))
    return { resolution: wanted, omitted: [] };

  // Best available below what was asked for.
  const order: ImageResolution[] = ["4K", "2K", "1K"];
  const best =
    order.find(
      (r) =>
        model.resolutions.includes(r) &&
        order.indexOf(r) > order.indexOf(wanted),
    ) ?? model.defaultResolution;

  return {
    resolution: best,
    omitted: [
      `${wanted} — ${model.label} renders ${model.resolutions.join(" and ")} only`,
    ],
  };
}

function resolveAspect(
  brief: ImageBrief,
  model: ImageModelCapability,
): { aspectRatio: string; omitted: string[] } {
  const wanted = brief.aspectRatio.value;
  if (model.aspectRatios.includes(wanted))
    return { aspectRatio: wanted, omitted: [] };
  return {
    aspectRatio: "1:1",
    omitted: [`${wanted} — ${model.label} does not offer that shape`],
  };
}

/** Reference handling, checked against the schema rather than assumed. */
function resolveReferences(
  brief: ImageBrief,
  model: ImageModelCapability,
  referenceUrls: readonly string[],
): { urls: string[]; omitted: string[] } {
  if (referenceUrls.length === 0) return { urls: [], omitted: [] };

  if (!model.acceptsReferenceImages) {
    return {
      urls: [],
      omitted: [
        `your ${referenceUrls.length} reference image${referenceUrls.length === 1 ? "" : "s"} — ${model.label} has no image input and would draw a new scene instead`,
      ],
    };
  }

  const kept = referenceUrls.slice(0, model.maxReferenceImages);
  const dropped = referenceUrls.length - kept.length;
  return {
    urls: [...kept],
    omitted:
      dropped > 0
        ? [
            `${dropped} reference image(s) — ${model.label} accepts ${model.maxReferenceImages}`,
          ]
        : [],
  };
}

export interface ImageCompileInput {
  brief: ImageBrief;
  model: ImageModelCapability;
  /** Resolved server-side from owned asset ids. Never client-supplied URLs. */
  referenceUrls?: readonly string[];
  outputs?: number;
}

/**
 * Nano Banana 2 and Nano Banana Pro.
 *
 * Both take a plain prompt plus `aspect_ratio`, `resolution`, `image_input` and
 * `output_format`. Neither takes a seed, a negative prompt, a thinking level or
 * a batch size — the marketing describes a reasoning model and the schema does
 * not expose one, so Atheos does not sell one.
 *
 * The prompt is written as short declarative lines rather than a comma-soup of
 * adjectives: these models read instructions, and the thing the benchmark
 * needed most — "the dragon is *on* the castle" — is an instruction.
 */
function compileNanoBanana(input: ImageCompileInput): CompiledRequest {
  const { brief, model } = input;
  const res = resolveResolution(brief, model);
  const asp = resolveAspect(brief, model);
  const refs = resolveReferences(brief, model, input.referenceUrls ?? []);

  const lines = [
    subjectLine(brief),
    spatialLine(brief),
    brief.setting.value ? `Setting: ${brief.setting.value}.` : "",
    ...depthLines(brief),
    `Composition: ${brief.composition.value}, ${brief.cameraFraming.value}, ${brief.cameraAngle.value}.`,
    `Lighting: ${brief.lighting.value}.`,
    `Colour: ${brief.colorPalette.value}.`,
    brief.mood.from !== "default" ? `Mood: ${brief.mood.value}.` : "",
    `Style: ${brief.realism.value === "photorealistic" ? "photographic realism" : brief.realism.value}, ${brief.lensLook.value}.`,
    textLine(brief),
    exclusionLine(brief),
    refs.urls.length > 0
      ? "Keep the subject in the reference images identical: same colours, same markings, same proportions."
      : "",
  ].filter(Boolean);

  return {
    modelId: model.id,
    compilerVersion: IMAGE_COMPILER_VERSION,
    prompt: lines.join("\n"),
    // Not in the schema. Empty is the only correct value.
    negativePrompt: "",
    parameters: {
      aspect_ratio: asp.aspectRatio,
      resolution: res.resolution,
      output_format: "png",
      ...(refs.urls.length > 0 ? { image_input: refs.urls } : {}),
    },
    omitted: [...res.omitted, ...asp.omitted, ...refs.omitted],
  };
}

/**
 * FLUX Schnell and FLUX Dev.
 *
 * `aspect_ratio`, `megapixels`, `num_outputs`, `seed`, and on Dev an `image`
 * plus `prompt_strength`. No `negative_prompt` on either, and no `resolution` —
 * FLUX sizes by megapixels, so a "2K" brief cannot be honoured here at all.
 *
 * These models read keyword-weighted prompts rather than instructions, so the
 * compilation is comma-separated and front-loads the subject. That is a real
 * difference in how the same brief has to be expressed, and it is the reason
 * per-model compilers exist rather than one shared string.
 */
function compileFlux(input: ImageCompileInput): CompiledRequest {
  const { brief, model } = input;
  const asp = resolveAspect(brief, model);
  const refs = resolveReferences(brief, model, input.referenceUrls ?? []);
  const res = resolveResolution(brief, model);

  const parts = [
    subjectLine(brief),
    // Kept as a clause rather than a separate sentence: FLUX weights early
    // tokens, and the relationship has to sit near the subject to survive.
    brief.spatialRelationships.value.length
      ? `${subjectNoun(brief)} ${brief.spatialRelationships.value.join(" and ")}`
      : "",
    brief.setting.value,
    brief.composition.from !== "default" ? brief.composition.value : "",
    brief.lighting.value,
    brief.colorPalette.value,
    brief.realism.value === "photorealistic"
      ? "photorealistic"
      : brief.realism.value,
    brief.lensLook.from !== "default" ? brief.lensLook.value : "",
  ].filter(Boolean);

  const prompt = [parts.join(", "), textLine(brief), exclusionLine(brief)]
    .filter(Boolean)
    .join(" ");

  return {
    modelId: model.id,
    compilerVersion: IMAGE_COMPILER_VERSION,
    prompt,
    negativePrompt: "",
    parameters: {
      aspect_ratio: asp.aspectRatio,
      megapixels: "1",
      num_outputs: Math.max(1, Math.min(input.outputs ?? 1, model.maxOutputs)),
      output_format: "png",
      ...(refs.urls.length > 0
        ? { image: refs.urls[0], prompt_strength: 0.8 }
        : {}),
    },
    omitted: [
      ...asp.omitted,
      ...refs.omitted,
      // FLUX has no resolution enum at all — say so rather than pretending.
      ...(brief.resolution.value !== "1K"
        ? [
            `${brief.resolution.value} — ${model.label} renders about one megapixel`,
          ]
        : res.omitted),
      ...(refs.urls.length > 0 && !model.preservesSubjectIdentity
        ? [
            `exact subject identity — ${model.label} uses a reference as a starting image, it does not hold a character`,
          ]
        : []),
    ],
  };
}

const COMPILERS: Record<string, (input: ImageCompileInput) => CompiledRequest> =
  {
    "replicate/nano-banana-2": compileNanoBanana,
    "replicate/nano-banana-pro": compileNanoBanana,
    "replicate/flux-schnell": compileFlux,
    "replicate/flux-dev": compileFlux,
  };

/**
 * Compile, or refuse.
 *
 * Refusal is for the things a downgrade cannot honestly cover: a model that is
 * not sold, and a reference-preserving brief handed to a model with no image
 * input. Everything else degrades and reports what it dropped.
 */
export function compileImageForModel(
  input: ImageCompileInput,
): CompiledRequest {
  const { model, brief } = input;

  if (!model.enabled) {
    throw new ImageCapabilityConflictError(`${model.label} is not available.`, [
      model.disabledReason ?? "This model is not currently sold.",
    ]);
  }

  const wantsIdentity =
    (input.referenceUrls?.length ?? 0) > 0 &&
    brief.references.value.use === "preserve_exactly";

  if (wantsIdentity && !model.acceptsReferenceImages) {
    throw new ImageCapabilityConflictError(
      `${model.label} cannot use your reference image.`,
      [
        `${model.label} has no image input, so it would draw a new picture rather than working from yours.`,
      ],
    );
  }

  const compiler = COMPILERS[model.id];
  if (!compiler) {
    throw new ImageCapabilityConflictError(`${model.label} has no compiler.`, [
      "This model is in the catalogue but nothing knows how to build a prompt for it.",
    ]);
  }

  return compiler(input);
}
