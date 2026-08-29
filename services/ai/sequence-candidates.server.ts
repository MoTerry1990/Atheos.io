import "server-only";

/**
 * Models Atheos has looked at and does not ship, and why. **Server only.**
 *
 * Vendor slugs, which platform could reach each one, what blocks it. These sat
 * in the public capability module and shipped to every browser that opened the
 * Studio, next to the models we actually sell.
 *
 * Nothing renders them and nothing routes on them. They exist so that "why not
 * this model?" has a written answer — a question asked on our side of the
 * wire. Kept in a module of their own rather than beside the cost notes so the
 * public module's dependency graph cannot reach them even transitively.
 */

/**
 * Models Atheos has evaluated and does not ship, and why.
 *
 * These lived in the public module. They are roadmap notes — vendor slugs,
 * which platform could reach them, what blocks each one — and they were
 * shipping to every browser that opened the Studio alongside the capabilities
 * of the models we actually sell.
 *
 * Nothing renders them. They exist so a future "why not this model?" has an
 * answer, which is a question asked on our side of the wire.
 */
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
 *   1. **It is not on the provider.** Every Atheos video runs through the Replicate
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
 * Keyed by the catalogue's id rather than the Replicate slug, because that is
 * what the studio holds. A model absent from this map has no verified schema
 * read, so the plan panel renders nothing rather than quoting from assumptions.
 */
