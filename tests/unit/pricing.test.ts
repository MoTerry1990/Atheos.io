import { describe, expect, it } from "vitest";

import { creditsFor, durationMultiplier } from "@/services/ai/pricing";

/**
 * The estimate shown before the button and the amount debited after it are the
 * same function, by design. That makes this the one place a rounding error
 * becomes a billing dispute — a user charged more than the interface quoted.
 */

const imageModel = { creditCost: 4, capabilities: { durations: undefined } };
const videoModel = { creditCost: 90, capabilities: { durations: [5, 10] } };

describe("durationMultiplier", () => {
  it("is 1 for a model with no durations (an image model)", () => {
    expect(durationMultiplier(undefined, undefined)).toBe(1);
    expect(durationMultiplier(undefined, 10)).toBe(1);
  });

  it("is 1 when no duration was requested", () => {
    expect(durationMultiplier([5, 10], undefined)).toBe(1);
  });

  it("scales against the shortest offered clip", () => {
    expect(durationMultiplier([5, 10], 10)).toBe(2);
    expect(durationMultiplier([5, 10], 5)).toBe(1);
  });

  it("never goes below 1, even for a sub-minimum duration", () => {
    // A caller asking for less than the shortest clip must not get a discount
    // on a job the provider will still run at the minimum length.
    expect(durationMultiplier([5, 10], 2)).toBe(1);
  });

  it("survives a zero or negative base without dividing by zero", () => {
    expect(durationMultiplier([0], 10)).toBe(1);
    expect(durationMultiplier([-5], 10)).toBe(1);
  });

  it("ignores an empty durations array", () => {
    expect(durationMultiplier([], 10)).toBe(1);
  });
});

describe("creditsFor", () => {
  it("prices a single image at the model cost", () => {
    expect(creditsFor(imageModel, 1)).toBe(4);
  });

  it("multiplies by output count", () => {
    expect(creditsFor(imageModel, 4)).toBe(16);
  });

  it("treats zero or negative outputs as one", () => {
    // A request for zero outputs is a bug, not a free generation.
    expect(creditsFor(imageModel, 0)).toBe(4);
    expect(creditsFor(imageModel, -3)).toBe(4);
  });

  it("multiplies by duration for video", () => {
    expect(creditsFor(videoModel, 1, 5)).toBe(90);
    expect(creditsFor(videoModel, 1, 10)).toBe(180);
  });

  it("compounds outputs and duration", () => {
    expect(creditsFor(videoModel, 2, 10)).toBe(360);
  });

  it("always rounds up, never down", () => {
    // Rounding down means we pay a provider more than we charged. Ceil is the
    // only safe direction, and this asserts it on a value that would floor.
    const model = { creditCost: 3, capabilities: { durations: [4] } };
    expect(creditsFor(model, 1, 5)).toBe(4); // 3 * 1.25 = 3.75 → 4
  });

  it("never returns a fractional credit", () => {
    const model = { creditCost: 7, capabilities: { durations: [3] } };
    for (const seconds of [3, 4, 5, 7, 11]) {
      expect(Number.isInteger(creditsFor(model, 2, seconds))).toBe(true);
    }
  });

  it("never returns zero for a real request", () => {
    // A zero-credit generation is a free one. Nothing in the catalogue is free,
    // and a model priced at zero would be a configuration mistake, not a gift.
    expect(creditsFor(imageModel, 1)).toBeGreaterThan(0);
    expect(creditsFor(videoModel, 1, 5)).toBeGreaterThan(0);
  });
});
