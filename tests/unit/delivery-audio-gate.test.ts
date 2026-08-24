import { describe, expect, it } from "vitest";

import {
  checkDeliveredAudio,
  promisesAudio,
} from "@/services/video/delivery-audio-check";

/**
 * The gate, on the path a real generation takes.
 *
 * ## Why fail-closed only applies to a promise
 *
 * Two models, two correct behaviours. Motion 1 never claimed to produce sound,
 * so a silent file from it is exactly right and the check must not touch it.
 * Cinematic Fast is sold on synchronised audio, so a silent file from it is the
 * product failing — and the customer paying full price for it is the failure
 * that has actually been happening, unnoticed, because nothing called this gate.
 *
 * ## The third case, which is the one that needs care
 *
 * A file that *cannot be parsed* must not be read as a silent one. Failing a
 * generation because our own reader could not open the container would charge
 * the customer for our gap — so an unreadable container fails only where audio
 * was promised, and an unsupported container type abstains entirely.
 */

// --- fixtures ---------------------------------------------------------------

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.byteLength + 8, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
}

function mdhd(timescale: number, duration: number): Buffer {
  const payload = Buffer.alloc(20);
  payload.writeUInt32BE(timescale, 12);
  payload.writeUInt32BE(duration, 16);
  return box("mdhd", payload);
}

function hdlr(handler: string): Buffer {
  const payload = Buffer.alloc(13);
  payload.write(handler, 8, "latin1");
  return box("hdlr", payload);
}

/**
 * AudioSampleEntry: channelcount at +16, samplerate's integer half at +24,
 * measured from the end of the entry's box header. See `container-probe.ts` —
 * these were eight bytes out in the first version and a real Veo render was
 * failed and refunded because of it.
 */
function stsd(codec: string, channels = 2, sampleRate = 48_000): Buffer {
  const entryBody = Buffer.alloc(28);
  entryBody.writeUInt16BE(channels, 16);
  entryBody.writeUInt16BE(sampleRate, 24);
  const count = Buffer.alloc(8);
  count.writeUInt32BE(1, 4);
  return box("stsd", Buffer.concat([count, box(codec, entryBody)]));
}

function track(
  handler: "soun" | "vide",
  seconds: number,
  codec = "mp4a",
  channels = 2,
  sampleRate = 48_000,
): Buffer {
  return box(
    "trak",
    box(
      "mdia",
      Buffer.concat([
        mdhd(48_000, Math.round(seconds * 48_000)),
        hdlr(handler),
        box(
          "minf",
          box(
            "stbl",
            handler === "soun"
              ? stsd(codec, channels, sampleRate)
              : stsd("avc1"),
          ),
        ),
      ]),
    ),
  );
}

function mp4(traks: Buffer[]): Buffer {
  return Buffer.concat([
    box("ftyp", Buffer.from("isom\0\0\0\0isom", "latin1")),
    box("moov", Buffer.concat(traks)),
  ]);
}

const WITH_AUDIO = mp4([track("vide", 8), track("soun", 8)]);
const SILENT = mp4([track("vide", 8)]);

const VEO_FAST = "replicate/veo-3.1-fast";
const VEO_LITE = "replicate/veo-3.1-lite";
const MOTION_1 = "replicate/video-gen";

const check = (over: Partial<Parameters<typeof checkDeliveredAudio>[0]> = {}) =>
  checkDeliveredAudio({
    modelId: VEO_FAST,
    mimeType: "video/mp4",
    bytes: WITH_AUDIO,
    wantsSound: true,
    requestedDurationSeconds: 8,
    ...over,
  });

// --- which models make a promise --------------------------------------------

describe("who promises sound", () => {
  it("a Veo tier asked for sound does", () => {
    expect(promisesAudio(VEO_FAST, true)).toBe(true);
  });

  it("a Veo tier not asked for sound does not", () => {
    expect(promisesAudio(VEO_FAST, false)).toBe(false);
  });

  it("Cinematic Lite promises regardless, because it cannot be turned off", () => {
    // Its schema has no `generate_audio` field at all, so a silent request was
    // never something the model could honour.
    expect(promisesAudio(VEO_LITE, false)).toBe(true);
  });

  it("Motion 1 never does, however the request was phrased", () => {
    expect(promisesAudio(MOTION_1, true)).toBe(false);
  });

  it("an unknown model promises nothing", () => {
    // A model absent from the capability table has made no claim we can hold
    // it to, and inventing one would fail every generation from it.
    expect(promisesAudio("replicate/something-new", true)).toBe(false);
  });
});

// --- the four cases the sprint named ----------------------------------------

describe("an mp4 with audio passes", () => {
  it("passes and reports the track", () => {
    const verdict = check();

    expect(verdict.ok).toBe(true);
    expect(verdict.gate?.outcome).toBe("pass");
    expect(verdict.detail.hasAudioStream).toBe(true);
    expect(verdict.detail.codec).toBe("mp4a");
    expect(verdict.detail.sampleRate).toBe(48_000);
    expect(verdict.detail.channels).toBe(2);
  });

  it("says out loud that silence has not been ruled out", () => {
    /**
     * The honest limit of a container-only check. It found a track; it did not
     * decode one. Recording that as a warning keeps the next reader from
     * assuming this gate proves the audio is audible — it does not, and
     * loudness stays with the worker phase.
     */
    expect(verdictWarnings()).toContain(
      "loudness was not measured — an audio track exists, but silence has not been ruled out",
    );
  });

  function verdictWarnings() {
    return check().gate?.warnings ?? [];
  }

  it("does not fail on drift when audio and video agree", () => {
    expect(check().gate?.failures).toEqual([]);
  });
});

describe("an mp4 without audio fails closed", () => {
  const verdict = () => check({ bytes: SILENT });

  it("refuses delivery", () => {
    expect(verdict().ok).toBe(false);
    expect(verdict().gate?.outcome).toBe("fail");
  });

  it("names the reason", () => {
    expect(verdict().gate?.failures).toContain(
      "audio was promised and the file has no audio stream",
    );
  });

  it("tells the customer they were not charged", () => {
    // The refund is the point; a failure message that does not say so invites a
    // support ticket for money that was never taken.
    expect(verdict().customerMessage).toMatch(/not been charged/i);
  });

  it("never puts a parser message in front of the customer", () => {
    // "no moov box" is not actionable by anyone who did not write the parser.
    expect(verdict().customerMessage).not.toMatch(/moov|box|parse|container/i);
  });

  it("keeps the video preserved rather than regenerating it", () => {
    // Audio failing is not a reason to remake an expensive picture.
    expect(verdict().gate?.preserveVideo).toBe(true);
    expect(verdict().gate?.regenerateVideo).toBe(false);
  });
});

describe("silent models skip the requirement entirely", () => {
  it("passes a silent file from Motion 1", () => {
    const verdict = check({ modelId: MOTION_1, bytes: SILENT });

    expect(verdict.ok).toBe(true);
    expect(verdict.detail.promisedAudio).toBe(false);
    // No gate ran at all: there was no promise to judge.
    expect(verdict.gate).toBeUndefined();
  });

  it("passes a Veo generation that asked for silence", () => {
    const verdict = check({ bytes: SILENT, wantsSound: false });
    expect(verdict.ok).toBe(true);
  });

  it("does not parse a file it has no reason to judge", () => {
    // Nothing is spent reading a container whose audio nobody promised.
    const verdict = check({ modelId: MOTION_1, bytes: Buffer.from("junk") });
    expect(verdict.ok).toBe(true);
  });
});

describe("an unreadable file is not treated as a silent one", () => {
  it("fails a promised generation whose container cannot be read", () => {
    /**
     * Fail closed. A truncated download and a genuinely silent file look
     * identical to a naive reader, and passing here would deliver the exact
     * thing the gate exists to catch.
     */
    const verdict = check({ bytes: Buffer.from("not an mp4 at all") });

    expect(verdict.ok).toBe(false);
    expect(verdict.detail.parseError).toBeTruthy();
    expect(verdict.gate?.failures.join(" ")).toMatch(/could not be decoded/);
  });

  it("abstains on a container type it cannot parse", () => {
    /**
     * A WebM from some future provider. Failing a generation because *our*
     * reader does not understand its container charges the customer for our
     * gap — so the check stands down and says why.
     */
    const verdict = check({ mimeType: "video/webm", bytes: SILENT });

    expect(verdict.ok).toBe(true);
    expect(verdict.detail.parseError).toMatch(/unparsed container/);
  });
});

describe("drift is measured against the file's own picture", () => {
  it("passes when the video is slightly longer than requested", () => {
    /**
     * A model asked for 8s returns 8.033. Both tracks agree with each other,
     * which is what A/V sync means — comparing either to the *request* would
     * fail a correct file for the encoder's rounding.
     */
    const file = mp4([track("vide", 8.033), track("soun", 8.033)]);
    const verdict = check({ bytes: file, requestedDurationSeconds: 8 });

    expect(verdict.ok).toBe(true);
  });

  it("fails when the audio is genuinely short against its own video", () => {
    // Half a second of missing sound at the end is audible and is a real defect.
    const file = mp4([track("vide", 8), track("soun", 7.5)]);
    const verdict = check({ bytes: file });

    expect(verdict.ok).toBe(false);
    expect(verdict.gate?.failures.join(" ")).toMatch(/shorter than the video/);
  });

  it("skips the check when there is no reference duration at all", () => {
    // A measurement that did not happen must not report itself as one that
    // failed.
    const audioOnly = mp4([track("soun", 8)]);
    const verdict = check({
      bytes: audioOnly,
      requestedDurationSeconds: undefined,
    });

    expect(verdict.gate?.failures.join(" ")).not.toMatch(/shorter|longer/);
  });
});

describe("nothing logged can carry a secret", () => {
  it("exposes only a closed set of scalar fields", () => {
    /**
     * `detail` is what the delivery path logs. The provider's URL is signed and
     * the prompt is the customer's; neither may reach a log line, and the way
     * that is guaranteed is that there is no field here able to hold one.
     */
    const keys = Object.keys(check().detail).sort();

    expect(keys).toEqual([
      "audioDurationSeconds",
      "channels",
      "codec",
      "dataRateKbps",
      "hasAudioStream",
      "modelId",
      "promisedAudio",
      "sampleRate",
      "videoDurationSeconds",
    ]);
  });
});
