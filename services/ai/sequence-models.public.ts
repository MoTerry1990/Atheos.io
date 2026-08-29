import { type SequenceModelFacts } from "@/services/ai/sequence";

/**
 * What each sequence model can do, in the customer's terms.
 *
 * ## What this file may contain, and why the rule is strict
 *
 * Public ids, Atheos names, durations, resolution, frame rate, audio status
 * and the capability flags a picker needs. Nothing else.
 *
 * Three client components import it, so everything here is an artefact a
 * browser downloads. It has already carried, at various times, catalogue
 * paths, the platform that runs each model, our per-second cost, and the
 * margin working — none of which anyone intended to publish and all of which
 * shipped, because they were written on a capability object.
 *
 * That includes prose. A comment naming a vendor is as identifying as a field
 * naming one, and comments survive into source maps.
 *
 * The mapping, the routing, the costs and the prices are in
 * the server-only half of this pair. This file must not import it: doing so would drag a server module into every client component
 * that reads a capability.
 */

/** Motion 1. */
/**
 * Capabilities only. No price, no provider, no internal id.
 *
 * `creditCost` used to live here, and this module is imported by three client
 * components — so the price table shipped to the browser and, before that, so
 * did the per-second cost the price was derived from.
 *
 * What a model *charges* is a server decision that changes with duration and
 * output count, and the browser already receives it in the public model DTO
 * from `/api/generations`. Reading it from a static table beside the
 * capabilities was a second source of truth for money, which is the one thing
 * that must have exactly one.
 *
 * The prices, the provider routing and the cost basis are in
 * the server-only half of this pair.
 */
export const MOTION_1: SequenceModelFacts = {
  id: "motion-1",
  label: "Motion 1",
  /**
   * Not a duration input at all: `num_frames` 81–121 at `frames_per_second`
   * 16. 81/16 = 5.0625s and 121/16 = 7.5625s, which the catalogue rounds to 5
   * and 7.5 — the labels are 62ms short of the file in both cases.
   */
  durationsSeconds: [5, 7.5],
  maxDurationSeconds: 7.5,
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
};

/** Motion Pro. */
export const MOTION_PRO: SequenceModelFacts = {
  id: "motion-pro",
  label: "Motion Pro",
  // Schema says duration 4–12 (a range, not an enum). The catalogue offers
  // 5/10/12, so 5 is the floor every shot is billed at.
  durationsSeconds: [5, 10, 12],
  maxDurationSeconds: 12,
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
};

/**
 * Cinematic Fast.
 *
 * Capability schema read from the provider on 2026-08-22: `seed, image, prompt, duration,
 * last_frame, resolution, aspect_ratio, generate_audio, negative_prompt`.
 * 778,358 runs. Callable today with the token Atheos already has.
 *
 * `generate_audio` defaults to **true** — this is the first model in the
 * catalogue whose audio is genuinely the model's own rather than a soundscape
 * Atheos assembles afterwards.
 */
export const CINEMATIC_FAST: SequenceModelFacts = {
  id: "cinematic-fast",
  label: "Cinematic Fast",
  // 288 at the 4-second base, so an 8-second clip is 576 credits — $2.88 of
  // revenue against $0.96 of cost, exactly the 3x floor. Derived rather than
  // typed so a corrected provider rate moves the price with it.
  durationsSeconds: [4, 6, 8],
  maxDurationSeconds: 8,
  nativeResolution: "1080p",
  deliveredFrameRate: 24,
  nativeAudio: true,
  acceptsImageInput: true,
  acceptsEndFrame: true,
  // Unmeasured. The Cinematic tiers render faster than Motion Pro in every
  // published comparison,
  // but no Atheos generation has been timed, so this is a placeholder the
  // benchmark must replace rather than a figure to quote with confidence.
  measuredLatencySeconds: 180,
  followsDirectedBeats: true,
  allowedDurations: [4, 6, 8],
  supportsNegativePrompt: true,
  // The fast tier has no reference-image input; the full model does.
  supportsReferenceImages: false,
  // The upstream API documents video extension; the hosted wrapper exposes no
  // `video` input, so it is not reachable on this path.
  supportsVideoExtension: false,
};

/** Cinematic — the full-quality tier. */
export const CINEMATIC: SequenceModelFacts = {
  id: "cinematic",
  label: "Cinematic",
  durationsSeconds: [4, 6, 8],
  maxDurationSeconds: 8,
  // Standard tier: $0.40/second at both 720p and 1080p.
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
};

/**
 * Cinematic Lite. **Not offered.**
 *
 * Kept as a facts constant because its adapter still carries its
 * behaviour — always-on audio, no negative prompt, no reference images — and
 * that code is covered by tests. Deleting the constant would mean deleting
 * tests for live code.
 *
 * What it is *not* in: the provider catalogue, the policy registry,
 * `SEQUENCE_MODEL_FACTS` and `VIDEO_TIERS`. So nothing can select it, price it
 * or run it. It is a separate endpoint on a separate pinned version from the
 * two Cinematic tiers, which makes it a separate licence question that has not
 * been answered.
 */
export const CINEMATIC_LITE: SequenceModelFacts = {
  id: "cinematic-lite",
  label: "Cinematic Lite",
  durationsSeconds: [4, 6, 8],
  maxDurationSeconds: 8,
  // $0.08/second at 1080p, $0.05 at 720p.
  nativeResolution: "1080p",
  deliveredFrameRate: 24,
  /**
   * Audio is on and **cannot be turned off**.
   *
   * Its the provider schema has no `generate_audio` field at all, while the model
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
};

/**
 * Cinematic Lite is absent throughout.
 *
 * It is a separate endpoint on a separate pinned version
 * from the two Cinematic tiers, so it is a separate licence question — and one
 * nobody has answered. It was removed from the provider catalogue rather than
 * given a policy entry, and these tables follow, because a capability, price
 * or tier row for a model no adapter serves is a row that will eventually be
 * offered by mistake.
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
    facts: CINEMATIC_FAST,
    summary: "1080p, native audio, directed camera sequence in one generation",
  },
  {
    facts: CINEMATIC,
    summary:
      "1080p, native audio, directed sequence plus reference images for subject consistency",
  },
] as const;
