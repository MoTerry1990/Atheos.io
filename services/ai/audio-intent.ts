import {
  type VideoModelCapability,
  videoCapability,
} from "@/services/ai/video-capabilities";

/**
 * What a caller wants from a generation's soundtrack, and whether they can
 * have it.
 *
 * ## The rule this enforces
 *
 * A request for sound that the chosen model cannot make must be refused
 * *before* credits are reserved. The alternative — reserve, submit, receive a
 * silent file, settle a refund — costs the user a wait and Atheos a provider
 * bill, to arrive at a "no" that was knowable from a static table.
 *
 * That is why this module is pure and synchronous. It has no database, no
 * provider call and no clock, so it can run in the composer to grey out an
 * option and again on the server to reject a forged request, and give the same
 * answer both times.
 *
 * ## Why `post_process` is a separate mode rather than a fallback
 *
 * Atheos can already generate music (`replicate/music`) and effects
 * (`replicate/sfx`) as independent jobs, and `features/sequences/lib/stitch.ts`
 * can lay one under a video. That is a real capability and a genuinely useful
 * one — but it is a second generation, separately billed, and it is not
 * synchronised to what happens on screen. Modelling it as a distinct mode is
 * what stops the UI quietly substituting it for native audio and calling the
 * result the same thing.
 *
 * ## No migration
 *
 * `Generation.parameters` is already `Json?`. The resolved mode is persisted
 * there under `audioMode`, so this contract ships without a schema change.
 */

export type AudioMode =
  /** Everything the model can voice: dialogue, effects, ambience together. */
  | "native_full_mix"
  /** Diegetic sound and room tone, no speech. */
  | "native_sfx_ambient"
  /** Speech foregrounded. */
  | "native_dialogue"
  /** Deliberately silent. Always available, on every model. */
  | "silent"
  /** A separate audio generation, laid under the clip afterwards. */
  | "post_process";

export const AUDIO_MODES: readonly AudioMode[] = [
  "native_full_mix",
  "native_sfx_ambient",
  "native_dialogue",
  "silent",
  "post_process",
];

/** The three modes that require the provider itself to emit sound. */
export const NATIVE_AUDIO_MODES: readonly AudioMode[] = [
  "native_full_mix",
  "native_sfx_ambient",
  "native_dialogue",
];

export function isAudioMode(value: unknown): value is AudioMode {
  return typeof value === "string" && AUDIO_MODES.includes(value as AudioMode);
}

export function isNativeAudioMode(mode: AudioMode): boolean {
  return NATIVE_AUDIO_MODES.includes(mode);
}

/**
 * Why a request was refused.
 *
 * A code rather than a sentence, so the API returns something stable and the
 * UI owns the wording — including its Spanish wording, which a message built
 * on the server could not.
 */
export type AudioRejectionCode =
  | "unknown_model"
  | "model_has_no_audio"
  | "channel_not_separable"
  | "invalid_mode";

export interface AudioIntentRejection {
  ok: false;
  code: AudioRejectionCode;
  /** English fallback. The client is expected to localise from `code`. */
  message: string;
  /** What the caller can pick instead. Never empty. */
  supported: readonly AudioMode[];
}

export interface AudioIntentAcceptance {
  ok: true;
  mode: AudioMode;
  /** The provider field to set, when the model has one. */
  generateAudio: boolean;
}

export type AudioIntentResult = AudioIntentAcceptance | AudioIntentRejection;

/**
 * The modes a given model can honour.
 *
 * `silent` and `post_process` are on every list: any model can decline to make
 * sound, and any video output can have a separately generated track laid under
 * it. The native modes appear only where the schema has an audio input.
 */
export function supportedAudioModes(
  capability: VideoModelCapability,
): readonly AudioMode[] {
  if (capability.audio !== "native") {
    return ["silent", "post_process"];
  }

  const modes: AudioMode[] = ["native_full_mix"];

  // Only offered where the provider exposes a control for that channel. Veo 3
  // has a single on/off boolean, so asking it for "effects but no dialogue" is
  // a request nothing in the API can carry — it would be a prompt suggestion
  // dressed up as a setting.
  if (capability.sfxDirection || capability.ambienceDirection) {
    modes.push("native_sfx_ambient");
  }
  if (capability.dialogueDirection) {
    modes.push("native_dialogue");
  }

  modes.push("silent", "post_process");
  return modes;
}

/**
 * The mode a model starts on.
 *
 * The product rule is audio ON wherever the provider can actually produce it,
 * which also matches Veo 3's own `generate_audio: true` default. A model with
 * no audio input starts `silent`, because the only other option is a control
 * that promises sound and returns none.
 */
export function defaultAudioMode(modelId: string): AudioMode {
  const capability = videoCapability(modelId);
  if (!capability) return "silent";
  return capability.audio === "native" ? "native_full_mix" : "silent";
}

/**
 * Validate a requested mode against the chosen model.
 *
 * Call this before reserving credits. An accepted result carries
 * `generateAudio`, which is the only value the adapter needs.
 */
export function validateAudioIntent(
  modelId: string,
  requested: unknown,
): AudioIntentResult {
  const capability = videoCapability(modelId);

  if (!capability) {
    return {
      ok: false,
      code: "unknown_model",
      message: `No capability record for ${modelId}.`,
      // Silence is the only promise that can be kept by a model nobody has
      // described. Offering post_process here would assume a video output.
      supported: ["silent"],
    };
  }

  const supported = supportedAudioModes(capability);

  // Undefined means "no preference", which is the common case: the composer
  // sends a mode, the API and the MCP surface may not.
  if (requested === undefined || requested === null) {
    const mode = defaultAudioMode(modelId);
    return { ok: true, mode, generateAudio: isNativeAudioMode(mode) };
  }

  if (!isAudioMode(requested)) {
    return {
      ok: false,
      code: "invalid_mode",
      message: `${String(requested)} is not an audio mode.`,
      supported,
    };
  }

  if (supported.includes(requested)) {
    return {
      ok: true,
      mode: requested,
      generateAudio: isNativeAudioMode(requested),
    };
  }

  // Distinguish "this model is silent" from "this model has audio but not that
  // channel". They lead to different next steps — switch model, or switch mode
  // — and collapsing them into one error would hide which applies.
  if (capability.audio !== "native") {
    return {
      ok: false,
      code: "model_has_no_audio",
      message:
        `${capability.label} produces no audio: the provider exposes no audio ` +
        `input. Generate a soundtrack separately, or choose a model that does.`,
      supported,
    };
  }

  return {
    ok: false,
    code: "channel_not_separable",
    message:
      `${capability.label} generates audio as a single mixed track and cannot ` +
      `isolate that channel.`,
    supported,
  };
}

/**
 * The shape stored in `Generation.parameters.audioMode`.
 *
 * Read back defensively: rows written before this contract existed have no
 * `audioMode` at all, and they were all silent.
 */
export function readStoredAudioMode(parameters: unknown): AudioMode {
  if (parameters && typeof parameters === "object") {
    const value = (parameters as Record<string, unknown>).audioMode;
    if (isAudioMode(value)) return value;
  }
  return "silent";
}
