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
 * Gemini Omni Flash — no longer a candidate. It is integrated.
 *
 * This note used to say the model was unreachable and to give its id as
 * `gemini-omni-flash-preview`. Both were wrong, and the second was the more
 * dangerous kind of wrong: an id asserted from a page that did not contain it,
 * sitting in a comment that read like a verified fact. Google's 2026-08-27
 * documentation update distinguishes the **stable** `gemini-omni-1.1-flash`
 * from the preview alias, and only the stable one may be integrated.
 *
 * The model now has a real registry entry, a policy entry scoped to that exact
 * version, and a server-only adapter. Its licence evidence — including the
 * documented absence of any parameter that could silence its audio — is in
 * `docs/LICENCE-EVIDENCE.md`.
 *
 * Kept as a pointer rather than deleted, because "why is this not in
 * SEQUENCE_CANDIDATES any more" is a question worth answering in the file
 * where it was.
 */
export const GEMINI_OMNI_FLASH_NOTE = {
  modelId: "gemini-omni-1.1-flash",
  reachableVia: "google-direct" as const,
  status: "integrated, owner evaluation only" as const,
  see: "services/ai/providers/google-omni.ts",
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
