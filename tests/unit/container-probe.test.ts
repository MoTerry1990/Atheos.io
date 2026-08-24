import { describe, expect, it } from "vitest";

import { probeMp4 } from "@/services/video/container-probe";

/**
 * The MP4 box walker.
 *
 * ## Real containers, built byte by byte
 *
 * Every fixture here is an actual box tree rather than a mocked parser result.
 * A test that stubs the thing under test proves the stub works — and the whole
 * risk in this file is that the offsets are wrong by four bytes somewhere, which
 * only real bytes can catch.
 *
 * The builders below emit the minimum ISO/IEC 14496-12 structure the probe
 * reads: `ftyp`, then `moov > trak > mdia > {hdlr, mdhd, minf > stbl > stsd}`.
 */

/** `size(4) type(4) payload` */
function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.byteLength + 8, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
}

/** `hdlr`: version+flags(4) pre_defined(4) handler(4) name(1) */
function hdlr(handler: "soun" | "vide"): Buffer {
  const payload = Buffer.alloc(13);
  payload.write(handler, 8, "latin1");
  return box("hdlr", payload);
}

/** `mdhd` v0: version+flags(4) creation(4) modification(4) timescale(4) duration(4) … */
function mdhd(timescale: number, duration: number): Buffer {
  const payload = Buffer.alloc(20);
  payload.writeUInt8(0, 0); // version 0
  payload.writeUInt32BE(timescale, 12);
  payload.writeUInt32BE(duration, 16);
  return box("mdhd", payload);
}

/**
 * `mdhd` v1, with 64-bit times.
 *
 * 36 bytes: version+flags(4) creation(8) modification(8) timescale(4)
 * duration(8) language(2) pre_defined(2). Getting this length wrong is exactly
 * the four-bytes-out mistake these fixtures exist to catch — the first draft
 * allocated 32 and the parser correctly refused to read it.
 */
function mdhdV1(timescale: number, duration: number): Buffer {
  const payload = Buffer.alloc(36);
  payload.writeUInt8(1, 0); // version 1
  payload.writeUInt32BE(timescale, 20);
  payload.writeBigUInt64BE(BigInt(duration), 24);
  return box("mdhd", payload);
}

/** `stsd` holding one AudioSampleEntry. */
function audioStsd(
  codec: string,
  channels: number,
  sampleRate: number,
): Buffer {
  // AudioSampleEntry body: reserved(6) dri(2) version(2) revision(2) vendor(4)
  //                        channels(2) samplesize(2) predefined(2) reserved(2)
  //                        samplerate(4, 16.16)
  const entryBody = Buffer.alloc(28);
  entryBody.writeUInt16BE(channels, 8);
  entryBody.writeUInt16BE(sampleRate, 16);

  const entry = box(codec, entryBody);
  const payload = Buffer.alloc(8);
  payload.writeUInt32BE(1, 4); // entry_count
  return box("stsd", Buffer.concat([payload, entry]));
}

function videoStsd(): Buffer {
  const payload = Buffer.alloc(8);
  payload.writeUInt32BE(1, 4);
  return box("stsd", Buffer.concat([payload, box("avc1", Buffer.alloc(70))]));
}

function trak(options: {
  handler: "soun" | "vide";
  timescale?: number;
  duration?: number;
  codec?: string;
  channels?: number;
  sampleRate?: number;
  v1?: boolean;
}): Buffer {
  const timescale = options.timescale ?? 48_000;
  const duration = options.duration ?? 48_000 * 8;

  const header = options.v1
    ? mdhdV1(timescale, duration)
    : mdhd(timescale, duration);

  const stsd =
    options.handler === "soun"
      ? audioStsd(
          options.codec ?? "mp4a",
          options.channels ?? 2,
          options.sampleRate ?? 48_000,
        )
      : videoStsd();

  const mdia = box(
    "mdia",
    Buffer.concat([
      header,
      hdlr(options.handler),
      box("minf", box("stbl", stsd)),
    ]),
  );

  return box("trak", mdia);
}

/** A whole file: `ftyp` then `moov`. */
function mp4(traks: Buffer[]): Buffer {
  const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0isomiso2", "latin1"));
  return Buffer.concat([ftyp, box("moov", Buffer.concat(traks))]);
}

describe("a file with sound", () => {
  const file = mp4([trak({ handler: "vide" }), trak({ handler: "soun" })]);

  it("finds the audio track", () => {
    const probe = probeMp4(file);

    expect(probe.hasAudioStream).toBe(true);
    expect(probe.error).toBeUndefined();
    expect(probe.videoTrackCount).toBe(1);
  });

  it("reads the codec, channels and rate", () => {
    const [track] = probeMp4(file).audioTracks;

    expect(track.codec).toBe("mp4a");
    expect(track.channels).toBe(2);
    expect(track.sampleRate).toBe(48_000);
  });

  it("reads the duration from timescale and duration", () => {
    const [track] = probeMp4(file).audioTracks;
    expect(track.durationSeconds).toBeCloseTo(8, 5);
  });

  it("reports the video track's duration separately", () => {
    /**
     * So drift can be measured against the file's own picture rather than
     * against the duration that was requested — a model asked for 8s routinely
     * returns 8.033, and comparing to the request would fail a synchronised
     * file for the video's rounding.
     */
    expect(probeMp4(file).videoDurationSeconds).toBeCloseTo(8, 5);
  });

  it("handles a 64-bit media header", () => {
    // Long files, and some encoders unconditionally.
    const v1 = mp4([trak({ handler: "soun", v1: true })]);
    const probe = probeMp4(v1);

    expect(probe.hasAudioStream).toBe(true);
    expect(probe.audioTracks[0].durationSeconds).toBeCloseTo(8, 5);
  });

  it("finds audio wherever the track sits in the box order", () => {
    // Encoders differ; audio-first is as legal as video-first.
    const audioFirst = mp4([
      trak({ handler: "soun" }),
      trak({ handler: "vide" }),
    ]);
    expect(probeMp4(audioFirst).hasAudioStream).toBe(true);
  });
});

describe("a file without sound", () => {
  it("reports no audio and no error", () => {
    /**
     * The distinction the whole gate rests on: a clean parse that found no
     * `soun` track is *evidence of absence*, and only that combination may fail
     * a generation for missing audio.
     */
    const probe = probeMp4(mp4([trak({ handler: "vide" })]));

    expect(probe.hasAudioStream).toBe(false);
    expect(probe.audioTracks).toEqual([]);
    expect(probe.videoTrackCount).toBe(1);
    expect(probe.error).toBeUndefined();
  });
});

describe("what cannot be parsed is never reported as silence", () => {
  const cases: [string, Buffer][] = [
    ["an empty buffer", Buffer.alloc(0)],
    ["a few stray bytes", Buffer.from("not an mp4")],
    ["a PNG", Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")],
    [
      "an MP4 with no moov",
      Buffer.concat([
        box("ftyp", Buffer.from("isom\0\0\0\0isom", "latin1")),
        box("mdat", Buffer.alloc(64)),
      ]),
    ],
  ];

  for (const [name, bytes] of cases) {
    it(`reports an error for ${name}`, () => {
      const probe = probeMp4(bytes);

      expect(probe.hasAudioStream).toBe(false);
      // The point: an error, not a confident "no audio here".
      expect(probe.error).toBeTruthy();
    });
  }

  it("refuses a box that overruns its parent rather than reading past it", () => {
    // What a truncated download looks like from inside the parser.
    const file = mp4([trak({ handler: "soun" })]);
    const truncated = file.subarray(0, file.byteLength - 40);

    const probe = probeMp4(truncated);
    expect(probe.error).toBeTruthy();
  });

  it("terminates on a zero-length box instead of looping forever", () => {
    /**
     * `size: 0` means "to end of file" and is legal only for the last box. A
     * parser that advances by the declared size would spin here; the guard is
     * what stops a malformed file hanging a serverless function until it is
     * killed.
     */
    const zeroSized = Buffer.alloc(16);
    zeroSized.writeUInt32BE(0, 0);
    zeroSized.write("moov", 4, "latin1");

    const probe = probeMp4(
      Buffer.concat([box("ftyp", Buffer.alloc(8)), zeroSized]),
    );
    // Reaching an assertion at all is the test: it returned.
    expect(probe.hasAudioStream).toBe(false);
  });
});

describe("implausible values are withheld rather than guessed", () => {
  it("omits a zero sample rate instead of reporting it", () => {
    /**
     * A zero means the field was not where this layout expects it — Opus and
     * QuickTime v1/v2 sound entries carry the real rate further in. Reporting
     * zero would make the gate fail the file for "sample rate 0", which reads
     * as a measurement when it is a parse miss.
     */
    const file = mp4([trak({ handler: "soun", sampleRate: 0, channels: 0 })]);
    const [track] = probeMp4(file).audioTracks;

    expect(track.sampleRate).toBeUndefined();
    expect(track.channels).toBeUndefined();
    // The track itself was still found, which is the part that matters.
    expect(probeMp4(file).hasAudioStream).toBe(true);
  });

  it("omits a duration when the timescale is zero", () => {
    // Dividing by it would produce Infinity, which compares false against every
    // threshold and would sail through a drift check.
    const file = mp4([trak({ handler: "soun", timescale: 0 })]);
    expect(probeMp4(file).audioTracks[0].durationSeconds).toBeUndefined();
  });
});
