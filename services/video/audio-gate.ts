import type { AudioStrategy } from "@/services/ai/audio-strategy";

/**
 * The audio stage: its own gate, its own failure, its own settlement.
 *
 * ## Why audio fails separately from video
 *
 * A video costs dollars and takes minutes; sound design costs half a cent and
 * takes five seconds. Treating them as one outcome means a failed audio call
 * throws away an expensive video that was perfectly good — so the stages settle
 * independently, and a failed audio stage never regenerates the picture.
 *
 * The rule that follows from that: an audio-only retry is a **new** quoted
 * authorisation, not an automatic second call. Half a cent is small enough to
 * spend carelessly and that is exactly why it needs the same discipline.
 */

export interface MeasuredAudio {
  hasStream: boolean;
  codec?: string;
  sampleRate?: number;
  channels?: number;
  durationSeconds?: number;
  /** Integrated loudness, LUFS. */
  integratedLufs?: number;
  /** True peak, dBTP. */
  truePeakDb?: number;
  /** Longest run of digital silence, seconds. */
  longestSilenceSeconds?: number;
  /** Set when a decoder could not read the file at all. */
  decodeError?: string;
}

export interface AudioPromise {
  strategy: AudioStrategy;
  videoDurationSeconds: number;
  allowSpeech: boolean;
  allowMusic: boolean;
}

export type AudioStageOutcome = "pass" | "fail" | "not_promised";

export interface AudioGateResult {
  outcome: AudioStageOutcome;
  /** Deliver the combined file? */
  deliverWithAudio: boolean;
  /** Keep the silent video regardless — it was paid for and it is fine. */
  preserveVideo: true;
  /** Settle the audio portion of the quote. */
  settleAudioCredits: boolean;
  /** Never true. Audio failing is not a reason to remake the picture. */
  regenerateVideo: false;
  /** An audio-only retry is offered, never taken automatically. */
  offerQuotedAudioRetry: boolean;
  failures: string[];
  warnings: string[];
  label: string;
}

const SUPPORTED_CODECS = ["aac", "mp3", "opus", "pcm_s16le", "flac"];

/**
 * Judge the audio stage.
 *
 * `not_promised` is a distinct outcome from `pass`: a silent video that was
 * sold as silent is correct, and reporting it as an audio pass would make the
 * accounting read as though sound had been delivered.
 */
export function runAudioGate(input: {
  measured: MeasuredAudio;
  promised: AudioPromise;
}): AudioGateResult {
  const { measured, promised } = input;
  const failures: string[] = [];
  const warnings: string[] = [];

  const base = {
    preserveVideo: true as const,
    regenerateVideo: false as const,
  };

  if (promised.strategy === "SILENT") {
    // A stream where none was promised is a mux bug, not a bonus.
    if (measured.hasStream) {
      warnings.push("a silent export contains an audio stream");
    }
    return {
      ...base,
      outcome: "not_promised",
      deliverWithAudio: false,
      settleAudioCredits: false,
      offerQuotedAudioRetry: false,
      failures: [],
      warnings,
      label: "Silent video",
    };
  }

  if (measured.decodeError) {
    failures.push(`the audio could not be decoded: ${measured.decodeError}`);
  } else if (!measured.hasStream) {
    failures.push("audio was promised and the file has no audio stream");
  } else {
    if (measured.codec && !SUPPORTED_CODECS.includes(measured.codec)) {
      failures.push(
        `audio codec ${measured.codec} is not supported for delivery`,
      );
    }
    if (measured.channels !== undefined && measured.channels < 1) {
      failures.push(`${measured.channels} audio channels`);
    }
    if (measured.sampleRate !== undefined && measured.sampleRate < 44_100) {
      failures.push(`sample rate ${measured.sampleRate} is below 44100`);
    }

    /**
     * Loudness must be *measurable*, not merely present.
     *
     * `NaN` from a failed loudness parse is the exact hole that let a file
     * through the video gate's silence check: `??` does not catch it and every
     * comparison against it is false. Unmeasurable is a failure on a stage that
     * was paid for.
     */
    const lufs = measured.integratedLufs;
    if (lufs === undefined || !Number.isFinite(lufs)) {
      failures.push(
        "audio was promised and its loudness could not be measured, so silence cannot be ruled out",
      );
    } else if (lufs < -60) {
      failures.push("the audio track is digital silence");
    }

    const peak = measured.truePeakDb;
    if (peak !== undefined && Number.isFinite(peak) && peak > 0) {
      failures.push(
        `true peak ${peak.toFixed(1)} dBTP — the audio is clipping`,
      );
    }

    if (measured.durationSeconds !== undefined) {
      const drift = Math.abs(
        measured.durationSeconds - promised.videoDurationSeconds,
      );
      // 50ms. A container can legitimately end a few milliseconds late; beyond
      // a frame it is audible on any hard sound.
      if (drift > 0.05) {
        failures.push(
          measured.durationSeconds < promised.videoDurationSeconds
            ? `audio is ${drift.toFixed(3)}s shorter than the video`
            : `audio is ${drift.toFixed(3)}s longer than the video`,
        );
      }
    }

    if ((measured.longestSilenceSeconds ?? 0) > 2) {
      warnings.push(
        `${measured.longestSilenceSeconds?.toFixed(1)}s of unexplained silence`,
      );
    }
  }

  const ok = failures.length === 0;

  return {
    ...base,
    outcome: ok ? "pass" : "fail",
    deliverWithAudio: ok,
    settleAudioCredits: ok,
    // Only the added-audio path can be retried — a native failure means the
    // whole video came back wrong and that is the video stage's problem.
    offerQuotedAudioRetry: !ok && promised.strategy === "ATHEOS_SOUND_DESIGN",
    failures,
    warnings,
    label: ok
      ? promised.strategy === "NATIVE"
        ? "Native synchronised audio"
        : "Atheos sound design"
      : "Audio stage failed — video preserved",
  };
}

// ---------------------------------------------------------------------------
// Accounting
// ---------------------------------------------------------------------------

export interface StageCost {
  provider: string;
  estimatedMicroUsd: number;
  actualMicroUsd?: number;
}

export interface GenerationAccounting {
  video: StageCost;
  audio?: StageCost;
  strategy: AudioStrategy;
  /** One number the customer sees, covering both stages. */
  quotedCredits: number;
  /** Reserved up front at the maximum of video + audio. */
  reservedCredits: number;
  /** Settled only for stages that passed. */
  settledCredits: number;
  releasedCredits: number;
  /** Zero for internal evaluation runs, whatever the provider cost. */
  customerCreditsDeducted: number;
  isInternalBenchmark: boolean;
}

/**
 * Settle a generation across both stages.
 *
 * The reservation covers the maximum of both stages before either runs, and
 * anything a failed stage did not earn is released rather than kept. An
 * internal benchmark records the provider cost and deducts nothing — the money
 * was real, the customer's credits were not involved.
 */
export function settleGeneration(input: {
  videoPassed: boolean;
  audioOutcome: AudioStageOutcome;
  quotedVideoCredits: number;
  quotedAudioCredits: number;
  isInternalBenchmark?: boolean;
  videoProvider: string;
  audioProvider?: string;
  videoEstimatedMicroUsd: number;
  videoActualMicroUsd?: number;
  audioEstimatedMicroUsd?: number;
  audioActualMicroUsd?: number;
  strategy: AudioStrategy;
}): GenerationAccounting {
  const reserved = input.quotedVideoCredits + input.quotedAudioCredits;

  const videoEarned = input.videoPassed ? input.quotedVideoCredits : 0;
  const audioEarned =
    input.audioOutcome === "pass" ? input.quotedAudioCredits : 0;
  const settled = videoEarned + audioEarned;

  const internal = input.isInternalBenchmark ?? false;

  return {
    video: {
      provider: input.videoProvider,
      estimatedMicroUsd: input.videoEstimatedMicroUsd,
      actualMicroUsd: input.videoActualMicroUsd,
    },
    audio: input.audioProvider
      ? {
          provider: input.audioProvider,
          estimatedMicroUsd: input.audioEstimatedMicroUsd ?? 0,
          actualMicroUsd: input.audioActualMicroUsd,
        }
      : undefined,
    strategy: input.strategy,
    quotedCredits: reserved,
    reservedCredits: reserved,
    settledCredits: settled,
    releasedCredits: reserved - settled,
    // The one line that keeps a benchmark off a customer's balance.
    customerCreditsDeducted: internal ? 0 : settled,
    isInternalBenchmark: internal,
  };
}
