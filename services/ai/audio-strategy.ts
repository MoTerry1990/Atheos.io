import { creditsAtMargin } from "@/services/ai/sequence";

/**
 * How a video model gets its sound — declared per model, never assumed.
 *
 * ## Why this exists
 *
 * Atheos has been delivering silent video while the composer said "Soundscape
 * added by Atheos". That label described a pipeline nobody had built: Motion 1
 * and Motion Pro have no audio capability in their schemas, and no post step
 * added any. The user was quoted for sound and received a file with no audio
 * stream at all.
 *
 * So every model now declares which strategies it actually supports, and the
 * quote, the UI and the delivery gate all read the same declaration. A model
 * cannot be offered sound it cannot produce, and Atheos-added sound is never
 * called native.
 */

export type AudioStrategy =
  /** The video provider generates synchronised sound in the same prediction. */
  | "NATIVE"
  /** Atheos generates audio from the finished video and muxes it in. */
  | "ATHEOS_SOUND_DESIGN"
  /** Deliberately silent, chosen by the user. */
  | "SILENT";

export interface AudioCapableModel {
  id: string;
  label: string;
  /** Every strategy this model can actually deliver. Order is not preference. */
  strategies: readonly AudioStrategy[];
  /**
   * True when the provider generates audio and offers no way to turn it off.
   *
   * Cinematic Lite is the case: its schema has no `generate_audio` field at
   * all, so a "Silent" control on that tier would be a switch wired to nothing.
   */
  audioAlwaysOn?: boolean;
  /** What the model card may claim. Never "native" for added sound. */
  note: string;
}

/**
 * The catalogue's audio capabilities, read from provider schemas 2026-08-23.
 *
 * `wan-2.2-t2v-fast` and `seedance-1-lite` have no audio field of any kind.
 * The Veo tiers have `generate_audio`, defaulting true, except Lite which has
 * no such field and always returns sound. `seedance-2.5` has `generate_audio`
 * defaulting true and documents dialogue, effects and background.
 */
export const AUDIO_CAPABILITIES: Record<string, AudioCapableModel> = {
  "replicate/video-gen": {
    id: "replicate/video-gen",
    label: "Motion 1",
    strategies: ["ATHEOS_SOUND_DESIGN", "SILENT"],
    note: "The video model produces no audio. The finished video is silent; Atheos sound mix is not currently available.",
  },
  "replicate/video-pro": {
    id: "replicate/video-pro",
    label: "Motion Pro",
    // Audited: seedance-1-lite's schema has no audio input or output. Same
    // pathway as Motion 1 rather than a native claim it cannot support.
    strategies: ["ATHEOS_SOUND_DESIGN", "SILENT"],
    note: "The video model produces no audio. The finished video is silent; Atheos sound mix is not currently available.",
  },
  "replicate/veo-3.1-fast": {
    id: "replicate/veo-3.1-fast",
    label: "Cinematic Fast",
    strategies: ["NATIVE", "SILENT"],
    note: "The video model generates synchronised sound in the same pass.",
  },
  "replicate/veo-3.1": {
    id: "replicate/veo-3.1",
    label: "Cinematic",
    strategies: ["NATIVE", "SILENT"],
    note: "The video model generates synchronised sound in the same pass.",
  },
  "replicate/veo-3.1-lite": {
    id: "replicate/veo-3.1-lite",
    label: "Cinematic Lite",
    strategies: ["NATIVE"],
    audioAlwaysOn: true,
    note: "This model always generates sound and offers no way to turn it off.",
  },
};

/**
 * TODO(motion-pro-upgrade): `replicate/seedance-2.5` — "Cinematic Long".
 *
 * Removed here because it was a **phantom**: routable, compilable and quoted at
 * 1,387 credits, but absent from `services/ai/providers/replicate.ts`, so it had
 * no version pin and no adapter path. Nothing could ever run it. A model the
 * router can recommend and the provider has never heard of is worse than an
 * absent one — the quote is real, the refusal happens after the user commits.
 *
 * Bring it back as part of the Motion Pro upgrade (seedance-1-lite ->
 * seedance-2.x), which needs, together and in one change:
 *   - a registry entry with a pinned version hash,
 *   - a `model-costs` entry ($0.2312/s at 720p, verified 2026-08-24),
 *   - its own `videoShape` branch (it takes `duration` in seconds, plus
 *     `generate_audio`, `reference_images` and `last_frame_image`),
 *   - the audio strategy and routing rows restored below,
 *   - and a re-read of its live schema, because this one is nine months newer
 *     than the entry that was removed.
 */

/**
 * The video-to-audio provider, audited 2026-08-23 without a paid call.
 *
 * `zsxkib/mmaudio` — MMAudio V2, 5,499,075 runs, L40S. It takes the **completed
 * video** plus a text direction and a negative prompt, which is what separates
 * it from a text-to-music model: it can respond to the motion and the cuts that
 * are actually in the file.
 *
 * `zsxkib/thinksound` was the other real candidate (9,464 runs, video +
 * caption + chain-of-thought) and was not selected: it exposes no duration
 * control and **no negative prompt**, so "no music" cannot be enforced.
 *
 * Text-only generators — `meta/musicgen`, `sepal/audiogen`,
 * `stackadoc/stable-audio-open-1.0`, `declare-lab/tango` — were rejected on the
 * sprint's own rule. None of them can see the video, so nothing they produce is
 * synchronised to it.
 */
export const SOUND_DESIGN_PROVIDER = {
  modelId: "zsxkib/mmaudio",
  label: "MMAudio V2",
  runs: 5_499_075,
  acceptsCompletedVideo: true,
  acceptsDirectionPrompt: true,
  /** Its `negative_prompt` defaults to "music" — music suppression built in. */
  acceptsNegativePrompt: true,
  minDurationSeconds: 1,
  defaultDurationSeconds: 8,
  outputFormat: "audio file (URI)",
  /** Page-verified: "approximately $0.0049 to run", 204 runs per $1. */
  perRunUsd: 0.0049,
  typicalLatencySeconds: 5,
  hardware: "Nvidia L40S",
  costBasis:
    "replicate.com/zsxkib/mmaudio, read 2026-08-23: ~$0.0049 per run, ~5s",
} as const;

/**
 * Resolve what will actually happen, from the model and the user's choice.
 *
 * Returns the strategy plus the sentence the UI must show. A model that cannot
 * be silent reports so rather than silently ignoring the request — the failure
 * mode this replaces is a control wired to nothing.
 */
export function resolveAudioStrategy(input: {
  model: AudioCapableModel;
  /** What the user asked for. */
  wantsSound: boolean;
}): { strategy: AudioStrategy; label: string; overridden: boolean } {
  const { model, wantsSound } = input;

  if (!wantsSound) {
    if (model.audioAlwaysOn || !model.strategies.includes("SILENT")) {
      return {
        strategy: "NATIVE",
        label: `${model.label} always generates sound — a silent export is not available on this model`,
        overridden: true,
      };
    }
    return { strategy: "SILENT", label: "Silent video", overridden: false };
  }

  if (model.strategies.includes("NATIVE")) {
    return {
      strategy: "NATIVE",
      label: "Native synchronised audio",
      overridden: false,
    };
  }

  return {
    strategy: "ATHEOS_SOUND_DESIGN",
    // Never "native". The distinction is the whole point of the type.
    label: "Silent — Atheos sound mix is not currently available",
    overridden: false,
  };
}

export interface AudioQuote {
  strategy: AudioStrategy;
  /** Provider calls the audio stage adds. Zero for native and silent. */
  providerCalls: number;
  providerCostMicroUsd: number;
  /** Credits on top of the video. Zero unless a second provider is used. */
  additionalCredits: number;
  /** Seconds added to the wait. */
  additionalSeconds: number;
  disclosure: string;
}

/**
 * Price the audio stage.
 *
 * Native and silent both cost nothing extra — the sound either comes with the
 * video or is not made. Only `ATHEOS_SOUND_DESIGN` adds a provider call, and it
 * is quoted at the same 3× margin as everything else rather than absorbed.
 */
export function quoteAudio(input: {
  strategy: AudioStrategy;
  durationSeconds: number;
}): AudioQuote {
  if (input.strategy !== "ATHEOS_SOUND_DESIGN") {
    return {
      strategy: input.strategy,
      providerCalls: 0,
      providerCostMicroUsd: 0,
      additionalCredits: 0,
      additionalSeconds: 0,
      disclosure:
        input.strategy === "NATIVE"
          ? "Sound is generated with the picture, at no extra cost."
          : "No audio track is produced.",
    };
  }

  const costMicroUsd = Math.round(SOUND_DESIGN_PROVIDER.perRunUsd * 1_000_000);

  return {
    strategy: "ATHEOS_SOUND_DESIGN",
    providerCalls: 1,
    providerCostMicroUsd: costMicroUsd,
    additionalCredits: creditsAtMargin({
      perSecondMicroUsd: costMicroUsd,
      seconds: 1,
    }),
    additionalSeconds: SOUND_DESIGN_PROVIDER.typicalLatencySeconds,
    disclosure:
      "Atheos sound mix is not currently available, so this video will be silent.",
  };
}

// ---------------------------------------------------------------------------
// Audio direction, derived from the scene rather than hardcoded
// ---------------------------------------------------------------------------

export interface AudioDirection {
  prompt: string;
  /** Sent as `negative_prompt`. Music suppression lives here. */
  negativePrompt: string;
  allowSpeech: boolean;
  allowMusic: boolean;
  targetLufs: number;
  truePeakDb: number;
}

export type SoundPreset =
  "natural" | "cinematic" | "product_commercial" | "custom";

/**
 * Build the audio direction from the user's own scene.
 *
 * Derived, not templated. The red-car wording that appears in the sprint brief
 * is an *example of the output*, not a fixture — a hardcoded coastal-drive
 * prompt would put engine noise under a video of a kitchen.
 */
export function buildAudioDirection(input: {
  /** The user's scene description, in their words. */
  scene: string;
  preset: SoundPreset;
  allowMusic?: boolean;
  allowSpeech?: boolean;
  /** Free-text override from the advanced panel. */
  custom?: string;
  /** Shot boundaries from the finished video, when known. */
  cutTimestamps?: readonly number[];
}): AudioDirection {
  const allowMusic = input.allowMusic ?? false;
  const allowSpeech = input.allowSpeech ?? false;

  const parts: string[] = [];

  if (input.preset === "custom" && input.custom?.trim()) {
    parts.push(input.custom.trim());
  } else {
    // The scene itself is the direction. Everything else qualifies it.
    parts.push(`The natural sound of this scene: ${input.scene.trim()}`);

    if (input.preset === "cinematic") {
      parts.push(
        "Full, wide ambience with depth; sound perspective follows the camera distance.",
      );
    }
    if (input.preset === "product_commercial") {
      parts.push(
        "Clean, close and detailed — the subject's own sounds forward, ambience behind them.",
      );
    }
  }

  /**
   * Continuity across cuts, only when there are cuts.
   *
   * Saying "maintain sound continuity across hard cuts" over a single
   * continuous take is instructing the model about something that is not in the
   * file, and MMAudio conditions on the file.
   */
  if ((input.cutTimestamps?.length ?? 0) > 0) {
    parts.push(
      "The ambience continues unbroken across the cuts; only the perspective changes.",
    );
  }

  const negatives: string[] = [];
  if (!allowMusic) negatives.push("music", "score", "soundtrack");
  if (!allowSpeech) negatives.push("speech", "dialogue", "narration", "voice");

  return {
    prompt: parts.join(" "),
    negativePrompt: negatives.join(", "),
    allowSpeech,
    allowMusic,
    // Web delivery targets. -16 LUFS integrated, -1 dBTP true peak.
    targetLufs: -16,
    truePeakDb: -1,
  };
}
