import "server-only";

import { AUDIO_CAPABILITIES } from "@/services/ai/audio-strategy";
import { probeMp4 } from "@/services/video/container-probe";
import {
  measureDecodedAudio,
  type DecodedAudio,
} from "@/services/video/decoded-audio";

/**
 * The delivery verdict: structural evidence and decoded evidence, judged
 * together.
 *
 * ## Three outcomes, because two is a lie
 *
 * `pass` / `fail` forces every uncertain case into one of them, and both
 * answers are wrong. Audio that is audible but unusually quiet is not a
 * failure — refusing it destroys a render the customer may be perfectly happy
 * with. Nor is it a clean pass, because nobody has confirmed it is right.
 *
 * `best_effort` is that third answer: **delivered and charged, flagged for
 * review.** It is the honest state for "we measured it, it is not broken, and
 * it is not obviously good either".
 *
 * ## What each kind of evidence can settle
 *
 * The container probe proves a track's *absence* and reads its declared shape.
 * The decoder proves what the samples *contain*. They fail independently — a
 * truncated download breaks the parser, an unsupported codec breaks the
 * decoder — so both are reported and neither is inferred from the other.
 *
 * ## What none of it validates
 *
 * Signal, not meaning. These numbers can say a track is silent, clipped, quiet
 * or the wrong length. They cannot recognise a saxophone, detect dialogue, or
 * judge whether the sound matches the brief. No verdict here should ever be
 * described as confirming the intended audio.
 */

export type DeliveryOutcome = "pass" | "best_effort" | "fail";

export interface DeliveryVerdict {
  outcome: DeliveryOutcome;
  /** False only for `fail`. Best effort is delivered. */
  deliver: boolean;
  /** Reasons the delivery was refused. Empty unless `fail`. */
  failures: string[];
  /** Concerns that did not justify refusal. */
  warnings: string[];
  /** Sanitised. No URL, key, prompt, payload, email or secret can appear. */
  detail: VerdictDetail;
  /** Shown to the customer on `fail`. Never a parser or decoder message. */
  customerMessage?: string;
}

export interface VerdictDetail {
  modelId: string;
  container: "mp4" | "mov" | "unsupported";
  promisedAudio: boolean;
  /** Structural */
  hasAudioStream: boolean;
  codec?: string;
  sampleRate?: number;
  channels?: number;
  audioDurationSeconds?: number;
  videoDurationSeconds?: number;
  dataRateKbps?: number;
  containerError?: string;
  /** Decoded */
  decoded: boolean;
  decodeError?: string;
  peakDbfs?: number;
  rmsDbfs?: number;
  integratedLufs?: number;
  clippedRatio?: number;
  silenceRatio?: number;
  longestSilenceSeconds?: number;
  decodedDurationSeconds?: number;
}

// --- thresholds -------------------------------------------------------------

/**
 * Below this the track is treated as silence rather than quiet audio.
 *
 * -60 LUFS is roughly 40 dB below anything a person would call quiet, so a
 * track under it is not "hard to hear", it is nothing. Undefined loudness —
 * every block below the absolute gate — means the same thing and is handled
 * with it.
 */
const SILENCE_LUFS = -60;

/**
 * Below this the audio is audible but suspiciously quiet: `best_effort`.
 *
 * Streaming targets sit around -14 LUFS. The approved benchmark measured
 * -20.9 LUFS and the owner accepted it, so the line has to sit well below that
 * or it would flag known-good output. -40 LUFS is quiet enough to be worth a
 * human's attention and far enough from -20.9 not to cry wolf.
 */
const QUIET_LUFS = -40;

/** Share of samples at full scale that is worth flagging. */
const CLIPPING_WARN_RATIO = 0.0001;
/** Share of samples at full scale that means the audio is damaged. */
const CLIPPING_FAIL_RATIO = 0.01;

/** Share of the track that may be silent before it counts as effectively so. */
const EFFECTIVE_SILENCE_RATIO = 0.98;

/** Audio/video drift tolerance, seconds. Beyond a frame it is audible. */
const DRIFT_TOLERANCE = 0.05;

// --- container -------------------------------------------------------------

/**
 * Which containers this validates.
 *
 * MOV and MP4 are both ISO base media format — the same box tree, the same
 * `moov`/`trak`/`hdlr` structure — so the parser reads both. MOV previously
 * *abstained*, returning a pass because the checker declined to look, which is
 * indistinguishable from a pass it had earned.
 */
export function containerKind(mimeType: string): "mp4" | "mov" | "unsupported" {
  const type = mimeType.toLowerCase();
  if (type.includes("mp4")) return "mp4";
  if (type.includes("quicktime") || type.includes("mov")) return "mov";
  return "unsupported";
}

/** Does this model promise sound for this generation? */
export function promisesAudio(modelId: string, wantsSound: boolean): boolean {
  const model = AUDIO_CAPABILITIES[modelId];
  if (!model) return false;
  if (model.audioAlwaysOn) return true;
  return wantsSound && model.strategies.includes("NATIVE");
}

// --- the verdict -----------------------------------------------------------

export async function judgeDelivery(input: {
  modelId: string;
  mimeType: string;
  bytes: Buffer;
  wantsSound: boolean;
  requestedDurationSeconds?: number;
}): Promise<DeliveryVerdict> {
  const container = containerKind(input.mimeType);
  const promised = promisesAudio(input.modelId, input.wantsSound);

  const failures: string[] = [];
  const warnings: string[] = [];

  /**
   * A container we cannot read is never a silent pass.
   *
   * When audio was promised this is `best_effort`, not `pass`: we genuinely do
   * not know, and saying so is the point. Failing would charge the customer for
   * the narrowness of our reader; passing silently is what MOV used to do.
   */
  if (container === "unsupported") {
    const detail: VerdictDetail = {
      modelId: input.modelId,
      container,
      promisedAudio: promised,
      hasAudioStream: false,
      decoded: false,
      containerError: `unvalidated container: ${input.mimeType}`,
    };

    if (!promised) {
      return {
        outcome: "pass",
        deliver: true,
        failures: [],
        warnings: [],
        detail,
      };
    }

    return {
      outcome: "best_effort",
      deliver: true,
      failures: [],
      warnings: [
        `audio was promised but this container is not validated: ${input.mimeType}`,
      ],
      detail,
    };
  }

  const probe = probeMp4(input.bytes);
  const track = probe.audioTracks[0];

  /**
   * Decode only when it can tell us something.
   *
   * A silent model's output has nothing to measure, and decoding a 7 MB file to
   * confirm an expected absence is time spent on the delivery path for no
   * decision.
   */
  const decoded: DecodedAudio = promised
    ? await measureDecodedAudio(input.bytes)
    : { decoded: false };

  const detail: VerdictDetail = {
    modelId: input.modelId,
    container,
    promisedAudio: promised,
    hasAudioStream: probe.hasAudioStream,
    codec: track?.codec,
    sampleRate: track?.sampleRate,
    channels: track?.channels,
    audioDurationSeconds: track?.durationSeconds,
    videoDurationSeconds: probe.videoDurationSeconds,
    dataRateKbps: track?.dataRateKbps,
    containerError: probe.error,
    decoded: decoded.decoded,
    decodeError: decoded.decodeError,
    peakDbfs: decoded.peakDbfs,
    rmsDbfs: decoded.rmsDbfs,
    integratedLufs: decoded.integratedLufs,
    clippedRatio: decoded.clippedRatio,
    silenceRatio: decoded.silenceRatio,
    longestSilenceSeconds: decoded.longestSilenceSeconds,
    decodedDurationSeconds: decoded.durationSeconds,
  };

  // --- no promise: a silent file is correct -----------------------------
  if (!promised) {
    // A stream where none was promised is a mux bug, not a bonus — but it is
    // not the customer's problem and never blocks their delivery.
    if (probe.hasAudioStream) {
      warnings.push("a silent export contains an audio stream");
    }
    if (probe.error) {
      warnings.push(`container could not be read: ${probe.error}`);
    }
    return {
      outcome: "pass",
      deliver: true,
      failures: [],
      warnings,
      detail,
    };
  }

  // --- promised: structural ---------------------------------------------
  if (probe.error) {
    failures.push(`the file could not be read: ${probe.error}`);
  } else if (!probe.hasAudioStream) {
    failures.push("audio was promised and the file has no audio stream");
  }

  // --- promised: decoded --------------------------------------------------
  if (failures.length === 0) {
    if (!decoded.decoded) {
      failures.push(
        `audio was promised and could not be decoded: ${decoded.decodeError ?? "unknown"}`,
      );
    } else {
      judgeDecoded(decoded, failures, warnings);
    }
  }

  // --- promised: synchronisation -----------------------------------------
  /**
   * Drift against the file's own picture, and only when both are measurable.
   *
   * The decoded duration is preferred over the container's declared one: it is
   * the length of the samples that exist rather than the length the header
   * claims. Comparing either to the *requested* duration would fail a correctly
   * synchronised file for the encoder's rounding — a model asked for 8s
   * routinely returns 8.033.
   *
   * Checked independently of the decode outcome. Drift is readable from the
   * container's own headers, so gating it behind a successful decode would
   * throw away evidence we already hold — and a file that both fails to decode
   * *and* is out of sync should say so, because the two point at different
   * causes.
   */
  const audioSeconds = decoded.durationSeconds ?? track?.durationSeconds;
  const videoSeconds = probe.videoDurationSeconds;

  if (
    audioSeconds !== undefined &&
    videoSeconds !== undefined &&
    videoSeconds > 0
  ) {
    const drift = Math.abs(audioSeconds - videoSeconds);
    if (drift > DRIFT_TOLERANCE) {
      failures.push(
        audioSeconds < videoSeconds
          ? `audio is ${drift.toFixed(3)}s shorter than the video`
          : `audio is ${drift.toFixed(3)}s longer than the video`,
      );
    }
  } else if (videoSeconds === undefined) {
    warnings.push(
      "no video track duration, so synchronisation was not checked",
    );
  }

  if (failures.length > 0) {
    return {
      outcome: "fail",
      deliver: false,
      failures,
      warnings,
      detail,
      customerMessage:
        "This model was supposed to deliver sound and the finished video does not have usable audio. You have not been charged.",
    };
  }

  return {
    outcome: warnings.length > 0 ? "best_effort" : "pass",
    deliver: true,
    failures: [],
    warnings,
    detail,
  };
}

/**
 * Judge decoded samples.
 *
 * Silence and severe clipping fail. Quiet, mild clipping and partial silence
 * warn — they are conditions a human should look at, not ones worth destroying
 * a render over.
 */
function judgeDecoded(
  decoded: DecodedAudio,
  failures: string[],
  warnings: string[],
): void {
  const lufs = decoded.integratedLufs;

  /**
   * Undefined loudness means every block fell below the absolute gate, which
   * is what a silent track does. It is the same finding as a measured -70
   * LUFS, so it fails for the same reason rather than being treated as an
   * unmeasurable case.
   */
  if (lufs === undefined || lufs < SILENCE_LUFS) {
    failures.push("the audio track is silent");
  } else if (lufs < QUIET_LUFS) {
    warnings.push(
      `the audio is very quiet at ${lufs.toFixed(1)} LUFS and may be inaudible in normal listening`,
    );
  }

  if ((decoded.silenceRatio ?? 0) >= EFFECTIVE_SILENCE_RATIO) {
    failures.push(
      `${Math.round((decoded.silenceRatio ?? 0) * 100)}% of the track is silence`,
    );
  }

  const clipped = decoded.clippedRatio ?? 0;
  if (clipped >= CLIPPING_FAIL_RATIO) {
    failures.push(
      `${(clipped * 100).toFixed(1)}% of samples are clipped — the audio is distorted`,
    );
  } else if (clipped >= CLIPPING_WARN_RATIO) {
    warnings.push(
      `${(clipped * 100).toFixed(3)}% of samples reach full scale — possible clipping`,
    );
  }

  // A long unbroken gap inside otherwise fine audio is worth a look, not a
  // refusal: a deliberate pause is a legitimate creative choice.
  if ((decoded.longestSilenceSeconds ?? 0) > 2) {
    warnings.push(
      `${decoded.longestSilenceSeconds?.toFixed(1)}s of continuous silence`,
    );
  }
}
