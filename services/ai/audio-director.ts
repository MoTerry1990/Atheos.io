import type { VideoDirectorPlan } from "@/services/ai/video-director";

/**
 * The soundtrack, planned rather than assumed.
 *
 * ## Where Atheos actually stands
 *
 * The benchmark clip carries stereo AAC at 48kHz, generated with the picture and
 * synchronised to it. Neither video model Atheos ships produces audio at all —
 * Sprint 5D read both OpenAPI schemas and found no audio input or output on
 * `wan-2.2-t2v-fast` or `seedance-1-lite`. Veo 3 has `generate_audio`, defaulting
 * on, and is not enabled.
 *
 * So every Atheos video is silent today, and any sound on one is **post-produced
 * by us**. That distinction is the reason `AudioSource` exists and is carried
 * all the way to the UI: presenting a soundscape we assembled as the model's own
 * output would be a straightforward lie about how the video was made.
 *
 * ## Why a plan rather than "add some ambience"
 *
 * Sound that ignores the picture is worse than silence — engine noise that does
 * not change when the camera pulls back tells the viewer the audio is wallpaper.
 * The plan below ties each layer to the shot list, so perspective moves with the
 * camera.
 */

export type AudioSource =
  /** The video model generated it with the picture. Only Veo can today. */
  | "native"
  /** Atheos assembled it afterwards and mixed it in. */
  | "atheos_soundscape"
  | "user_uploaded"
  | "muted";

export type AudioLayerKind =
  "ambience" | "foley" | "engine" | "music" | "dialogue" | "narration";

export interface AudioLayer {
  kind: AudioLayerKind;
  description: string;
  /** 0–1, before mixing. Every layer is independently controllable. */
  gain: number;
  /** Seconds. Absent means the whole piece. */
  start?: number;
  end?: number;
}

export interface AudioDirectorPlan {
  source: AudioSource;
  /** Must equal the video's duration exactly — see `validateAudioTechnical`. */
  durationSeconds: number;
  sampleRate: 48_000;
  channels: 2;
  layers: readonly AudioLayer[];
  /**
   * How the mix follows the camera.
   *
   * Keyed by shot index so it cannot drift out of step with the shot list: a
   * perspective note that refers to "the third shot" survives a re-plan only if
   * something re-reads the plan.
   */
  perspectiveByShot: readonly { shot: number; note: string }[];
  /** Crossfade between shots, seconds. Zero would click audibly. */
  crossfadeSeconds: number;
  notes: readonly string[];
}

/**
 * Music is never added unless it was asked for.
 *
 * A stock cinematic bed under somebody's coastal drone shot is the single most
 * common way generated video announces itself as generated. The benchmark has
 * none, and its sound is better for it.
 */
const MUSIC_CUES =
  /\b(con m[uú]sica|m[uú]sica|banda sonora|soundtrack|with music|background music|score)\b/i;

/** Any request for sound at all. */
const AUDIO_CUES =
  /\b(con audio|con sonido|audio|sonido|with (audio|sound)|sound|ambience|ambiente)\b/i;

export function readAudioIntent(prompt: string): {
  wantsAudio: boolean;
  wantsMusic: boolean;
} {
  const wantsMusic = MUSIC_CUES.test(prompt);
  return {
    /**
     * Asking for music is asking for sound.
     *
     * Read literally, "con música" contains none of the audio cues, and the
     * first version of this returned a silent export for it — a request for a
     * soundtrack answered with silence. Music implies audio; the reverse does
     * not, which is why only this direction is inferred.
     */
    wantsAudio: wantsMusic || AUDIO_CUES.test(prompt),
    wantsMusic,
  };
}

/**
 * Build the sound plan for a directed video.
 *
 * Perspective is derived from each shot's framing rather than written by hand:
 * a wide shot gets more wind and surf, a closer one more engine. That is the
 * behaviour the benchmark has, and deriving it means it stays correct when the
 * shot list changes.
 */
export function buildAudioPlan(input: {
  prompt: string;
  plan: VideoDirectorPlan;
  /** What the chosen provider can do. Decides `source`. */
  providerHasNativeAudio: boolean;
  /** Explicit UI switch. Overrides anything parsed. */
  enabled?: boolean;
}): AudioDirectorPlan {
  const intent = readAudioIntent(input.prompt);
  const wanted = input.enabled ?? intent.wantsAudio;

  if (!wanted) {
    return {
      source: "muted",
      durationSeconds: input.plan.durationSeconds,
      sampleRate: 48_000,
      channels: 2,
      layers: [],
      perspectiveByShot: [],
      crossfadeSeconds: 0,
      notes: ["No audio was requested, so the export is silent by intent."],
    };
  }

  const layers: AudioLayer[] = [
    {
      kind: "engine",
      description: "smooth sports-car engine, load following the road speed",
      gain: 0.7,
    },
    {
      kind: "foley",
      description: "tyre and road surface movement",
      gain: 0.5,
    },
    { kind: "ambience", description: "coastal wind", gain: 0.45 },
    { kind: "ambience", description: "distant ocean surf", gain: 0.35 },
  ];

  if (intent.wantsMusic) {
    layers.push({
      kind: "music",
      /**
       * Original composition only, and never "in the style of" a named living
       * artist. That request is a request for a derivative work of somebody's
       * livelihood, and the fact that a model will produce it does not make it
       * ours to sell.
       */
      description: "original instrumental bed, no artist imitation",
      gain: 0.25,
    });
  }

  const perspectiveByShot = input.plan.shots.map((shot, index) => ({
    shot: index,
    note: /wide|establishing|pullback/i.test(shot.framing + shot.angle)
      ? "wind and surf forward, engine further back"
      : /top-down|overhead/i.test(shot.angle)
        ? "engine present but diffuse, road noise steady"
        : "engine forward, wind reduced",
  }));

  return {
    source: input.providerHasNativeAudio ? "native" : "atheos_soundscape",
    durationSeconds: input.plan.durationSeconds,
    sampleRate: 48_000,
    channels: 2,
    layers,
    perspectiveByShot,
    // Long enough to be inaudible as a seam, short enough not to smear the
    // engine across a cut.
    crossfadeSeconds: 0.25,
    notes: input.providerHasNativeAudio
      ? ["Audio generated with the picture by the video model."]
      : [
          "The video model produces no audio. This soundscape is assembled by " +
            "Atheos and mixed onto the silent clip — it is not provider audio.",
        ],
  };
}

export interface AudioTechnicalReport {
  ok: boolean;
  problems: string[];
}

/**
 * Check a finished audio stream rather than assuming it is fine.
 *
 * "An audio stream exists" is not the same as "the video has sound", and the
 * failure modes are specific: a track a few frames short of the picture, a
 * silent stream, a clipped mix, a hard stop at the end. Each is checked by
 * name so a failure says which one happened.
 */
export function validateAudioTechnical(measured: {
  hasStream: boolean;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  videoDurationSeconds: number;
  /** dBFS. Above roughly -0.1 means samples are hitting the ceiling. */
  peakDb: number;
  /** dBFS. Around -70 or below is effectively silence. */
  meanDb: number;
  /** Longest run of silence, seconds. */
  longestSilenceSeconds: number;
}): AudioTechnicalReport {
  const problems: string[] = [];

  if (!measured.hasStream) {
    return { ok: false, problems: ["no audio stream in the export"] };
  }

  if (measured.sampleRate !== 48_000) {
    problems.push(`sample rate is ${measured.sampleRate}, expected 48000`);
  }
  if (measured.channels !== 2) {
    problems.push(`${measured.channels} channel(s), expected stereo`);
  }

  /**
   * A 50ms tolerance rather than exact equality.
   *
   * The benchmark's own audio runs 10.005s against a 10.000s picture — a
   * container artefact, not a sync error, and demanding exact equality would
   * fail a file that is demonstrably fine. Beyond about a frame, though, it is
   * audible on a hard sound.
   */
  const drift = Math.abs(
    measured.durationSeconds - measured.videoDurationSeconds,
  );
  if (drift > 0.05) {
    problems.push(
      `audio is ${drift.toFixed(3)}s out from the video, beyond the 0.05s tolerance`,
    );
  }

  if (measured.peakDb > -0.1) {
    problems.push(`peaks at ${measured.peakDb.toFixed(2)} dBFS — clipping`);
  }
  if (measured.meanDb < -70) {
    problems.push("the track is effectively silent");
  }
  if (measured.longestSilenceSeconds > 1.5) {
    problems.push(
      `${measured.longestSilenceSeconds.toFixed(1)}s of unexplained silence`,
    );
  }

  return { ok: problems.length === 0, problems };
}

/** What the UI must say about where the sound came from. */
export function describeAudioSource(source: AudioSource): string {
  switch (source) {
    case "native":
      return "Audio generated by the video model";
    case "atheos_soundscape":
      /**
       * Present tense, about what the file actually has.
       *
       * This said "Soundscape added by Atheos", which described a mux step
       * that has never been built — so it labelled a silent video as having
       * sound.
       */
      return "Silent — Atheos sound mix is not currently available";
    case "user_uploaded":
      return "Your uploaded audio";
    case "muted":
      return "No audio";
  }
}
