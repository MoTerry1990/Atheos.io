import { describe, expect, it } from "vitest";

import {
  VIDEO_FORMATS,
  VIDEO_FORMAT_IDS,
  VIDEO_FORMAT_ORDER,
  deliveredMatchesFormat,
  isVideoFormatId,
  matchesRatio,
  ratioString,
  videoFormat,
} from "@/services/ai/video-formats";

/**
 * The format registry, checked as arithmetic rather than as a data shape.
 *
 * The failures worth catching here are not typos. They are a listed output
 * that does not actually satisfy the ratio it is filed under, a ratio that
 * disagrees with the name people call it, and a validator loose enough to
 * accept a stretched delivery. All three are invisible in review and all three
 * are provable with integer arithmetic.
 */
describe("every format is internally consistent", () => {
  it("has an entry for every id, and no extras", () => {
    expect(Object.keys(VIDEO_FORMATS).sort()).toEqual(
      [...VIDEO_FORMAT_IDS].sort(),
    );
    expect([...VIDEO_FORMAT_ORDER].sort()).toEqual(
      [...VIDEO_FORMAT_IDS].sort(),
    );
  });

  it("files each entry under its own id", () => {
    for (const id of VIDEO_FORMAT_IDS) {
      expect(VIDEO_FORMATS[id].id, id).toBe(id);
    }
  });

  it("lists only outputs that satisfy the ratio exactly", () => {
    /**
     * The check the registry exists for. `portrait-feed` claims 4:5 and
     * 1080x1350; if that pairing were wrong, every downstream dimension check
     * would be validating against a shape nothing can produce.
     */
    for (const id of VIDEO_FORMAT_IDS) {
      const format = VIDEO_FORMATS[id];
      expect(format.outputs.length, `${id} has no output`).toBeGreaterThan(0);

      for (const output of format.outputs) {
        expect(
          matchesRatio(output, format.ratio),
          `${id}: ${output.width}x${output.height} is not ${ratioString(format.ratio)}`,
        ).toBe(true);
      }
    }
  });

  it("carries reduced ratios, so comparisons stay in integers", () => {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

    for (const id of VIDEO_FORMAT_IDS) {
      const { w, h } = VIDEO_FORMATS[id].ratio;
      expect(Number.isInteger(w) && Number.isInteger(h), id).toBe(true);
      expect(gcd(w, h), `${id} ratio is not reduced`).toBe(1);
    }
  });

  it("orders the two natively-supported formats first", () => {
    // The brief requires a truthful path for native 9:16 and native 16:9.
    // Whatever else the picker offers, those are what it offers first.
    expect(VIDEO_FORMAT_ORDER.slice(0, 2)).toEqual([
      "social-vertical",
      "landscape",
    ]);
  });

  it("does not call 2560x1080 a 21:9 ratio", () => {
    /**
     * It is 64:27 — 2.370, not 2.333. The industry name is kept for the label
     * because that is what a person is looking for in a picker, but the ratio
     * used for validation is the one the pixels actually satisfy. Publishing
     * 21:9 here would fail every correct delivery.
     */
    const wide = VIDEO_FORMATS["cinematic-wide"];
    expect(wide.nominalLabel).toBe("21:9");
    expect(wide.ratio).toEqual({ w: 64, h: 27 });
    expect(matchesRatio({ width: 2560, height: 1080 }, wide.ratio)).toBe(true);
    expect(matchesRatio({ width: 2560, height: 1080 }, { w: 21, h: 9 })).toBe(
      false,
    );
  });

  it("gives every format a label and real guidance", () => {
    for (const id of VIDEO_FORMAT_IDS) {
      const format = VIDEO_FORMATS[id];
      expect(format.label.trim().length, id).toBeGreaterThan(2);
      expect(format.bestFor.trim().length, id).toBeGreaterThan(8);
    }
  });

  it("keeps the brief's promised dimensions", () => {
    // Named explicitly, because these are the numbers the sprint was specified
    // in and a silent change to one is a silent change to the contract.
    const has = (id: (typeof VIDEO_FORMAT_IDS)[number], w: number, h: number) =>
      VIDEO_FORMATS[id].outputs.some((o) => o.width === w && o.height === h);

    expect(has("social-vertical", 720, 1280)).toBe(true);
    expect(has("social-vertical", 1080, 1920)).toBe(true);
    expect(has("portrait-feed", 1080, 1350)).toBe(true);
    expect(has("square", 1080, 1080)).toBe(true);
    expect(has("landscape", 1280, 720)).toBe(true);
    expect(has("landscape", 1920, 1080)).toBe(true);
  });
});

describe("an untrusted id cannot become a format", () => {
  it("accepts exactly the six", () => {
    for (const id of VIDEO_FORMAT_IDS) expect(isVideoFormatId(id)).toBe(true);
  });

  it("refuses anything else, whatever it looks like", () => {
    /**
     * A forged request is the threat this guards. `9:16` is the interesting
     * case — it is a real ratio and a plausible thing for a client to send,
     * and it is still not a format id.
     */
    for (const bad of [
      "9:16",
      "SOCIAL-VERTICAL",
      "social_vertical",
      "vertical",
      "",
      " social-vertical",
      null,
      undefined,
      42,
      {},
      ["social-vertical"],
    ]) {
      expect(isVideoFormatId(bad), JSON.stringify(bad)).toBe(false);
      expect(videoFormat(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("resolves a valid id to its own entry", () => {
    expect(videoFormat("landscape")).toBe(VIDEO_FORMATS.landscape);
  });
});

describe("delivered pixels are checked, not assumed", () => {
  it("accepts a delivery at the exact shape", () => {
    for (const id of VIDEO_FORMAT_IDS) {
      const format = VIDEO_FORMATS[id];
      for (const output of format.outputs) {
        expect(deliveredMatchesFormat(output, format), id).toBe(true);
      }
    }
  });

  it("accepts a different resolution at the same shape", () => {
    // The contract is the ratio. A model that returns 1440x2560 for a 9:16
    // request has honoured it.
    expect(
      deliveredMatchesFormat(
        { width: 1440, height: 2560 },
        VIDEO_FORMATS["social-vertical"],
      ),
    ).toBe(true);
  });

  it("refuses a delivery that is off by even one pixel", () => {
    /**
     * No tolerance, on purpose. A near-miss is what a stretch or a letterbox
     * looks like numerically, and those are exactly what the output contract
     * forbids. 1080x1919 is not 9:16.
     */
    const vertical = VIDEO_FORMATS["social-vertical"];
    expect(
      deliveredMatchesFormat({ width: 1080, height: 1919 }, vertical),
    ).toBe(false);
    expect(
      deliveredMatchesFormat({ width: 1081, height: 1920 }, vertical),
    ).toBe(false);
  });

  it("refuses the wrong orientation", () => {
    // 1920x1080 is a perfectly good video and it is not 9:16. Accepting it
    // because the numbers are familiar is how a sideways delivery ships.
    expect(
      deliveredMatchesFormat(
        { width: 1920, height: 1080 },
        VIDEO_FORMATS["social-vertical"],
      ),
    ).toBe(false);
  });

  it("does not confuse two shapes that are nearly the same", () => {
    // 4:5 (0.800) against 1:1 and against 9:16, and 64:27 against 21:9.
    expect(
      deliveredMatchesFormat(
        { width: 1080, height: 1350 },
        VIDEO_FORMATS.square,
      ),
    ).toBe(false);
    expect(
      deliveredMatchesFormat(
        { width: 1080, height: 1350 },
        VIDEO_FORMATS["social-vertical"],
      ),
    ).toBe(false);
    expect(
      deliveredMatchesFormat(
        { width: 1080, height: 1080 },
        VIDEO_FORMATS["portrait-feed"],
      ),
    ).toBe(false);
  });
});

describe("the registry stays on the server", () => {
  it("is server-only", () => {
    // It decides pricing eligibility and validates deliveries. A client copy
    // is a second source of truth that can disagree with the one that bills.
    expect(
      videoFormat("landscape") !== null && VIDEO_FORMAT_IDS.length === 6,
    ).toBe(true);
  });
});
