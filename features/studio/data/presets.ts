import type { PromptTemplate, StylePreset } from "@/features/studio/types";

/**
 * Style presets, camera language and prompt templates.
 *
 * ## Presets are visible text, not hidden magic
 *
 * Each preset carries a `fragment` that is appended to the prompt, and the
 * composer shows the assembled result before submitting. Products that quietly
 * inject styling text produce a specific and infuriating failure: the user
 * cannot work out why their prompt behaves differently from the same prompt
 * typed elsewhere, and has no way to remove the part they dislike.
 *
 * Being able to read the final prompt is also how someone learns to write
 * prompts, which is most of the value of a tool like this.
 */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "cinematic",
    name: "Cinematic",
    fragment:
      "cinematic lighting, anamorphic, shallow depth of field, film grain",
    hue: 262,
  },
  {
    id: "editorial",
    name: "Editorial",
    fragment: "editorial photography, soft key light, neutral colour science",
    hue: 25,
  },
  {
    id: "product",
    name: "Product",
    fragment:
      "studio product photography, seamless backdrop, controlled reflections",
    hue: 303,
  },
  {
    id: "illustration",
    name: "Illustration",
    fragment: "flat vector illustration, clean geometry, limited palette",
    hue: 162,
  },
  {
    id: "isometric",
    name: "Isometric",
    fragment: "isometric projection, orthographic, consistent light angle",
    hue: 190,
  },
  {
    id: "analog",
    name: "Analog",
    fragment: "35mm film, halation, subtle chromatic aberration",
    hue: 45,
  },
  {
    id: "noir",
    name: "Noir",
    fragment: "high contrast monochrome, hard shadows, single source light",
    hue: 280,
  },
  {
    id: "dreamlike",
    name: "Dreamlike",
    fragment: "soft focus, bloom, pastel haze, ethereal",
    hue: 328,
  },
];

/**
 * Camera controls.
 *
 * Four axes photographers already think in. Every value is a phrase appended to
 * the prompt — the same "no hidden text" rule as presets.
 *
 * Grouping them separately from style presets is not cosmetic: shot and lens are
 * compositional decisions, whereas style is a look. Mixing them into one chip
 * cloud makes both harder to reason about.
 */
export const CAMERA_OPTIONS = {
  shot: {
    label: "Shot",
    values: [
      "extreme close-up",
      "close-up",
      "medium shot",
      "wide shot",
      "establishing shot",
      "macro",
    ],
  },
  angle: {
    label: "Angle",
    values: [
      "eye level",
      "low angle",
      "high angle",
      "overhead",
      "dutch angle",
      "over the shoulder",
    ],
  },
  lens: {
    label: "Lens",
    values: [
      "14mm ultra-wide",
      "35mm",
      "50mm",
      "85mm portrait",
      "135mm telephoto",
      "tilt-shift",
    ],
  },
  lighting: {
    label: "Lighting",
    values: [
      "golden hour",
      "blue hour",
      "hard sunlight",
      "overcast",
      "rim light",
      "practical neon",
      "candlelit",
    ],
  },
} as const;

export type CameraAxis = keyof typeof CAMERA_OPTIONS;

/**
 * Prompt templates.
 *
 * Starting points, not rails — loading one fills the composer and everything
 * stays editable. The value is not the exact wording; it is showing someone who
 * has never written a prompt what a *complete* one looks like, including the
 * negative prompt they would not have thought to write.
 */
export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "product-marble",
    name: "Product on marble",
    category: "Commercial",
    prompt:
      "A matte ceramic bottle standing on a polished marble surface, soft window light from the left, subtle reflection, neutral background",
    negativePrompt: "text, watermark, cluttered background, harsh shadows",
    presetIds: ["product"],
  },
  {
    id: "cinematic-street",
    name: "Cinematic street",
    category: "Film",
    prompt:
      "A rain-slicked city street at night, neon signage reflected in the puddles, steam rising from a vent, a single figure walking away from camera",
    negativePrompt: "daylight, crowds, text, distorted faces",
    presetIds: ["cinematic", "noir"],
  },
  {
    id: "editorial-portrait",
    name: "Editorial portrait",
    category: "Photography",
    prompt:
      "Head and shoulders portrait against a seamless grey backdrop, soft key light slightly above eye level, subtle rim separation, natural skin texture",
    negativePrompt: "over-smoothed skin, heavy retouching, harsh flash",
    presetIds: ["editorial"],
  },
  {
    id: "isometric-scene",
    name: "Isometric scene",
    category: "Illustration",
    prompt:
      "An isometric cutaway of a small workshop, tools on pegboard, warm interior light, muted palette, clean line work",
    negativePrompt: "perspective distortion, photorealism, clutter",
    presetIds: ["isometric", "illustration"],
  },
  {
    id: "landscape-golden",
    name: "Landscape, golden hour",
    category: "Nature",
    prompt:
      "A wide valley at golden hour, long shadows across the grass, layered ridgelines fading into haze, high dynamic range",
    negativePrompt: "oversaturated, HDR halos, people, buildings",
    presetIds: ["cinematic"],
  },
  {
    id: "texture-study",
    name: "Texture study",
    category: "Abstract",
    prompt:
      "Extreme macro of oxidised copper, fine patina detail, raking light revealing surface relief, shallow focus",
    negativePrompt: "text, symmetry, plastic sheen",
    presetIds: ["analog"],
  },
];

/** Human labels for aspect ratios, so "3:2" reads as something. */
export const ASPECT_RATIO_LABELS: Record<string, string> = {
  "1:1": "Square",
  "4:3": "Standard",
  "3:4": "Portrait",
  "16:9": "Widescreen",
  "9:16": "Vertical",
  "3:2": "Photo",
  "2:3": "Photo tall",
};
