/**
 * The gate a generated video has to pass before anyone is told it is finished.
 *
 * ## The failure this exists for
 *
 * The latest Atheos baseline was delivered as a completed generation. Probed, it
 * is 1920x1088 with **no audio stream at all** and **zero cuts** — while the
 * composer that produced it displayed "Soundscape added by Atheos" and a
 * four-shot plan. Two of those three promises had no implementation behind them
 * and nothing in the pipeline noticed.
 *
 * A promise the pipeline cannot keep is a failed deliverable, not a quality
 * footnote. So the gate runs before delivery, and a failure means the file is
 * not handed over and the credits are not finalised.
 *
 * ## Cut detection has to be a validated method
 *
 * The first attempt used `select='gt(scene,T)'` with `showinfo`. Run against the
 * Gemini reference — a file with three known cuts — it reported **none**, at
 * every threshold. It had been reporting "zero cuts" for Atheos output too, and
 * that number happened to be right for the wrong reason.
 *
 * `scdet` is the method that works, and it was checked against the reference
 * before being trusted:
 *
 *   ffmpeg -i in.mp4 -vf "scdet=threshold=0,metadata=print:file=-" -f null -
 *
 * On the reference that yields scores 13.2, 23.3 and 20.0 at 2.167s, 4.917s and
 * 7.417s, with the next-highest frame at 8.7. On the Atheos baseline the highest
 * score anywhere is 2.28. `CUT_SCORE_THRESHOLD` sits between the two.
 */

/** Above this a frame is an edit; below it, camera movement. */
export const CUT_SCORE_THRESHOLD = 10;

/** The ffmpeg invocation that produced every score quoted above. */
export const SCDET_RECIPE =
  'ffmpeg -v info -i INPUT -vf "scdet=threshold=0,metadata=print:file=-" -f null -';

export interface MeasuredVideo {
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  width: number;
  height: number;
  frameRate: number;
  durationSeconds: number;
  /** Peak audio level, dBFS. -91 or lower is a silent track. */
  audioPeakDb?: number;
  audioDurationSeconds?: number;
  audioChannels?: number;
  audioSampleRate?: number;
  /** Every `lavfi.scd` score above `CUT_SCORE_THRESHOLD`, in seconds. */
  cutTimestamps: readonly number[];
}

export interface DeliveryPromise {
  durationSeconds: number;
  aspectRatio: "16:9" | "9:16";
  /** What the model renders. Compared before any normalisation step. */
  nativeHeight: 720 | 1080;
  /** True when the mode advertised sound of any origin. */
  audioPromised: boolean;
  /** Shots the user was told they would get. 1 means continuous. */
  shotsPromised: number;
}

export type GateOutcome = "pass" | "best_effort" | "fail";

export interface GateResult {
  outcome: GateOutcome;
  /** Hand the file over? False for `fail`. */
  deliver: boolean;
  /** Take the money? False for anything but a pass. */
  settleCredits: boolean;
  failures: string[];
  warnings: string[];
  /** What the UI may call the result. Never a claim the file does not support. */
  label: string;
}

/**
 * Judge a finished file against what was promised.
 *
 * Three outcomes rather than two. `best_effort` exists because shot counting is
 * a heuristic: a film can cut on a match so clean that no detector sees it, and
 * refusing delivery on that would be worse than saying so. A missing audio
 * stream is not a heuristic, and it fails outright.
 */
export function runDeliveryGate(input: {
  measured: MeasuredVideo;
  promised: DeliveryPromise;
}): GateResult {
  const { measured, promised } = input;
  const failures: string[] = [];
  const warnings: string[] = [];

  if (!measured.hasVideoStream) {
    return {
      outcome: "fail",
      deliver: false,
      settleCredits: false,
      failures: ["the file has no video stream"],
      warnings: [],
      label: "Generation failed",
    };
  }

  // --- Audio: the promise that was broken, so it is checked hardest --------
  if (promised.audioPromised) {
    if (!measured.hasAudioStream) {
      failures.push(
        "audio was promised and the file has no audio stream at all",
      );
    } else {
      /**
       * An unmeasurable level fails, rather than passing by default.
       *
       * This was `(peak ?? -100) < -60`, which reads as fail-closed and is not:
       * `??` catches null and undefined but **not NaN**, and a failed
       * `volumedetect` parse yields NaN. `NaN < -60` is false, so a file whose
       * loudness could not be read sailed through the silence check — caught by
       * running the gate against the real reference file, where the peak came
       * back NaN and the file passed anyway.
       *
       * On a mode that promised audio, "we could not tell" is not "it is fine".
       */
      const peak = measured.audioPeakDb;
      if (peak === undefined || !Number.isFinite(peak)) {
        failures.push(
          "audio was promised and its level could not be measured, so silence cannot be ruled out",
        );
      } else if (peak < -60) {
        failures.push("the audio stream is present but silent");
      }
      const drift = Math.abs(
        (measured.audioDurationSeconds ?? 0) - measured.durationSeconds,
      );
      if (drift > 0.05) {
        failures.push(`audio is ${drift.toFixed(3)}s out from the picture`);
      }
      if (measured.audioChannels !== 2) {
        warnings.push(
          `${measured.audioChannels} audio channel(s), expected stereo`,
        );
      }
      if (measured.audioSampleRate !== 48_000) {
        warnings.push(
          `audio sample rate ${measured.audioSampleRate}, expected 48000`,
        );
      }
    }
  }

  // --- Duration ------------------------------------------------------------
  const durationDrift = Math.abs(
    measured.durationSeconds - promised.durationSeconds,
  );
  /**
   * One frame of tolerance, measured in frames rather than seconds.
   *
   * The baseline is 241 frames at 24fps against a 10-second promise: exactly
   * one frame over, and exactly the case this is meant to forgive. Written as
   * `drift > 1/24` it *failed*, because 241/24 rounds to 10.041667 while 1/24
   * is 10.0416666…, putting a legitimate file a hair on the wrong side of the
   * line. Comparing frame counts with a small epsilon removes the cliff instead
   * of widening the tolerance to hide it.
   */
  const framesDrift = durationDrift * measured.frameRate;
  if (framesDrift > 1 + 1e-3) {
    failures.push(
      `the file is ${measured.durationSeconds.toFixed(3)}s, not the ${promised.durationSeconds}s promised`,
    );
  }

  // --- Geometry ------------------------------------------------------------
  const [w, h] = promised.aspectRatio.split(":").map(Number);
  const wantRatio = w / h;
  const gotRatio = measured.width / measured.height;
  if (Math.abs(gotRatio - wantRatio) / wantRatio > 0.02) {
    failures.push(`the file is not ${promised.aspectRatio}`);
  }

  /**
   * 1088 is a warning, not a failure.
   *
   * H.264 codes in 16-pixel macroblocks and 1080 is not a multiple of 16, so
   * encoders pad to 1088 and signal a crop. The baseline came back 1920x1088.
   * The picture is correct; the container is non-standard, and some players and
   * most editors will letterbox or complain. Post-production crops it back.
   */
  if (measured.height !== promised.nativeHeight) {
    if (measured.height === 1088 && promised.nativeHeight === 1080) {
      warnings.push(
        "1920x1088 — macroblock padding, normalised to 1920x1080 in post",
      );
    } else {
      failures.push(
        `${measured.width}x${measured.height} is not the ${promised.nativeHeight}p promised`,
      );
    }
  }

  // --- Shot structure ------------------------------------------------------
  const cuts = measured.cutTimestamps.filter(
    (t) => t > 0.1 && t < measured.durationSeconds - 0.1,
  );
  const shotsFound = cuts.length + 1;
  let uncertain = false;

  if (promised.shotsPromised > 1) {
    if (shotsFound === promised.shotsPromised) {
      // Delivered as advertised.
    } else if (cuts.length === 0) {
      /**
       * Zero cuts against a multi-shot promise is not a near miss. It is the
       * baseline's exact failure: one continuous orbit sold as four shots.
       */
      failures.push(
        `${promised.shotsPromised} shots were promised and the file has no cuts at all — it is one continuous take`,
      );
    } else {
      uncertain = true;
      warnings.push(
        `${shotsFound} shots detected, ${promised.shotsPromised} promised`,
      );
    }
  }

  const outcome: GateOutcome =
    failures.length > 0 ? "fail" : uncertain ? "best_effort" : "pass";

  return {
    outcome,
    deliver: outcome !== "fail",
    // Only a clean pass takes the money. A best-effort result is delivered and
    // left for review rather than billed on a heuristic.
    settleCredits: outcome === "pass",
    failures,
    warnings,
    label: describeOutcome(outcome, promised.shotsPromised, shotsFound),
  };
}

function describeOutcome(
  outcome: GateOutcome,
  promisedShots: number,
  foundShots: number,
): string {
  if (outcome === "fail") return "Generation failed — not delivered";
  if (promisedShots <= 1) return "Continuous clip";
  if (outcome === "pass") return `${foundShots}-shot commercial`;
  return `${foundShots} shots detected of ${promisedShots} — best effort, for review`;
}

// ---------------------------------------------------------------------------
// Phase 5 — deterministic post-production plan
// ---------------------------------------------------------------------------

export interface OverlayCue {
  text: string;
  start: number;
  end: number;
  emphasis: "headline" | "subhead";
}

export interface PostProductionPlan {
  /** Crop/pad to the standard frame. */
  targetWidth: number;
  targetHeight: number;
  frameRate: number;
  /** ffmpeg filter steps, in order. Built, never hand-written per call site. */
  filters: string[];
  /** Loudness target. -14 LUFS is the common web delivery figure. */
  loudnessTargetLufs: number;
  /** A copy with no text, when the customer wants the clean plate. */
  emitCleanVersion: boolean;
  notes: string[];
}

/**
 * Plan the post pass. Pure — it builds arguments, it does not run ffmpeg.
 *
 * Keeping this a plan rather than an execution is what lets the whole pipeline
 * be tested without a media file or a GPU, and it is why the overlay text can be
 * asserted byte-for-byte in a unit test.
 */
export function planPostProduction(input: {
  measured: Pick<MeasuredVideo, "width" | "height" | "frameRate">;
  aspectRatio: "16:9" | "9:16";
  overlays: readonly OverlayCue[];
  logoCorner?: "top-left" | "top-right" | "bottom-right";
  cleanVersion?: boolean;
}): PostProductionPlan {
  const [targetWidth, targetHeight] =
    input.aspectRatio === "16:9" ? [1920, 1080] : [1080, 1920];

  const filters: string[] = [];
  const notes: string[] = [];

  if (
    input.measured.width !== targetWidth ||
    input.measured.height !== targetHeight
  ) {
    // Centre crop rather than scale: the extra 8 rows on a 1088 file are
    // padding, and scaling them away would resample every pixel in the frame
    // to remove something that was never picture.
    filters.push(
      `crop=${targetWidth}:${targetHeight}:(iw-${targetWidth})/2:(ih-${targetHeight})/2`,
    );
    notes.push(
      `${input.measured.width}x${input.measured.height} centre-cropped to ${targetWidth}x${targetHeight}`,
    );
  }

  /**
   * 5% title-safe inset.
   *
   * The broadcast convention, and the reason a caption survives a 9:16 re-frame
   * or a phone with rounded corners.
   */
  const inset = Math.round(targetHeight * 0.05);

  for (const cue of input.overlays) {
    const size = cue.emphasis === "headline" ? 64 : 36;
    const y =
      cue.emphasis === "headline"
        ? `h-${inset + size + 24}`
        : `h-${inset + size}`;
    filters.push(
      // `drawtext` with an Atheos-controlled font file. The text is passed
      // through exactly as given — no case change, no truncation.
      `drawtext=text='${escapeDrawText(cue.text)}':fontsize=${size}:` +
        `x=(w-text_w)/2:y=${y}:fontcolor=white:` +
        `enable='between(t,${cue.start},${cue.end})'`,
    );
  }

  if (input.logoCorner) {
    notes.push(
      `logo composited ${input.logoCorner}, inside the ${inset}px safe area`,
    );
  }

  return {
    targetWidth,
    targetHeight,
    frameRate: input.measured.frameRate,
    filters,
    loudnessTargetLufs: -14,
    emitCleanVersion: input.cleanVersion ?? false,
    notes,
  };
}

/**
 * Escape a caption for ffmpeg's `drawtext`.
 *
 * Colons separate filter options and single quotes end the literal, so a slogan
 * containing either would break the filter graph — or worse, be silently
 * truncated at the colon and rendered as half a sentence.
 */
export function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}
