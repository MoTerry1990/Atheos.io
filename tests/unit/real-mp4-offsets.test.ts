import { describe, expect, it } from "vitest";

import { probeMp4 } from "@/services/video/container-probe";

/**
 * The parser's offsets, checked against bytes a real encoder produced.
 *
 * ## Why this file exists
 *
 * `container-probe.test.ts` builds its own containers, and that is the right
 * way to cover the branches — but it cannot catch the one failure that actually
 * happened. The parser read `channelcount` at +8 and `samplerate` at +16 when
 * both are eight bytes further in, and the fixtures were written to the *same*
 * wrong offsets. Parser and fixture agreed with each other and disagreed with
 * every MP4 in existence. Every test passed.
 *
 * A real Veo 3.1 Fast render then reported `sampleRate: 2` — the value that
 * lives at +16 is the sample-entry's revision level — the gate refused it for
 * being below 44100, and a generation that had delivered perfectly good
 * synchronised audio was failed and refunded. The provider call was spent.
 *
 * The 36 bytes below are the `mp4a` sample entry lifted verbatim from that
 * render. They are ground truth from an encoder nobody here wrote, which is
 * precisely what a hand-built fixture cannot be.
 */

/**
 * The real `mp4a` sample entry, first 36 bytes.
 *
 *   00000079  size (121; the rest is the `esds` codec-config child)
 *   6d703461  'mp4a'
 *   000000000000  reserved(6)
 *   0001          data_reference_index
 *   00000000      version(2) revision(2)
 *   00000000      vendor(4)
 *   0002          channelcount   ← +16
 *   0010          samplesize (16-bit)
 *   0000          pre_defined
 *   0000          reserved
 *   bb800000      samplerate 0xBB80 = 48000, 16.16 fixed  ← +24
 */
const REAL_MP4A_ENTRY = Buffer.from(
  "000000796d703461000000000000000100000000000000000002001000000000bb800000",
  "hex",
);

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.byteLength + 8, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
}

function hdlr(handler: string): Buffer {
  const payload = Buffer.alloc(13);
  payload.write(handler, 8, "latin1");
  return box("hdlr", payload);
}

/** `mdhd` v0 at 48 kHz, holding a real 8.0333s audio duration. */
function mdhd(): Buffer {
  const payload = Buffer.alloc(20);
  payload.writeUInt32BE(48_000, 12);
  payload.writeUInt32BE(385_600, 16); // 8.0333…s at 48 kHz
  return box("mdhd", payload);
}

/**
 * An `stsd` wrapping the real entry.
 *
 * The entry is spliced in whole rather than rebuilt, so nothing in this file
 * re-encodes the layout under test. Its declared size is trimmed to what is
 * present — the original 121 bytes include an `esds` child that is not needed
 * to read channels or rate, and a size claiming bytes that are absent would
 * (correctly) be refused as overrunning its parent.
 */
function realStsd(): Buffer {
  const entry = Buffer.from(REAL_MP4A_ENTRY);
  entry.writeUInt32BE(entry.byteLength, 0);

  const count = Buffer.alloc(8);
  count.writeUInt32BE(1, 4);
  return box("stsd", Buffer.concat([count, entry]));
}

const FILE = Buffer.concat([
  box("ftyp", Buffer.from("isom\0\0\0\0isomiso2avc1mp41", "latin1")),
  box(
    "moov",
    box(
      "trak",
      box(
        "mdia",
        Buffer.concat([
          mdhd(),
          hdlr("soun"),
          box("minf", box("stbl", realStsd())),
        ]),
      ),
    ),
  ),
]);

describe("a sample entry from a real encoder", () => {
  it("reads two channels, not the revision level", () => {
    // The old parser read +8 here and got 0, which it withheld as implausible.
    expect(probeMp4(FILE).audioTracks[0].channels).toBe(2);
  });

  it("reads 48000 Hz, not 2", () => {
    /**
     * The exact number that failed the live benchmark. `2` is the entry's
     * revision level, sitting where the old offset pointed, and it tripped the
     * gate's "below 44100" rule on a file whose audio was fine.
     */
    expect(probeMp4(FILE).audioTracks[0].sampleRate).toBe(48_000);
  });

  it("reads the codec as mp4a", () => {
    expect(probeMp4(FILE).audioTracks[0].codec).toBe("mp4a");
  });

  it("reads the duration the encoder wrote", () => {
    // 8.0333s — a real render asked for 8 seconds. Its audio is not a round
    // number and never was, which is why drift is checked against the file's
    // own video track rather than against the request.
    expect(probeMp4(FILE).audioTracks[0].durationSeconds).toBeCloseTo(
      8.0333,
      3,
    );
  });

  it("finds the audio stream at all", () => {
    expect(probeMp4(FILE).hasAudioStream).toBe(true);
    expect(probeMp4(FILE).error).toBeUndefined();
  });
});
