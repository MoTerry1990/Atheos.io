import "server-only";

/**
 * What the audio actually sounds like, measured from decoded samples.
 *
 * ## Why this exists alongside the container probe
 *
 * `container-probe.ts` reads the file's index. It can prove a track is
 * *absent*, and it cannot prove that a track which exists carries anything but
 * silence — a valid AAC track holding eight seconds of nothing passes it
 * cleanly. That gap was recorded in `DELIVERY_MEASUREMENT_SPEC.md` and this
 * module is the thing that closes it.
 *
 * The two stay independent on purpose. Structural evidence and decoded evidence
 * fail in different ways: a truncated download breaks the parser, an
 * unsupported codec breaks the decoder, and a gate that folded them together
 * could not tell you which happened.
 *
 * ## What it validates, and what it does not
 *
 * It measures **signal**, not meaning. It can say a track is silent, clipped,
 * quiet, or the wrong length. It cannot tell a saxophone from a jackhammer,
 * cannot detect dialogue, and cannot judge whether the sound is the one the
 * brief asked for. Any claim beyond "there is audible signal of this level" is
 * outside what these numbers support.
 *
 * ## Why a WASM decoder rather than FFmpeg
 *
 * There is no separate execution environment: the worker is a Vercel cron
 * calling a serverless route, so everything runs in the same Node lambda.
 * FFmpeg would mean an 80 MB binary downloaded from a third-party release at
 * every build, plus an entry in this project's deliberate `allowScripts`
 * allowlist. `audio-decode` is 400 KB of WASM and decoded a real 7.3 MB render
 * in 187 ms in the deployed lambda, at 149 MB RSS. Proven before it was
 * adopted, not after.
 */

export interface DecodedAudio {
  /** False when the decoder could not produce samples at all. */
  decoded: boolean;
  /** Class name only — a decoder message can carry a path. */
  decodeError?: string;

  channels?: number;
  sampleRate?: number;
  /** Seconds, from sample count. The most trustworthy duration available. */
  durationSeconds?: number;

  /** Highest absolute sample, dBFS. 0 means full scale. */
  peakDbfs?: number;
  /** Unweighted RMS across the whole track, dBFS. */
  rmsDbfs?: number;
  /**
   * Integrated loudness, LUFS, per ITU-R BS.1770-4.
   *
   * K-weighted and gated — not RMS wearing a different label. Undefined when
   * every block falls below the absolute gate, which is what a silent track
   * does and is reported as silence rather than as a loudness of zero.
   */
  integratedLufs?: number;

  /** Samples at or beyond full scale. */
  clippedSamples?: number;
  /** Share of the track at or beyond full scale, 0–1. */
  clippedRatio?: number;

  /** Share of 20 ms windows below the silence floor, 0–1. */
  silenceRatio?: number;
  /** Longest unbroken run of silent windows, seconds. */
  longestSilenceSeconds?: number;
}

/** Below this, a window counts as silence. Digital black is -inf. */
const SILENCE_FLOOR_DBFS = -60;

/** BS.1770 measurement block. */
const BLOCK_SECONDS = 0.4;
/** 75% overlap, as the standard specifies. */
const BLOCK_STEP = 0.1;

/** Absolute gate, LUFS. Blocks quieter than this never count. */
const ABSOLUTE_GATE_LUFS = -70;

const dB = (value: number) => 20 * Math.log10(Math.max(value, 1e-12));

/**
 * Decode and measure.
 *
 * Returns `decoded: false` rather than throwing: a file we cannot read is a
 * measurement that did not happen, and the *gate* decides what that means. This
 * function reports; it does not judge.
 */
export async function measureDecodedAudio(
  bytes: Buffer,
): Promise<DecodedAudio> {
  let channelData: Float32Array[];
  let sampleRate: number;

  try {
    /**
     * Imported lazily so the WASM is loaded only on a path that needs it.
     * Image generations never touch a decoder, and paying its startup on every
     * cold start would tax the common case for the rare one.
     */
    const decode = (await import("audio-decode")).default;
    const audio = (await decode(bytes)) as {
      channelData: Float32Array[];
      sampleRate: number;
    };

    channelData = audio.channelData ?? [];
    sampleRate = audio.sampleRate;

    if (channelData.length === 0 || !sampleRate) {
      return { decoded: false, decodeError: "decoder returned no samples" };
    }
  } catch (error) {
    return {
      decoded: false,
      decodeError:
        error instanceof Error ? error.constructor.name : typeof error,
    };
  }

  const frames = channelData[0].length;
  if (frames === 0) {
    return {
      decoded: true,
      channels: channelData.length,
      sampleRate,
      durationSeconds: 0,
      decodeError: "decoded to zero frames",
    };
  }

  // --- Peak, RMS and clipping, in one pass ------------------------------
  let peak = 0;
  let sumSquares = 0;
  let clipped = 0;

  for (const channel of channelData) {
    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i];
      const magnitude = sample < 0 ? -sample : sample;
      if (magnitude > peak) peak = magnitude;
      sumSquares += sample * sample;
      // 0.999 rather than 1.0: a decoder's float output of a clipped integer
      // sample lands fractionally short of full scale.
      if (magnitude >= 0.999) clipped++;
    }
  }

  const totalSamples = frames * channelData.length;
  const rms = Math.sqrt(sumSquares / totalSamples);

  const silence = measureSilence(channelData, sampleRate);

  return {
    decoded: true,
    channels: channelData.length,
    sampleRate,
    durationSeconds: frames / sampleRate,
    peakDbfs: round(dB(peak)),
    rmsDbfs: round(dB(rms)),
    integratedLufs: integratedLoudness(channelData, sampleRate),
    clippedSamples: clipped,
    clippedRatio: clipped / totalSamples,
    silenceRatio: silence.ratio,
    longestSilenceSeconds: silence.longestSeconds,
  };
}

/** Two decimal places. These are display figures, not accumulators. */
function round(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : -Infinity;
}

/**
 * How much of the track is silent, in 20 ms windows.
 *
 * Windowed rather than per-sample because a waveform crosses zero constantly —
 * counting individual samples below a threshold would report roughly half of
 * any signal as "silent".
 */
function measureSilence(
  channels: Float32Array[],
  sampleRate: number,
): { ratio: number; longestSeconds: number } {
  const windowSize = Math.max(1, Math.round(sampleRate * 0.02));
  const frames = channels[0].length;

  let windows = 0;
  let silentWindows = 0;
  let run = 0;
  let longestRun = 0;

  for (let start = 0; start < frames; start += windowSize) {
    const end = Math.min(start + windowSize, frames);
    let sum = 0;
    let count = 0;

    for (const channel of channels) {
      for (let i = start; i < end; i++) {
        sum += channel[i] * channel[i];
        count++;
      }
    }

    windows++;
    const windowRms = Math.sqrt(sum / Math.max(count, 1));

    if (dB(windowRms) < SILENCE_FLOOR_DBFS) {
      silentWindows++;
      run++;
      if (run > longestRun) longestRun = run;
    } else {
      run = 0;
    }
  }

  return {
    ratio: silentWindows / Math.max(windows, 1),
    longestSeconds: Number((longestRun * 0.02).toFixed(2)),
  };
}

/**
 * Integrated loudness in LUFS, per ITU-R BS.1770-4.
 *
 * ## Why implement the real algorithm rather than report RMS
 *
 * RMS and LUFS are different numbers and every published threshold — streaming
 * targets, broadcast limits, the -60 LUFS silence line in the delivery gate —
 * is stated in LUFS. Reporting RMS under a LUFS field name would make the gate
 * compare against thresholds it does not actually measure, which is the kind of
 * quiet wrongness that survives for months.
 *
 * The three parts that make it BS.1770 rather than an average:
 *
 *   1. **K-weighting** — a high-shelf then a high-pass, approximating how
 *      loudness is perceived across frequency.
 *   2. **400 ms blocks at 75% overlap**, so a short loud passage is not
 *      averaged away.
 *   3. **Two gates** — an absolute one at -70 LUFS and a relative one 10 LU
 *      below the ungated mean, so silence between phrases does not drag the
 *      figure down.
 *
 * Returns undefined when nothing survives the gates. That is a silent track,
 * and reporting it as a number would invite a comparison that reads as "quiet"
 * rather than "nothing here".
 */
function integratedLoudness(
  channels: Float32Array[],
  sampleRate: number,
): number | undefined {
  const weighted = channels.map((channel) => kWeight(channel, sampleRate));

  const blockSize = Math.round(sampleRate * BLOCK_SECONDS);
  const stepSize = Math.round(sampleRate * BLOCK_STEP);
  const frames = weighted[0].length;
  if (frames < blockSize) return undefined;

  /**
   * Channel weights. Mono and stereo are 1.0 each; surround channels carry
   * 1.41 for the rear pair, which nothing here produces but which is named so
   * the omission is a decision rather than an oversight.
   */
  const channelWeight = 1.0;

  const blockLoudness: number[] = [];

  for (let start = 0; start + blockSize <= frames; start += stepSize) {
    let sum = 0;
    for (const channel of weighted) {
      let channelSum = 0;
      for (let i = start; i < start + blockSize; i++) {
        channelSum += channel[i] * channel[i];
      }
      sum += channelWeight * (channelSum / blockSize);
    }
    // -0.691 is the calibration constant from the standard.
    blockLoudness.push(-0.691 + 10 * Math.log10(Math.max(sum, 1e-12)));
  }

  const aboveAbsolute = blockLoudness.filter((l) => l > ABSOLUTE_GATE_LUFS);
  if (aboveAbsolute.length === 0) return undefined;

  // Relative gate: 10 LU below the mean of what survived the absolute gate.
  const ungatedMean = meanLoudness(aboveAbsolute);
  const relativeGate = ungatedMean - 10;

  const gated = aboveAbsolute.filter((l) => l > relativeGate);
  if (gated.length === 0) return undefined;

  return round(meanLoudness(gated));
}

/** Mean in the energy domain, not the decibel domain. */
function meanLoudness(blocks: number[]): number {
  let energy = 0;
  for (const block of blocks) energy += 10 ** ((block + 0.691) / 10);
  return -0.691 + 10 * Math.log10(Math.max(energy / blocks.length, 1e-12));
}

/**
 * The K-weighting filter: a high-shelf, then a high-pass.
 *
 * Coefficients are the standard's, specified at 48 kHz. They are applied at
 * whatever rate the file carries, which is exact for 48 kHz material and a
 * close approximation elsewhere — every model in the catalogue outputs 48 kHz,
 * and the alternative (re-deriving coefficients per rate) is a bilinear
 * transform for an accuracy nobody here can act on.
 */
function kWeight(input: Float32Array, sampleRate: number): Float32Array {
  // Stage 1 — high-shelf, +4 dB above ~1.5 kHz.
  const shelf = biquad(
    input,
    1.53512485958697,
    -2.69169618940638,
    1.19839281085285,
    -1.69065929318241,
    0.73248077421585,
  );

  // Stage 2 — high-pass at ~38 Hz.
  return biquad(shelf, 1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621);

  /** Direct Form I. Sample rate is unused: see the note above. */
  function biquad(
    samples: Float32Array,
    b0: number,
    b1: number,
    b2: number,
    a1: number,
    a2: number,
  ): Float32Array {
    void sampleRate;
    const out = new Float32Array(samples.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;

    for (let i = 0; i < samples.length; i++) {
      const x0 = samples[i];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      out[i] = y0;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }

    return out;
  }
}
