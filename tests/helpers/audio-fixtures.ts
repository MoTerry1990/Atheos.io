/**
 * Deterministic audio and container fixtures, built in pure TypeScript.
 *
 * ## Why these are generated rather than committed
 *
 * No provider call, no binary in Git, no encoder dependency. Every byte here is
 * produced by arithmetic, so a fixture cannot drift, cannot expire, and cannot
 * quietly become a 7 MB blob nobody reviews.
 *
 * ## Why WAV for the signal fixtures
 *
 * The decoder returns PCM regardless of source codec, and every measurement in
 * `decoded-audio.ts` operates on that PCM. Calibrating silence, loudness and
 * clipping against WAV therefore tests exactly the same code path an AAC file
 * exercises, without needing an AAC *encoder* — which is the one thing pure JS
 * cannot reasonably provide.
 *
 * The real AAC path is covered separately by the owner-approved benchmark and
 * by the container fixtures below.
 *
 * ## Why hand-built MP4/MOV for the container fixtures
 *
 * The structural checks read the box tree, so the fixtures have to *be* box
 * trees. Building them here means a malformed file is malformed in a specific,
 * chosen way rather than however a corrupted download happened to land.
 */

// ---------------------------------------------------------------------------
// PCM signals
// ---------------------------------------------------------------------------

export const SAMPLE_RATE = 48_000;

/** dBFS → linear amplitude. */
export const amplitude = (dbfs: number) => 10 ** (dbfs / 20);

export interface SignalOptions {
  seconds?: number;
  sampleRate?: number;
  channels?: number;
}

/** A 1 kHz sine at a chosen level — the reference signal for calibration. */
export function sine(
  dbfs: number,
  { seconds = 3, sampleRate = SAMPLE_RATE, channels = 2 }: SignalOptions = {},
): Float32Array[] {
  const amp = amplitude(dbfs);
  const frames = Math.round(seconds * sampleRate);

  return Array.from({ length: channels }, () => {
    const data = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      data[i] = amp * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }
    return data;
  });
}

/** Digital silence: every sample exactly zero. */
export function silence({
  seconds = 3,
  sampleRate = SAMPLE_RATE,
  channels = 2,
}: SignalOptions = {}): Float32Array[] {
  const frames = Math.round(seconds * sampleRate);
  return Array.from({ length: channels }, () => new Float32Array(frames));
}

/**
 * Deliberately clipped: a sine driven past full scale and hard-limited.
 *
 * `fraction` is roughly how much of the waveform flattens, so a test can ask
 * for mild clipping (a warning) or severe clipping (a failure) rather than
 * hoping a single fixture lands on the right side of both thresholds.
 */
export function clipped(
  fraction: number,
  { seconds = 3, sampleRate = SAMPLE_RATE, channels = 2 }: SignalOptions = {},
): Float32Array[] {
  // Driving a sine by 1/sin(θ) flattens the top `fraction` of each half-cycle.
  const drive = 1 / Math.sin((Math.PI / 2) * (1 - fraction));
  const frames = Math.round(seconds * sampleRate);

  return Array.from({ length: channels }, () => {
    const data = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const raw = drive * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
      data[i] = Math.max(-1, Math.min(1, raw));
    }
    return data;
  });
}

/**
 * Dynamic content: a tone that rises and falls, with a quiet passage.
 *
 * Closer to real audio than a constant sine — it exercises the gating in the
 * loudness measurement, which a steady tone does not.
 */
export function dynamic({
  seconds = 4,
  sampleRate = SAMPLE_RATE,
  channels = 2,
}: SignalOptions = {}): Float32Array[] {
  const frames = Math.round(seconds * sampleRate);

  return Array.from({ length: channels }, () => {
    const data = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      // Envelope: loud, quiet, loud.
      const envelope = t < seconds * 0.4 ? 0.5 : t < seconds * 0.6 ? 0.02 : 0.4;
      data[i] =
        envelope * Math.sin((2 * Math.PI * 440 * i) / sampleRate) +
        envelope * 0.3 * Math.sin((2 * Math.PI * 1320 * i) / sampleRate);
    }
    return data;
  });
}

/** Mostly silent, with one short blip — "effectively silent" but not exactly. */
export function nearlySilent({
  seconds = 4,
  sampleRate = SAMPLE_RATE,
  channels = 2,
}: SignalOptions = {}): Float32Array[] {
  const frames = Math.round(seconds * sampleRate);
  const blip = Math.round(sampleRate * 0.02);

  return Array.from({ length: channels }, () => {
    const data = new Float32Array(frames);
    for (let i = 0; i < blip; i++) {
      data[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }
    return data;
  });
}

// ---------------------------------------------------------------------------
// WAV container
// ---------------------------------------------------------------------------

/** Wrap PCM in a 44-byte canonical WAV header. 16-bit, little-endian. */
export function wav(
  channels: Float32Array[],
  sampleRate = SAMPLE_RATE,
): Buffer {
  const frames = channels[0]?.length ?? 0;
  const count = channels.length;
  const dataBytes = frames * count * 2;

  const out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16); // PCM chunk size
  out.writeUInt16LE(1, 20); // format: PCM
  out.writeUInt16LE(count, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * count * 2, 28); // byte rate
  out.writeUInt16LE(count * 2, 32); // block align
  out.writeUInt16LE(16, 34); // bits per sample
  out.write("data", 36);
  out.writeUInt32LE(dataBytes, 40);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      // Asymmetric on purpose: 32767 is full scale positive, -32768 negative.
      out.writeInt16LE(Math.round(sample * 32767), offset);
      offset += 2;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// ISO base media containers — MP4 and MOV
// ---------------------------------------------------------------------------

/** `size(4) type(4) payload` */
export function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.byteLength + 8, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
}

function hdlr(handler: "soun" | "vide"): Buffer {
  const payload = Buffer.alloc(13);
  payload.write(handler, 8, "latin1");
  return box("hdlr", payload);
}

function mdhd(seconds: number, timescale = SAMPLE_RATE): Buffer {
  const payload = Buffer.alloc(20);
  payload.writeUInt32BE(timescale, 12);
  payload.writeUInt32BE(Math.round(seconds * timescale), 16);
  return box("mdhd", payload);
}

/**
 * An `mp4a` sample entry.
 *
 * Offsets from the end of the box header: channelcount at +16, samplerate's
 * integer half at +24. Written out rather than copied from the parser so the
 * two cannot share a mistake — which is exactly how an eight-byte error once
 * survived a full test suite and failed a real render.
 */
function audioStsd(channels = 2, sampleRate = SAMPLE_RATE): Buffer {
  const body = Buffer.alloc(28);
  body.writeUInt16BE(channels, 16);
  body.writeUInt16BE(16, 18); // sample size
  body.writeUInt16BE(sampleRate, 24);

  const count = Buffer.alloc(8);
  count.writeUInt32BE(1, 4);
  return box("stsd", Buffer.concat([count, box("mp4a", body)]));
}

function videoStsd(): Buffer {
  const count = Buffer.alloc(8);
  count.writeUInt32BE(1, 4);
  return box("stsd", Buffer.concat([count, box("avc1", Buffer.alloc(70))]));
}

/** `stsz` with a per-sample table, which is what real encoders emit. */
function stsz(sizes: number[]): Buffer {
  const payload = Buffer.alloc(12 + sizes.length * 4);
  payload.writeUInt32BE(0, 4);
  payload.writeUInt32BE(sizes.length, 8);
  sizes.forEach((size, i) => payload.writeUInt32BE(size, 12 + i * 4));
  return box("stsz", payload);
}

export interface TrackOptions {
  handler: "soun" | "vide";
  seconds: number;
  channels?: number;
  sampleRate?: number;
  /** Average bytes per frame, used to build a plausible `stsz`. */
  frameBytes?: number;
}

export function trak(options: TrackOptions): Buffer {
  const { handler, seconds } = options;
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;

  // ~21.3 ms per AAC frame at 48 kHz.
  const frameCount = Math.max(1, Math.round(seconds / 0.0213));
  const sizes = Array.from(
    { length: frameCount },
    () => options.frameBytes ?? 683,
  );

  const stbl = box(
    "stbl",
    Buffer.concat([
      handler === "soun"
        ? audioStsd(options.channels ?? 2, sampleRate)
        : videoStsd(),
      stsz(sizes),
    ]),
  );

  return box(
    "trak",
    box(
      "mdia",
      Buffer.concat([
        mdhd(seconds, sampleRate),
        hdlr(handler),
        box("minf", stbl),
      ]),
    ),
  );
}

/**
 * A whole file.
 *
 * `brand` is what separates an MP4 from a MOV at the byte level — the box tree
 * is identical, which is why both are parseable and why the MIME type alone
 * must never be trusted to describe the contents.
 */
export function isoFile(
  traks: Buffer[],
  brand: "isom" | "qt  " = "isom",
): Buffer {
  const ftyp = box(
    "ftyp",
    Buffer.concat([
      Buffer.from(brand, "latin1"),
      Buffer.alloc(4),
      Buffer.from(brand, "latin1"),
    ]),
  );
  return Buffer.concat([ftyp, box("moov", Buffer.concat(traks))]);
}

// ---------------------------------------------------------------------------
// Named fixtures
// ---------------------------------------------------------------------------

export const fixtures = {
  /** 1. Video only — no audio track at all. */
  mp4NoAudio: () => isoFile([trak({ handler: "vide", seconds: 8 })]),

  /** 4. Video and audio of matching length. */
  mp4WithAudio: () =>
    isoFile([
      trak({ handler: "vide", seconds: 8 }),
      trak({ handler: "soun", seconds: 8 }),
    ]),

  /** 6. Audio materially shorter than the picture. */
  mp4AudioShort: () =>
    isoFile([
      trak({ handler: "vide", seconds: 8 }),
      trak({ handler: "soun", seconds: 7.5 }),
    ]),

  /** 7. Audio materially longer than the picture. */
  mp4AudioLong: () =>
    isoFile([
      trak({ handler: "vide", seconds: 8 }),
      trak({ handler: "soun", seconds: 8.6 }),
    ]),

  /** An audio track carrying almost no data — silence-shaped. */
  mp4LowDataRate: () =>
    isoFile([
      trak({ handler: "vide", seconds: 8 }),
      trak({ handler: "soun", seconds: 8, frameBytes: 10 }),
    ]),

  /** 8. Malformed: a box claiming more bytes than the file holds. */
  malformedMp4: () => {
    const file = fixtures.mp4WithAudio();
    return file.subarray(0, file.byteLength - 40);
  },

  /** 9/10. MOV equivalents — same box tree, QuickTime brand. */
  movWithAudio: () =>
    isoFile(
      [
        trak({ handler: "vide", seconds: 8 }),
        trak({ handler: "soun", seconds: 8 }),
      ],
      "qt  ",
    ),

  movNoAudio: () => isoFile([trak({ handler: "vide", seconds: 8 })], "qt  "),

  /** 11. Malformed MOV. */
  malformedMov: () => {
    const file = fixtures.movWithAudio();
    return file.subarray(0, file.byteLength - 40);
  },

  /** Not a container at all. */
  notAVideo: () => Buffer.from("this is plainly not a video file", "latin1"),

  // --- decodable signal fixtures (WAV) ---------------------------------
  /** 2. Digital silence. */
  wavSilence: (options?: SignalOptions) => wav(silence(options)),
  /** 3. Quiet but audible. */
  wavQuiet: () => wav(sine(-45)),
  /** 4. Normal dynamic sound. */
  wavNormal: () => wav(dynamic()),
  /** 5. Clipped and distorted. */
  wavClipped: () => wav(clipped(0.4)),
  /**
   * Mild clipping — a warning, not a failure.
   *
   * A signal with headroom, plus a handful of samples pinned to full scale.
   * Built this way rather than by lightly over-driving a sine: at 16-bit
   * quantisation the whole peak region of a near-full-scale sine rounds to
   * 32767, so "barely clipped" measures as 4% clipped and lands on the wrong
   * side of every threshold.
   */
  wavMildClipping: () => {
    const channels = sine(-12);
    for (const channel of channels) {
      // Roughly 0.02% of samples, spread rather than contiguous.
      for (let i = 0; i < channel.length; i += 5_000) channel[i] = 1;
    }
    return wav(channels);
  },
  /** Effectively silent: one 20 ms blip in four seconds. */
  wavNearlySilent: () => wav(nearlySilent()),
  /** A calibration reference at a known level. */
  wavReference: (dbfs = -20) => wav(sine(dbfs)),
};
