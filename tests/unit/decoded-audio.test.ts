import { describe, expect, it } from "vitest";

import { measureDecodedAudio } from "@/services/video/decoded-audio";
import { fixtures, sine, wav } from "@/tests/helpers/audio-fixtures";

/**
 * Decoded measurement, calibrated against signals whose answers are known.
 *
 * ## Why calibration matters more than coverage here
 *
 * Every threshold in the delivery gate is stated in LUFS, and LUFS is not RMS.
 * An implementation that computed RMS and labelled it LUFS would pass any test
 * written against itself, then compare real audio against published thresholds
 * it does not actually measure — wrong by several decibels, silently, forever.
 *
 * So the reference cases below assert values that come from the standard rather
 * than from this code: a 1 kHz sine at -20 dBFS is -20 LUFS, its RMS is
 * 3.01 dB below its peak, and digital silence has no measurable loudness at
 * all.
 */

const decode = measureDecodedAudio;

describe("reference signals", () => {
  it("measures a -20 dBFS sine at -20 LUFS", async () => {
    /**
     * The calibration case. K-weighting is flat at 1 kHz, so the integrated
     * loudness of a 1 kHz sine equals its level — any implementation that is
     * out by the -0.691 offset, the channel summation or the gating lands
     * visibly away from -20.
     */
    const m = await decode(fixtures.wavReference(-20));

    expect(m.decoded).toBe(true);
    expect(m.integratedLufs!).toBeGreaterThan(-20.5);
    expect(m.integratedLufs!).toBeLessThan(-19.5);
  });

  it("tracks a level change decibel for decibel", async () => {
    // A 10 dB quieter signal must measure 10 LUFS quieter, not 10 times less.
    const loud = await decode(fixtures.wavReference(-20));
    const quiet = await decode(fixtures.wavReference(-30));

    expect(loud.integratedLufs! - quiet.integratedLufs!).toBeCloseTo(10, 0);
  });

  it("puts a sine's RMS 3.01 dB below its peak", async () => {
    // Textbook: RMS of a sine is amplitude / sqrt(2).
    const m = await decode(fixtures.wavReference(-20));

    expect(m.peakDbfs!).toBeCloseTo(-20, 1);
    expect(m.rmsDbfs!).toBeCloseTo(-23.01, 1);
  });

  it("reports the true channel count and sample rate", async () => {
    const m = await decode(wav(sine(-20, { channels: 1 })));
    expect(m.channels).toBe(1);
    expect(m.sampleRate).toBe(48_000);
  });

  it("derives duration from the samples that exist", async () => {
    const m = await decode(wav(sine(-20, { seconds: 2.5 })));
    expect(m.durationSeconds!).toBeCloseTo(2.5, 2);
  });
});

describe("silence", () => {
  it("reports no measurable loudness for digital silence", async () => {
    /**
     * Undefined rather than a very negative number. Every block falls below the
     * absolute gate, so there is nothing to average — and a figure like -70
     * would invite a "quiet" reading of something that is nothing.
     */
    const m = await decode(fixtures.wavSilence());

    expect(m.decoded).toBe(true);
    expect(m.integratedLufs).toBeUndefined();
    expect(m.silenceRatio).toBe(1);
  });

  it("reports the longest continuous silent run", async () => {
    const m = await decode(fixtures.wavSilence({ seconds: 3 }));
    expect(m.longestSilenceSeconds!).toBeGreaterThan(2.9);
  });

  it("counts a nearly-silent track as almost entirely silence", async () => {
    // One 20 ms blip in four seconds — audible, and still effectively nothing.
    const m = await decode(fixtures.wavNearlySilent());

    expect(m.silenceRatio!).toBeGreaterThan(0.98);
    expect(m.decoded).toBe(true);
  });

  it("does not call ordinary quiet audio silence", async () => {
    // -45 dBFS is quiet, not absent. Conflating the two would destroy renders.
    const m = await decode(fixtures.wavQuiet());

    expect(m.silenceRatio).toBe(0);
    expect(m.integratedLufs).toBeDefined();
  });

  it("finds the quiet passage inside dynamic content", async () => {
    // Loud, quiet, loud — the quiet middle is not silence and must not read as
    // it, or the gating in the loudness measurement is wrong.
    const m = await decode(fixtures.wavNormal());

    expect(m.silenceRatio).toBe(0);
    expect(m.integratedLufs).toBeDefined();
  });
});

describe("clipping", () => {
  it("counts samples driven to full scale", async () => {
    const m = await decode(fixtures.wavClipped());

    expect(m.clippedSamples!).toBeGreaterThan(0);
    expect(m.clippedRatio!).toBeGreaterThan(0.01);
    expect(m.peakDbfs!).toBeCloseTo(0, 1);
  });

  it("separates mild clipping from severe", async () => {
    // The two land on different sides of the delivery thresholds, so a fixture
    // that could not distinguish them would make the gate untestable.
    const mild = await decode(fixtures.wavMildClipping());
    const severe = await decode(fixtures.wavClipped());

    expect(mild.clippedRatio!).toBeLessThan(severe.clippedRatio!);
    expect(mild.clippedRatio!).toBeLessThan(0.01);
  });

  it("finds no clipping in a signal with headroom", async () => {
    const m = await decode(fixtures.wavReference(-20));
    expect(m.clippedSamples).toBe(0);
    expect(m.clippedRatio).toBe(0);
  });
});

describe("what cannot be decoded is reported, not thrown", () => {
  it("returns decoded:false for a file that is not audio", async () => {
    /**
     * Reporting rather than throwing is the contract: this module measures and
     * the gate judges. A throw here would make every unreadable file an
     * internal error on the delivery path.
     */
    const m = await decode(fixtures.notAVideo());

    expect(m.decoded).toBe(false);
    expect(m.decodeError).toBeTruthy();
  });

  it("returns decoded:false for an empty buffer", async () => {
    const m = await decode(Buffer.alloc(0));
    expect(m.decoded).toBe(false);
  });

  it("carries no path or payload in the error", async () => {
    // A decoder's message can contain a filename or a buffer dump. Only the
    // class name survives.
    const m = await decode(fixtures.notAVideo());

    expect(m.decodeError).not.toMatch(/[/\\]|\.wav|\.mp4|Buffer/);
  });

  it("does not decode a video container with no audio track", async () => {
    // There is nothing to decode, and saying so is different from failing.
    const m = await decode(fixtures.mp4NoAudio());
    expect(m.decoded).toBe(false);
  });
});
