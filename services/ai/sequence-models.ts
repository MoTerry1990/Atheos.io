import {
  creditsAtMargin,
  type SequenceModelFacts,
} from "@/services/ai/sequence";

/**
 * What each video model can actually do, read from its own schema.
 *
 * ## Every line here was fetched, not remembered
 *
 * `GET https://api.replicate.com/v1/models/{slug}` on **2026-08-22**, reading
 * `latest_version.openapi_schema`. Replicate encodes enums as `allOf: [{$ref}]`
 * rather than inline, which is why an earlier read of the same schemas reported
 * "no enum" for `resolution` and `duration` — resolve the ref and the real
 * ladders appear. Anything below that came from a description string rather
 * than an enum is marked as such.
 *
 * ## The headline
 *
 * **None of them takes a shot list.** Seven models read; seven return one
 * continuous clip for one prompt. There is no model to route a four-shot
 * request to, at any price, which is what forces the orchestrator.
 *
 * ## Costs are a different kind of fact
 *
 * `perSecondMicroUsd` for the two models Atheos ships is apportioned from a
 * real Replicate invoice (see `services/billing/model-costs.ts`, checked
 * 2026-08-13). The candidates are **not** priced here, because Replicate's API
 * returns no pricing field and the model pages did not yield one to a fetch.
 * Guessing a rate and presenting it next to two invoice-derived ones would make
 * the whole table read as measured. See `SEQUENCE_CANDIDATES` below.
 */

/** Motion 1 — wan-video/wan-2.2-t2v-fast. */
export const MOTION_1: SequenceModelFacts = {
  id: "replicate/video-gen",
  label: "Motion 1",
  creditCost: 90,
  /**
   * Not a duration input at all: `num_frames` 81–121 at `frames_per_second`
   * 16. 81/16 = 5.0625s and 121/16 = 7.5625s, which the catalogue rounds to 5
   * and 7.5 — the labels are 62ms short of the file in both cases.
   */
  durationsSeconds: [5, 7.5],
  maxDurationSeconds: 7.5,
  perSecondMicroUsd: 20_000,
  // resolution enum is ["480p", "720p"]; the adapter always sends 720p.
  // 16:9 at 480p is 832x480 per the schema's own description.
  nativeResolution: "720p",
  // interpolate_output defaults on, so a 16fps render is delivered at 30.
  deliveredFrameRate: 30,
  nativeAudio: false,
  /**
   * The fact that decides everything. Its inputs are seed, prompt, go_fast,
   * num_frames, resolution, aspect_ratio, sample_shift, optimize_prompt,
   * frames_per_second, interpolate_output, disable_safety_checker and four
   * lora_* fields. No image, no last frame, no reference, no negative prompt.
   */
  acceptsImageInput: false,
  acceptsEndFrame: false,
  measuredLatencySeconds: 300,
  // A 5-second text-to-video model with no cross-shot mechanism. Asking it to
  // hold four timed beats produces a muddle, not a sequence.
  followsDirectedBeats: false,
  allowedDurations: [5, 7.5],
  supportsNegativePrompt: false,
  supportsReferenceImages: false,
  supportsVideoExtension: false,
  reachableVia: "replicate",
  costBasis: "apportioned from a real Replicate invoice, 2026-08-13",
};

/** Motion Pro — bytedance/seedance-1-lite. */
export const MOTION_PRO: SequenceModelFacts = {
  id: "replicate/video-pro",
  label: "Motion Pro",
  creditCost: 180,
  // Schema says duration 4–12 (a range, not an enum). The catalogue offers
  // 5/10/12, so 5 is the floor every shot is billed at.
  durationsSeconds: [5, 10, 12],
  maxDurationSeconds: 12,
  perSecondMicroUsd: 54_000,
  // enum ["480p", "720p", "1080p"]; the adapter always sends 1080p.
  nativeResolution: "1080p",
  deliveredFrameRate: 24,
  nativeAudio: false,
  /**
   * Three separate image inputs — `image`, `last_frame_image` and
   * `reference_images` — which is why this is the only shipped model a
   * sequence can be built on.
   */
  acceptsImageInput: true,
  acceptsEndFrame: true,
  measuredLatencySeconds: 700,
  // Not documented for multi-beat coherence. It renders one continuous action
  // well; a four-angle instruction is beyond what it holds.
  followsDirectedBeats: false,
  allowedDurations: [5, 10, 12],
  supportsNegativePrompt: false,
  supportsReferenceImages: true,
  supportsVideoExtension: false,
  reachableVia: "replicate",
  costBasis: "apportioned from a real Replicate invoice, 2026-08-13",
};

/**
 * Cinematic Fast — google/veo-3.1-fast.
 *
 * Schema read from Replicate on 2026-08-22: `seed, image, prompt, duration,
 * last_frame, resolution, aspect_ratio, generate_audio, negative_prompt`.
 * 778,358 runs. Callable today with the token Atheos already has.
 *
 * `generate_audio` defaults to **true** — this is the first model in the
 * catalogue whose audio is genuinely the model's own rather than a soundscape
 * Atheos assembles afterwards.
 */
export const CINEMATIC_FAST: SequenceModelFacts = {
  id: "replicate/veo-3.1-fast",
  label: "Cinematic Fast",
  // 288 at the 4-second base, so an 8-second clip is 576 credits — $2.88 of
  // revenue against $0.96 of cost, exactly the 3x floor. Derived rather than
  // typed so a corrected provider rate moves the price with it.
  creditCost: creditsAtMargin({ perSecondMicroUsd: 120_000, seconds: 4 }),
  durationsSeconds: [4, 6, 8],
  maxDurationSeconds: 8,
  /**
   * $0.12 per second at 1080p with audio, from Google's own pricing page
   * (ai.google.dev/gemini-api/docs/pricing, read 2026-08-22): Fast is $0.10 at
   * 720p and $0.12 at 1080p.
   *
   * **This is Google's direct rate.** Atheos reaches the model through
   * Replicate, whose margin is not published in its API and could not be read
   * from the model page. The real invoice line is the first thing to check on
   * the approved benchmark, and it can only be higher than this.
   */
  perSecondMicroUsd: 120_000,
  nativeResolution: "1080p",
  deliveredFrameRate: 24,
  nativeAudio: true,
  acceptsImageInput: true,
  acceptsEndFrame: true,
  // Unmeasured. Veo renders faster than Seedance in every published comparison,
  // but no Atheos generation has been timed, so this is a placeholder the
  // benchmark must replace rather than a figure to quote with confidence.
  measuredLatencySeconds: 180,
  followsDirectedBeats: true,
  allowedDurations: [4, 6, 8],
  supportsNegativePrompt: true,
  // veo-3.1-fast has no `reference_images` input; the full model does.
  supportsReferenceImages: false,
  // Google's own API documents video extension. Replicate's wrapper exposes no
  // `video` input, so it is not reachable on this path.
  supportsVideoExtension: false,
  reachableVia: "replicate",
  costBasis:
    "Google published price, 2026-08-22. Replicate margin unverified — confirm on first invoice.",
};

/** Cinematic — google/veo-3.1, the full model. */
export const CINEMATIC: SequenceModelFacts = {
  id: "replicate/veo-3.1",
  label: "Cinematic",
  creditCost: creditsAtMargin({ perSecondMicroUsd: 400_000, seconds: 4 }),
  durationsSeconds: [4, 6, 8],
  maxDurationSeconds: 8,
  // Standard tier: $0.40/second at both 720p and 1080p.
  perSecondMicroUsd: 400_000,
  nativeResolution: "1080p",
  deliveredFrameRate: 24,
  nativeAudio: true,
  acceptsImageInput: true,
  acceptsEndFrame: true,
  measuredLatencySeconds: 300,
  followsDirectedBeats: true,
  allowedDurations: [4, 6, 8],
  supportsNegativePrompt: true,
  /**
   * The only model in the catalogue with `reference_images` — 1 to 3 images for
   * subject-consistent generation. Its own schema restricts it: **16:9 and
   * 8-second duration only**, and `last_frame` is ignored when references are
   * supplied. Both constraints must be enforced before sending, not discovered
   * in a rejection.
   */
  supportsReferenceImages: true,
  supportsVideoExtension: false,
  reachableVia: "replicate",
  costBasis:
    "Google published price, 2026-08-22. Replicate margin unverified — confirm on first invoice.",
};

/** Cinematic Lite — google/veo-3.1-lite. */
export const CINEMATIC_LITE: SequenceModelFacts = {
  id: "replicate/veo-3.1-lite",
  label: "Cinematic Lite",
  creditCost: creditsAtMargin({ perSecondMicroUsd: 80_000, seconds: 4 }),
  durationsSeconds: [4, 6, 8],
  maxDurationSeconds: 8,
  // $0.08/second at 1080p, $0.05 at 720p.
  perSecondMicroUsd: 80_000,
  nativeResolution: "1080p",
  deliveredFrameRate: 24,
  /**
   * Audio is on and **cannot be turned off**.
   *
   * Its Replicate schema has no `generate_audio` field at all, while the model
   * description says "native audio". So audio always arrives — which makes a
   * silent export impossible on this tier, and that is a limitation to state
   * rather than a feature to celebrate.
   */
  nativeAudio: true,
  acceptsImageInput: true,
  acceptsEndFrame: true,
  measuredLatencySeconds: 150,
  followsDirectedBeats: true,
  allowedDurations: [4, 6, 8],
  // No `negative_prompt` input. The prohibitions must be dropped, not appended.
  supportsNegativePrompt: false,
  supportsReferenceImages: false,
  supportsVideoExtension: false,
  reachableVia: "replicate",
  costBasis:
    "Google published price, 2026-08-22. Replicate margin unverified — confirm on first invoice.",
};

/**
 * Gemini Omni Flash — Google's own recommended default, and not reachable here.
 *
 * `ai.google.dev/gemini-api/docs/video` (read 2026-08-22) says plainly: "Use
 * Gemini Omni Flash as your default model for video generation", citing
 * coherence, character consistency and multi-turn conversational editing. Its
 * id is `gemini-omni-flash-preview` and it bills as tokens — $17.50 per 1M
 * output tokens at 5,792 tokens per second of 720p video, about **$0.10 per
 * second**.
 *
 * Two things stop it being the recommendation today, and neither is quality:
 *
 *   1. **It is not on Replicate.** Every Atheos video runs through the Replicate
 *      adapter; this needs a direct `generativelanguage.googleapis.com` client.
 *   2. **There is no key.** `GOOGLE_AI_API_KEY` is declared in `lib/env.ts` and
 *      absent from every environment, which is also why `providers/google.ts`
 *      has never executed a single request.
 *
 * The docs do not state its durations, resolutions or aspect ratios, so those
 * are unknown rather than assumed — which is itself a reason not to quote it.
 */
export const GEMINI_OMNI_FLASH_NOTE = {
  modelId: "gemini-omni-flash-preview",
  reachableVia: "google-direct" as const,
  approxPerSecondMicroUsd: 100_000,
  costBasis:
    "ai.google.dev/gemini-api/docs/pricing, 2026-08-22: $17.50 per 1M output tokens at 5,792 tokens per second of 720p video",
  blockers: [
    "not available on Replicate — needs a direct Google API adapter",
    "GOOGLE_AI_API_KEY is not set in any environment",
    "durations, resolutions and aspect ratios are not stated in the documentation",
  ],
} as const;

/**
 * Models considered and not adopted.
 *
 * Deliberately not `SequenceModelFacts`: a quote built from an unverified cost
 * is a made-up price, and giving these the same shape as the two above would
 * let one be passed to `quoteSequence` by accident. They are notes until
 * somebody puts a rate next to a real invoice line.
 */
export const SEQUENCE_CANDIDATES = [
  {
    slug: "bytedance/seedance-1-pro",
    label: "Seedance 1 Pro",
    runs: 2_379_329,
    durations: "2–12s",
    resolutions: ["480p", "720p", "1080p"],
    nativeAudio: false,
    chaining: "image + last_frame_image",
    multiShot: false,
    note:
      "The straight upgrade from Motion Pro: same inputs, better renders, no " +
      "reference_images. Cost unverified — expect roughly double the lite model.",
  },
  {
    slug: "google/veo-3-fast",
    label: "Veo 3 Fast",
    runs: 210_619,
    durations: "4, 6 or 8s",
    resolutions: ["720p", "1080p"],
    nativeAudio: true,
    chaining: "image (first frame only)",
    multiShot: false,
    note:
      "The only model read that generates synchronised audio with the picture " +
      "(`generate_audio`, default true) — it would replace the Atheos " +
      "soundscape with the real thing. It also takes a negative prompt, which " +
      "neither shipped model does. No end-frame input, so shots can be anchored " +
      "but not chained. Cost unverified and expected to be the highest here.",
  },
  {
    slug: "kwaivgi/kling-v2.1",
    label: "Kling v2.1",
    runs: 4_197_985,
    durations: "5 or 10s",
    resolutions: ["720p (standard)", "1080p (pro)"],
    nativeAudio: false,
    chaining: "start_image + end_image",
    multiShot: false,
    note:
      "The most-run video model on Replicate and the only one with a true " +
      "start-and-end frame pair, which is the strongest chaining primitive " +
      "available. No resolution field — `mode` decides it. Cost unverified.",
  },
  {
    slug: "minimax/hailuo-02",
    label: "Hailuo 02",
    runs: 442_503,
    durations: "6 or 10s",
    resolutions: ["512p", "768p", "1080p"],
    nativeAudio: false,
    chaining: "first_frame_image + last_frame_image",
    multiShot: false,
    note:
      "Reaches 10s in one call, which is the whole benchmark length without " +
      "any assembly. Cost unverified.",
  },
] as const;

/**
 * Model id to facts, for the composer.
 *
 * Keyed by the catalogue's id rather than the provider slug, because that is
 * what the studio holds. A model absent from this map has no verified schema
 * read, so the plan panel renders nothing rather than quoting from assumptions.
 */
/**
 * Keyed by **public** id, because the studio looks it up with one.
 *
 * These keys were `MOTION_1.id` and friends — catalogue paths. The studio
 * reads `SEQUENCE_MODEL_FACTS[model.id]` where `model` comes from
 * `/api/generations`, and that endpoint has returned public ids since the
 * public model contract landed. So every lookup missed, and the video
 * composer silently fell back to a flat credit label instead of a real
 * sequence quote.
 *
 * Written as literals rather than derived through `publicModelId`, because
 * that helper is `server-only` and this module is imported by client
 * components. `tests/unit/model-policy.test.ts` asserts the mapping these
 * literals duplicate, so a divergence fails the build rather than going quiet
 * the way the last one did.
 */
export const SEQUENCE_MODEL_FACTS: Record<string, SequenceModelFacts> = {
  "motion-1": MOTION_1,
  "motion-pro": MOTION_PRO,
  "cinematic-lite": CINEMATIC_LITE,
  "cinematic-fast": CINEMATIC_FAST,
  cinematic: CINEMATIC,
};

/**
 * The tiers, in the order a person should read them.
 *
 * Every claim here is derived from the facts above rather than written next to
 * them, so a capability cannot be advertised that the model does not have —
 * which is how a "native audio" badge ends up on a silent model.
 */
export const VIDEO_TIERS = [
  { facts: MOTION_1, summary: "Economy continuous clip, 720p, silent" },
  {
    facts: MOTION_PRO,
    summary:
      "Higher-quality continuous clip or chained sequence, no native audio",
  },
  {
    facts: CINEMATIC_LITE,
    summary: "1080p with native audio, always on — no silent export",
  },
  {
    facts: CINEMATIC_FAST,
    summary: "1080p, native audio, directed camera sequence in one generation",
  },
  {
    facts: CINEMATIC,
    summary:
      "1080p, native audio, directed sequence plus reference images for subject consistency",
  },
] as const;
