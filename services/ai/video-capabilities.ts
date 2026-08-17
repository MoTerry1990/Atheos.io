/**
 * What each video model can actually do — one source of truth.
 *
 * ## Every field here was read from the provider, not from marketing copy
 *
 * The values come from each model's OpenAPI input schema, fetched from
 * `GET /v1/models/{owner}/{name}/versions/{id}` on 2026-08-16. If a capability
 * is not expressible as an input the provider accepts, it is `false` here,
 * however often the vendor's landing page mentions it.
 *
 * Reading the schemas rather than the docs is what produced the two findings
 * this file exists for:
 *
 *  1. **Neither shipped model can produce audio.** Not "we haven't wired it up"
 *     — there is no audio input in either schema. Every video Atheos has
 *     produced is silent by construction, and no amount of UI can change that.
 *  2. **`replicate/video-gen` claims two inputs it does not have.** The
 *     catalogue advertises image input and negative prompt for wan-2.2-t2v-fast
 *     (`services/ai/providers/replicate.ts`). The schema has neither. See
 *     `notes` on that entry.
 *
 * ## Cost lives in `model-costs.ts`, not here
 *
 * A second copy of a price is a second thing to forget to update, and the
 * spending breaker reads the other one. This file answers "can it?"; that file
 * answers "what does it cost?". They join on `id`.
 *
 * ## Frontend and backend read this same object
 *
 * The composer's badges, the validator's rejections and the adapter's request
 * body all derive from these definitions. A hand-maintained parallel list in
 * the UI is exactly how a "Native audio" badge ends up on a model that cannot
 * produce it, so there is no second list.
 */

/** How a model produces sound, if it does. */
export type AudioSupport =
  | "native" // one job returns synchronised video and audio
  | "none"; // no audio input; output is silent

export interface VideoModelCapability {
  /** Catalogue model id — the join key to `model-costs.ts` and the registry. */
  id: string;
  label: string;
  provider: "replicate";
  /** Provider slug, so any claim below can be traced back to its schema. */
  slug: string;

  textToVideo: boolean;
  imageToVideo: boolean;

  audio: AudioSupport;
  /**
   * Narrower audio claims, all false unless the provider exposes a control.
   *
   * Veo 3 takes one `generate_audio` boolean and infers content from the
   * prompt. It can therefore carry dialogue and effects — but it offers no
   * separate channel for either, which is what these flags record. A UI with
   * a "dialogue" slider would be inventing a control.
   */
  dialogueDirection: boolean;
  sfxDirection: boolean;
  ambienceDirection: boolean;
  musicDirection: boolean;
  /** Can the caller ask an audio-capable model for a silent result? */
  silentOption: boolean;

  /** One job returning several distinct shots. Not verified on any model. */
  multiShot: boolean;
  startFrame: boolean;
  endFrame: boolean;
  referenceImages: boolean;
  referenceVideo: boolean;
  /** A first-class identity/character lock, not "pass the same seed". */
  characterConsistency: boolean;
  videoExtension: boolean;
  cameraControl: boolean;
  negativePrompt: boolean;
  seed: boolean;

  /**
   * Accepted values, exactly as the schema states them.
   *
   * An empty array means the input is not offered at all — which is a
   * different claim from "offered with one option", and the composer renders
   * the two differently.
   */
  durationsSeconds: readonly number[];
  resolutions: readonly string[];
  aspectRatios: readonly string[];

  /** Is this wired into the product today? */
  available: boolean;
  /** ISO date the provider schema was last read. */
  verifiedAt: string;
  /** What a reader should know before trusting the row. */
  notes: string;
}

export const VIDEO_CAPABILITIES: readonly VideoModelCapability[] = [
  {
    id: "replicate/video-gen",
    label: "Motion 1",
    provider: "replicate",
    slug: "wan-video/wan-2.2-t2v-fast",
    // Text-to-video only. The `t2v` in the slug is the whole story.
    textToVideo: true,
    imageToVideo: false,
    audio: "none",
    dialogueDirection: false,
    sfxDirection: false,
    ambienceDirection: false,
    musicDirection: false,
    silentOption: false,
    multiShot: false,
    startFrame: false,
    endFrame: false,
    referenceImages: false,
    referenceVideo: false,
    characterConsistency: false,
    videoExtension: false,
    cameraControl: false,
    negativePrompt: false,
    seed: true,
    // Length is frames ÷ fps, not a duration input: 81 and 121 frames at 16fps.
    durationsSeconds: [5, 7.5],
    resolutions: ["480p", "720p"],
    aspectRatios: ["16:9", "9:16"],
    available: true,
    verifiedAt: "2026-08-16",
    notes:
      "Schema inputs: prompt, seed, num_frames, frames_per_second, resolution, " +
      "aspect_ratio, go_fast, interpolate_output, sample_shift, optimize_prompt, " +
      "disable_safety_checker, four lora_* fields. There is no audio input, no " +
      "image input and no negative_prompt. The catalogue entry in " +
      "providers/replicate.ts declares supportsImageInput and " +
      "supportsNegativePrompt true and lists image-to-video among its " +
      "operations — all three are unsupported by this schema, and the adapter " +
      "sends both fields when a user supplies them.",
  },
  {
    id: "replicate/video-pro",
    label: "Motion Pro",
    provider: "replicate",
    slug: "bytedance/seedance-1-lite",
    textToVideo: true,
    imageToVideo: true,
    audio: "none",
    dialogueDirection: false,
    sfxDirection: false,
    ambienceDirection: false,
    musicDirection: false,
    silentOption: false,
    multiShot: false,
    // `image` is the opening frame and `last_frame_image` the closing one.
    // Chaining shot N's final frame into shot N+1's `image` is the strongest
    // continuity mechanism available anywhere in the current catalogue.
    startFrame: true,
    endFrame: true,
    referenceImages: true,
    referenceVideo: false,
    // `reference_images` steers appearance; it is not an identity lock, and
    // calling it one would be the overclaim this audit exists to prevent.
    characterConsistency: false,
    videoExtension: false,
    // `camera_fixed` is a boolean: lock the camera or don't. That is a camera
    // control in the sense that it is a real input, and nothing more.
    cameraControl: true,
    negativePrompt: false,
    seed: true,
    // `duration` is a free integer with no enum; the catalogue offers steps.
    durationsSeconds: [5, 10, 12],
    resolutions: ["480p", "720p", "1080p"],
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21"],
    available: true,
    verifiedAt: "2026-08-16",
    notes:
      "Schema inputs: prompt, image, last_frame_image, reference_images, " +
      "duration, resolution, aspect_ratio, fps (fixed at 24), camera_fixed, " +
      "seed. No audio input. No negative_prompt, which the catalogue already " +
      "records correctly.",
  },

  /**
   * Not wired in. Present because it is the only verified route to native
   * audio, and a registry that omits it cannot explain why the feature is
   * absent.
   *
   * `generate_audio` defaults to `true` at the provider — the same default the
   * product rule asks for — so adopting it needs an adapter and a verified
   * price, not an override.
   */
  {
    id: "google/veo-3",
    label: "Veo 3",
    provider: "replicate",
    slug: "google/veo-3",
    textToVideo: true,
    imageToVideo: true,
    audio: "native",
    // One boolean, no per-channel controls. Content is steered by the prompt.
    dialogueDirection: false,
    sfxDirection: false,
    ambienceDirection: false,
    musicDirection: false,
    silentOption: true,
    multiShot: false,
    startFrame: true,
    endFrame: false,
    referenceImages: false,
    referenceVideo: false,
    characterConsistency: false,
    videoExtension: false,
    cameraControl: false,
    negativePrompt: true,
    seed: true,
    durationsSeconds: [4, 6, 8],
    resolutions: ["720p", "1080p"],
    aspectRatios: ["16:9", "9:16"],
    available: false,
    verifiedAt: "2026-08-16",
    notes:
      "The only model verified to generate synchronised audio: an input named " +
      "generate_audio, default true. Adding it is a substantial provider " +
      "change — a new vendor path with an unverified per-second price — so it " +
      "is proposed rather than enabled. Until a metered run establishes the " +
      "cost, enabling it would put an unpriced model behind the spending " +
      "breaker, which is the one thing model-costs.ts refuses to allow.",
  },
];

export function videoCapability(id: string): VideoModelCapability | null {
  return VIDEO_CAPABILITIES.find((entry) => entry.id === id) ?? null;
}

/** Models that can genuinely produce synchronised sound *and* are shipped. */
export function nativeAudioModels(): readonly VideoModelCapability[] {
  return VIDEO_CAPABILITIES.filter(
    (entry) => entry.audio === "native" && entry.available,
  );
}

/** Models a user can actually pick today. */
export function availableVideoModels(): readonly VideoModelCapability[] {
  return VIDEO_CAPABILITIES.filter((entry) => entry.available);
}
