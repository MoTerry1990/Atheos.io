/**
 * What the image models actually accept, and what they actually cost.
 *
 * ## Why this file exists
 *
 * The benchmark image (`atheos-snbmi8-…`) was 1024x1024 from `flux-dev` at
 * `aspect_ratio: "1:1"` — 1.05 megapixels. The Gemini comparison was 2816x1536,
 * 4.33 megapixels, cinematic. That is a 4.1x pixel gap before a single word of
 * the prompt is considered, and no part of the studio could have closed it:
 * there was no image capability table at all, so nothing could say "this model
 * tops out at one megapixel and the brief asked for a cinematic wide".
 *
 * The video side has had `brief-routing.ts` since the sequence sprint. This is
 * its image counterpart, and it exists for the same reason: a warning next to a
 * working button is not a refusal.
 *
 * ## Every field here was read from the live schema
 *
 * Not from documentation, not from a model card, and not from the slug. The
 * audit fetched `GET /v1/models/{owner}/{name}` for each entry and read
 * `latest_version.openapi_schema`. Where a capability is absent from the schema
 * it is `false` here, however plausible the marketing is — `nano-banana-2` is
 * described everywhere as a reasoning model and its Replicate schema has no
 * thinking parameter, so Atheos cannot sell one.
 *
 * ## Prices are per-resolution, because the providers price that way
 *
 * A single `creditCost` per model would be a lie the moment a user picks 4K.
 * `creditsFor()` takes the resolution because the invoice does.
 */

/** Resolutions the product offers. Not every model offers every one. */
export type ImageResolution = "1K" | "2K" | "4K";

export type ImageAspectRatio =
  | "1:1"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3"
  | "21:9"
  | "4:5"
  | "5:4";

/** The customer-facing tier. Provider identifiers stay server-side. */
export type ImageTier = "draft" | "smart" | "pro";

export interface ImageModelCapability {
  /** Atheos catalogue id. The provider slug is `providerModel`. */
  id: string;
  /** Customer-facing name. Never a provider slug. */
  label: string;
  tier: ImageTier;
  /** The real model, server authority only. */
  providerModel: string;

  /** Resolutions the schema's `resolution` enum actually offers. */
  resolutions: readonly ImageResolution[];
  /** What Atheos asks for when the user has not chosen. */
  defaultResolution: ImageResolution;
  /** Approximate long edge, for explaining "2K" to a person. */
  pixelsFor: Readonly<Record<ImageResolution, string>>;

  aspectRatios: readonly ImageAspectRatio[];

  /** Whether the schema has an image input at all. */
  acceptsReferenceImages: boolean;
  /** How many, from the schema's own documentation. Zero when unsupported. */
  maxReferenceImages: number;
  /**
   * Whether the model is documented to hold a subject's identity across
   * reference images. Distinct from merely accepting one.
   */
  preservesSubjectIdentity: boolean;

  /** `negative_prompt` in the schema. Absent on every model audited here. */
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  /** More than one image per run. Absent on the Google models. */
  maxOutputs: number;

  /**
   * Whether the model reasons about a short prompt rather than pattern-matching
   * keywords. Product claim, from the model's own description — flagged as such
   * in `PROVENANCE` below, not presented as a schema fact.
   */
  interpretsShortPrompts: boolean;

  /** Provider cost per output image, micro-USD, by resolution. */
  costMicroUsdByResolution: Readonly<Partial<Record<ImageResolution, number>>>;
  /** Credits charged, by resolution. */
  creditsByResolution: Readonly<Partial<Record<ImageResolution, number>>>;

  estimatedSeconds: number;

  /**
   * Whether Atheos may run it.
   *
   * `false` is not "coming soon" — it means the model is audited and
   * deliberately not sold. `flux-2-pro` is the case in point.
   */
  enabled: boolean;
  /** Why, when disabled. Sits next to the decision rather than in a commit. */
  disabledReason?: string;
}

/**
 * Where each claim came from.
 *
 * Phase 2 of the brief required verified provider facts, Atheos product
 * decisions and unverified assumptions to be separable. Keeping the separation
 * in a comment would not survive a year, so it is data.
 */
export const CAPABILITY_PROVENANCE = {
  schema:
    "Read from GET /v1/models/{owner}/{name} -> latest_version.openapi_schema on 2026-08-24.",
  pricing:
    "Read from the model's published pricing panel on replicate.com on 2026-08-24.",
  product:
    "An Atheos decision, not a provider fact: tier names, defaults, credit prices and which models are sold.",
  unverified:
    "Claimed by the provider's description and NOT checked by Atheos against output.",
} as const;

/**
 * The audited image catalogue.
 *
 * Ordered cheapest first. `tests/unit/image-capabilities.test.ts` checks every
 * enabled entry clears the margin floor.
 */
export const IMAGE_MODEL_CAPABILITIES: readonly ImageModelCapability[] = [
  {
    id: "replicate/flux-schnell",
    label: "Draft Image",
    tier: "draft",
    providerModel: "black-forest-labs/flux-schnell",
    // Schema has `megapixels`, whose enum the audit recorded as the 1MP class.
    // Draft is deliberately pinned to 1K regardless: it is the cheap tier and
    // its whole purpose is to be cheap.
    resolutions: ["1K"],
    defaultResolution: "1K",
    pixelsFor: { "1K": "about 1024x1024", "2K": "—", "4K": "—" },
    aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    acceptsReferenceImages: false,
    maxReferenceImages: 0,
    preservesSubjectIdentity: false,
    supportsNegativePrompt: false,
    supportsSeed: true,
    maxOutputs: 4,
    interpretsShortPrompts: false,
    costMicroUsdByResolution: { "1K": 3_000 },
    creditsByResolution: { "1K": 4 },
    estimatedSeconds: 6,
    enabled: true,
  },
  {
    id: "replicate/flux-dev",
    label: "Draft Image Plus",
    tier: "draft",
    providerModel: "black-forest-labs/flux-dev",
    resolutions: ["1K"],
    defaultResolution: "1K",
    pixelsFor: { "1K": "about 1024x1024", "2K": "—", "4K": "—" },
    aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
    // Schema has `image` + `prompt_strength` — image-to-image, which is not the
    // same as holding a character's identity across a new scene.
    acceptsReferenceImages: true,
    maxReferenceImages: 1,
    preservesSubjectIdentity: false,
    supportsNegativePrompt: false,
    supportsSeed: true,
    maxOutputs: 4,
    interpretsShortPrompts: false,
    costMicroUsdByResolution: { "1K": 25_000 },
    creditsByResolution: { "1K": 13 },
    estimatedSeconds: 10,
    enabled: true,
  },
  {
    id: "replicate/nano-banana-2",
    label: "Smart Image",
    tier: "smart",
    providerModel: "google/nano-banana-2",
    resolutions: ["1K", "2K", "4K"],
    // The provider default is 1K. Atheos defaults to 2K because 1K against a
    // cinematic brief is exactly the gap the benchmark measured.
    defaultResolution: "2K",
    pixelsFor: {
      "1K": "about 1024px on the long edge",
      "2K": "about 2048px on the long edge",
      "4K": "about 4096px on the long edge",
    },
    aspectRatios: [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9",
      "4:5",
      "5:4",
    ],
    acceptsReferenceImages: true,
    // "supports up to 14 images", from the schema's own field description.
    maxReferenceImages: 14,
    preservesSubjectIdentity: true,
    supportsNegativePrompt: false,
    supportsSeed: false,
    maxOutputs: 1,
    interpretsShortPrompts: true,
    costMicroUsdByResolution: { "1K": 67_000, "2K": 101_000, "4K": 151_000 },
    // 2.5x floor on the audited cost, rounded up to a round number:
    //   1K  35cr = $0.175 / $0.067 = 2.61x
    //   2K  55cr = $0.275 / $0.101 = 2.72x
    //   4K  80cr = $0.400 / $0.151 = 2.65x
    creditsByResolution: { "1K": 35, "2K": 55, "4K": 80 },
    estimatedSeconds: 20,
    enabled: true,
  },
  {
    id: "replicate/nano-banana-pro",
    label: "Pro Image",
    tier: "pro",
    providerModel: "google/nano-banana-pro",
    resolutions: ["1K", "2K", "4K"],
    defaultResolution: "2K",
    pixelsFor: {
      "1K": "about 1024px on the long edge",
      "2K": "about 2048px on the long edge",
      "4K": "about 4096px on the long edge",
    },
    aspectRatios: [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9",
      "4:5",
      "5:4",
    ],
    acceptsReferenceImages: true,
    maxReferenceImages: 14,
    preservesSubjectIdentity: true,
    supportsNegativePrompt: false,
    supportsSeed: false,
    maxOutputs: 1,
    interpretsShortPrompts: true,
    // 1K and 2K cost the same on this model — the provider's own table.
    costMicroUsdByResolution: { "1K": 150_000, "2K": 150_000, "4K": 300_000 },
    //   1K/2K 80cr  = $0.40 / $0.15 = 2.67x
    //   4K   160cr  = $0.80 / $0.30 = 2.67x
    creditsByResolution: { "1K": 80, "2K": 80, "4K": 160 },
    estimatedSeconds: 35,
    enabled: true,
  },
  {
    id: "replicate/flux-2-pro",
    label: "Studio Image",
    tier: "pro",
    providerModel: "black-forest-labs/flux-2-pro",
    resolutions: ["1K", "2K", "4K"],
    defaultResolution: "2K",
    pixelsFor: {
      "1K": "1 MP",
      "2K": "2 MP",
      "4K": "4 MP",
    },
    aspectRatios: [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "4:5",
      "5:4",
    ],
    acceptsReferenceImages: true,
    maxReferenceImages: 4,
    preservesSubjectIdentity: false,
    supportsNegativePrompt: false,
    supportsSeed: true,
    maxOutputs: 1,
    interpretsShortPrompts: false,
    // $0.015 per run + $0.015 per output megapixel. Recorded for the audit even
    // though the model is not sold.
    costMicroUsdByResolution: { "1K": 30_000, "2K": 45_000, "4K": 75_000 },
    creditsByResolution: {},
    estimatedSeconds: 15,
    enabled: false,
    /**
     * Audited and deliberately not sold.
     *
     * Its price is `$0.015/run + $0.015 per *input* megapixel + $0.015 per
     * output megapixel`. The input term is chosen by the customer — four 4MP
     * references add $0.24 to a job quoted from the output size alone. A flat
     * credit price for it would be a guess, and the brief's rule is that an
     * unknown cost cannot be sold. Enabling it needs a quote that reads the
     * reference sizes first.
     */
    disabledReason:
      "Cost includes a per-input-megapixel term the customer controls; a flat credit price would be a guess.",
  },
];

export function findImageModel(id: string): ImageModelCapability | undefined {
  return IMAGE_MODEL_CAPABILITIES.find((m) => m.id === id);
}

/**
 * What a generation costs the customer.
 *
 * Returns null when the model does not offer that resolution or carries no
 * price — a null quote blocks the submission rather than defaulting to a
 * number, because a defaulted price is how a model gets sold below cost.
 */
export function creditsForImage(
  model: ImageModelCapability,
  resolution: ImageResolution,
  outputs = 1,
): number | null {
  if (!model.enabled) return null;
  const per = model.creditsByResolution[resolution];
  if (per === undefined) return null;
  return per * Math.max(1, Math.min(outputs, model.maxOutputs));
}

/** Provider cost, for the margin test and for internal reporting only. */
export function providerCostMicroUsd(
  model: ImageModelCapability,
  resolution: ImageResolution,
  outputs = 1,
): number | null {
  const per = model.costMicroUsdByResolution[resolution];
  if (per === undefined) return null;
  return per * Math.max(1, Math.min(outputs, model.maxOutputs));
}
