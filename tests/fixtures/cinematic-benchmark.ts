/**
 * The permanent audiovisual benchmark.
 *
 * ## Measured, not described
 *
 * Every number here was read off the reference file with ffprobe. None of it is
 * taken from how the clip looks or from what it was said to be — the sprint
 * brief is explicit that output must not be called 1080p or 4K without checking
 * the actual file, and that rule applies first to the benchmark itself.
 *
 *   ffprobe -show_streams "ahora_haz_un_video_de_esta_ima (1).mp4"
 *     video: h264, 1280x720, 24/1 fps, 240 frames, 10.000s
 *     audio: aac, 48000 Hz, stereo, 10.005s
 *     2,663,572 bytes
 *
 * ## What it is a benchmark *of*
 *
 * It is 720p — the same resolution Motion 1 already produces. The gap between
 * it and current Atheos output is not pixels: it is shot structure, continuity
 * across cuts, a single colour decision holding the piece together, and sound
 * that moves with the camera. Reading it as a resolution target would be the
 * wrong lesson and an expensive one.
 *
 * ## Why the shot list is here
 *
 * The four shots were established by extracting frames at 1.5s, 4.0s, 6.0s and
 * 8.5s and looking at them, not by inferring a structure from the prompt. Two
 * facts held in all four: the ocean stayed on the same side, and the same two
 * occupants were in the car. Those are the continuity properties the director
 * plan exists to reproduce.
 *
 * The media file itself is not committed — it is the user's, it is 2.6MB, and
 * the brief forbids uploading it anywhere. These measurements are what the test
 * suite needs, and they are enough.
 */

export const CINEMATIC_BENCHMARK = {
  source: "user-supplied Gemini reference clip, measured 2026-08-21",

  video: {
    codec: "h264",
    width: 1280,
    height: 720,
    /** Exact, not 23.976 — the container reports 24/1. */
    frameRate: 24,
    frameCount: 240,
    durationSeconds: 10.0,
  },

  audio: {
    codec: "aac",
    sampleRate: 48_000,
    channels: 2,
    /**
     * 5ms longer than the picture. A container artefact rather than a sync
     * error, and the reason `validateAudioTechnical` tolerates 50ms instead of
     * demanding equality: a rule strict enough to fail this file would be a
     * rule that fails good output.
     */
    durationSeconds: 10.005,
  },

  fileBytes: 2_663_572,

  /** Confirmed by looking at extracted frames, in order. */
  shots: [
    { at: 1.5, angle: "rear aerial tracking", framing: "entire vehicle" },
    { at: 4.0, angle: "high side aerial", framing: "vehicle and road" },
    { at: 6.0, angle: "near-vertical top-down", framing: "vehicle centred" },
    { at: 8.5, angle: "wide coastal pullback", framing: "vehicle small" },
  ],

  /** Held in every frame inspected. */
  continuity: {
    oceanSide: "right",
    occupants: 2,
    sameVehicleThroughout: true,
  },
} as const;

/** The claim that must never be made about this file. */
export const BENCHMARK_IS_NOT_HD_PLUS = CINEMATIC_BENCHMARK.video.height < 1080;
