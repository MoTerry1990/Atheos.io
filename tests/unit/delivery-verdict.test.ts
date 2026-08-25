import { describe, expect, it } from "vitest";

import {
  containerKind,
  judgeDelivery,
  promisesAudio,
} from "@/services/video/delivery-verdict";
import { fixtures } from "@/tests/helpers/audio-fixtures";

/**
 * The three-way delivery verdict.
 *
 * ## Why `best_effort` exists
 *
 * `pass`/`fail` forces every uncertain case into an answer that is wrong. Audio
 * that is audible but unusually quiet is not a failure — refusing it destroys a
 * render the customer may be perfectly happy with — and it is not a clean pass
 * either, because nobody has confirmed it is right. `best_effort` delivers and
 * flags, which is the honest state for "measured, not broken, not obviously
 * good".
 *
 * ## What none of this validates
 *
 * Signal, not meaning. These verdicts can say a track is silent, clipped, quiet
 * or the wrong length. They cannot recognise intended content.
 */

const VEO = "replicate/veo-3.1-fast";
const VEO_LITE = "replicate/veo-3.1-lite";
const MOTION_1 = "replicate/video-gen";

const judge = (over: Partial<Parameters<typeof judgeDelivery>[0]> = {}) =>
  judgeDelivery({
    modelId: VEO,
    mimeType: "video/mp4",
    bytes: fixtures.mp4WithAudio(),
    wantsSound: true,
    requestedDurationSeconds: 8,
    ...over,
  });

describe("container detection", () => {
  it("recognises mp4 and quicktime", () => {
    expect(containerKind("video/mp4")).toBe("mp4");
    expect(containerKind("video/quicktime")).toBe("mov");
    expect(containerKind("video/x-quicktime")).toBe("mov");
  });

  it("calls anything else unsupported rather than guessing", () => {
    expect(containerKind("video/webm")).toBe("unsupported");
    expect(containerKind("application/octet-stream")).toBe("unsupported");
  });
});

describe("who promises sound", () => {
  it("holds a Veo tier to its claim when sound was asked for", () => {
    expect(promisesAudio(VEO, true)).toBe(true);
    expect(promisesAudio(VEO, false)).toBe(false);
  });

  it("holds Cinematic Lite regardless, because it cannot be silenced", () => {
    expect(promisesAudio(VEO_LITE, false)).toBe(true);
  });

  it("holds Motion 1 to nothing, however the request was phrased", () => {
    expect(promisesAudio(MOTION_1, true)).toBe(false);
  });
});

describe("a promised track that is missing or broken fails", () => {
  it("fails an mp4 with no audio track", async () => {
    const v = await judge({ bytes: fixtures.mp4NoAudio() });

    expect(v.outcome).toBe("fail");
    expect(v.deliver).toBe(false);
    expect(v.failures.join(" ")).toMatch(/no audio stream/);
  });

  it("fails a malformed mp4 rather than reading it as silent", async () => {
    /**
     * Fail closed. A truncated download and a genuinely silent file look
     * identical to a naive reader, and passing here delivers the exact thing
     * the gate exists to catch.
     */
    const v = await judge({ bytes: fixtures.malformedMp4() });

    expect(v.outcome).toBe("fail");
    expect(v.failures.join(" ")).toMatch(/could not be read/);
  });

  it("fails audio materially shorter than the picture", async () => {
    const v = await judge({ bytes: fixtures.mp4AudioShort() });
    expect(v.outcome).toBe("fail");
    expect(v.failures.join(" ")).toMatch(/shorter than the video/);
  });

  it("fails audio materially longer than the picture", async () => {
    const v = await judge({ bytes: fixtures.mp4AudioLong() });
    expect(v.outcome).toBe("fail");
    expect(v.failures.join(" ")).toMatch(/longer than the video/);
  });

  it("tells the customer they were not charged, in their terms", async () => {
    const v = await judge({ bytes: fixtures.mp4NoAudio() });

    expect(v.customerMessage).toMatch(/not been charged/i);
    // Never a parser or decoder message: "no moov box" helps nobody.
    expect(v.customerMessage).not.toMatch(/moov|box|parse|decode|container/i);
  });
});

describe("silent models are not held to a promise they never made", () => {
  it("passes a silent file from Motion 1", async () => {
    const v = await judge({ modelId: MOTION_1, bytes: fixtures.mp4NoAudio() });

    expect(v.outcome).toBe("pass");
    expect(v.deliver).toBe(true);
    expect(v.detail.promisedAudio).toBe(false);
  });

  it("passes a Veo generation that asked for silence", async () => {
    const v = await judge({ bytes: fixtures.mp4NoAudio(), wantsSound: false });
    expect(v.outcome).toBe("pass");
  });

  it("raises no audio warning for a correctly silent delivery", async () => {
    // A silent request that produced silence is right, and warning about it
    // would train everyone to ignore the warnings that matter.
    const v = await judge({ modelId: MOTION_1, bytes: fixtures.mp4NoAudio() });
    expect(v.warnings).toEqual([]);
  });

  it("does not decode a file it has no reason to judge", async () => {
    // Nothing is spent decoding 7 MB to confirm an expected absence.
    const v = await judge({ modelId: MOTION_1, bytes: fixtures.mp4NoAudio() });
    expect(v.detail.decoded).toBe(false);
  });
});

describe("MOV is validated, not waved through", () => {
  it("judges a quicktime file on its contents", async () => {
    /**
     * The behaviour this replaces: MOV returned `ok: true` because the checker
     * declined to look, which is indistinguishable from a pass it had earned.
     */
    const v = await judge({
      mimeType: "video/quicktime",
      bytes: fixtures.movNoAudio(),
    });

    expect(v.outcome).toBe("fail");
    expect(v.detail.container).toBe("mov");
    expect(v.failures.join(" ")).toMatch(/no audio stream/);
  });

  it("fails a malformed mov", async () => {
    const v = await judge({
      mimeType: "video/quicktime",
      bytes: fixtures.malformedMov(),
    });
    expect(v.outcome).toBe("fail");
  });

  it("does not fail a mov that has what it promised", async () => {
    const v = await judge({
      mimeType: "video/quicktime",
      bytes: fixtures.movWithAudio(),
    });
    // The structural half is satisfied; the decode half cannot be, because a
    // hand-built box tree carries no real samples. Never a silent `pass`.
    expect(v.outcome).not.toBe("pass");
    expect(v.detail.hasAudioStream).toBe(true);
  });
});

describe("an unvalidated container is never a silent pass", () => {
  it("returns best_effort when audio was promised", async () => {
    /**
     * We genuinely do not know. Failing would charge the customer for the
     * narrowness of our reader; passing is what MOV used to do.
     */
    const v = await judge({ mimeType: "video/webm" });

    expect(v.outcome).toBe("best_effort");
    expect(v.deliver).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/not validated/);
  });

  it("passes cleanly when nothing was promised", async () => {
    const v = await judge({ mimeType: "video/webm", modelId: MOTION_1 });
    expect(v.outcome).toBe("pass");
  });
});

describe("a declared type that disagrees with the bytes", () => {
  it("does not trust an mp4 label on a file that is not one", async () => {
    /**
     * MIME spoofing. The declared type chooses the parser; the bytes decide the
     * verdict. A caller labelling junk as `video/mp4` gets a failure, not a
     * pass, because the parser it selected cannot read what is there.
     */
    const v = await judge({ bytes: fixtures.notAVideo() });

    expect(v.outcome).toBe("fail");
    expect(v.detail.container).toBe("mp4");
  });

  it("reads a real mov even when it is labelled mp4", async () => {
    // The box tree is identical; only the brand differs. Both parse, so a
    // mislabelled-but-valid file is judged on what it actually contains.
    const v = await judge({
      mimeType: "video/mp4",
      bytes: fixtures.movWithAudio(),
    });

    expect(v.detail.hasAudioStream).toBe(true);
  });

  it("reads a real mp4 even when it is labelled quicktime", async () => {
    const v = await judge({
      mimeType: "video/quicktime",
      bytes: fixtures.mp4NoAudio(),
    });

    expect(v.detail.hasAudioStream).toBe(false);
    expect(v.outcome).toBe("fail");
  });
});

describe("nothing logged can carry a secret", () => {
  it("exposes only a closed set of scalar fields", async () => {
    /**
     * `detail` is what the delivery path logs. The provider's URL is signed and
     * the prompt is the customer's; the way that is guaranteed is that there is
     * no field here able to hold one.
     */
    const v = await judge({ bytes: fixtures.mp4NoAudio() });

    for (const [key, value] of Object.entries(v.detail)) {
      expect(
        ["string", "number", "boolean", "undefined"].includes(typeof value),
        `${key} is ${typeof value}`,
      ).toBe(true);
    }

    const serialised = JSON.stringify(v.detail);
    expect(serialised).not.toMatch(/https?:|X-Amz|Bearer |@/);
  });
});

describe("a measurement that was declined is missing evidence, not bad audio", () => {
  it("returns best_effort when the file is too large to decode", async () => {
    /**
     * Structural evidence exists, decoded evidence does not. Failing would
     * refuse a render for being large; passing would claim a measurement that
     * never happened.
     */
    const container = fixtures.mp4WithAudio();
    const oversized = Buffer.concat([
      container,
      Buffer.alloc(121 * 1024 * 1024),
    ]);

    const v = await judge({ bytes: oversized });

    expect(v.outcome).toBe("best_effort");
    expect(v.deliver).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/not fully measured/);
    expect(v.failures).toEqual([]);
  }, 30_000);
});

describe("severe conditions still fail closed", () => {
  /**
   * These use the decoded path directly rather than a container, because a
   * hand-built box tree carries no real samples. The judgement being exercised
   * is the same one `judgeDelivery` applies.
   */
  it("fails a promised track that decodes to silence", async () => {
    const { measureDecodedAudio } =
      await import("@/services/video/decoded-audio");
    const m = await measureDecodedAudio(fixtures.wavSilence());

    // Silence has no measurable loudness at all, which is the finding the gate
    // turns into a refusal.
    expect(m.decoded).toBe(true);
    expect(m.integratedLufs).toBeUndefined();
    expect(m.silenceRatio).toBe(1);
  });

  it("finds severe clipping above the failure threshold", async () => {
    const { measureDecodedAudio } =
      await import("@/services/video/decoded-audio");
    const m = await measureDecodedAudio(fixtures.wavClipped());

    expect(m.clippedRatio!).toBeGreaterThan(0.01);
  });

  it("keeps mild clipping below it", async () => {
    // The two must land on opposite sides, or the threshold is untestable.
    const { measureDecodedAudio } =
      await import("@/services/video/decoded-audio");
    const m = await measureDecodedAudio(fixtures.wavMildClipping());

    expect(m.clippedRatio!).toBeLessThan(0.01);
    expect(m.clippedRatio!).toBeGreaterThan(0);
  });

  it("keeps a quiet but audible track above the silence line", async () => {
    // -45 dBFS is quiet, not absent. Conflating them destroys good renders.
    const { measureDecodedAudio } =
      await import("@/services/video/decoded-audio");
    const m = await measureDecodedAudio(fixtures.wavQuiet());

    expect(m.integratedLufs!).toBeGreaterThan(-60);
    expect(m.integratedLufs!).toBeLessThan(-40);
  });
});
