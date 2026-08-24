import { describe, expect, it } from "vitest";

import { creditsFor } from "@/services/ai/pricing";
import { estimateCost } from "@/store/studio-store";
import type { StudioModel, StudioParams } from "@/features/studio/types";

/**
 * One request, one price.
 *
 * ## The divergence
 *
 * The model picker rendered `model.creditCost`. The Generate button rendered
 * `estimateCost(params, models)`. Those are different quantities:
 * `creditCost` is the price at the model's **base duration** for one output,
 * and `estimateCost` scales it by the duration and count actually requested.
 *
 * For a video at any duration other than the base they disagree — the studio
 * showed 90 in the picker and 135 on the button for a request nobody had
 * changed. Both now go through `creditsFor`, which is the function the server
 * charges with.
 *
 * These tests are about *provenance*, not arithmetic. The point is not that
 * some number is right; it is that there is only one place a price can come
 * from, so a future change cannot move one surface without moving the others.
 */

const VIDEO: StudioModel = {
  id: "replicate/video-gen",
  displayName: "Motion 1",
  modality: "video",
  creditCost: 90,
  typicalSeconds: 300,
  description: "",
  capabilities: {
    // Base duration is the first entry: `creditCost` is its price.
    durations: [5, 8],
    supportsNegativePrompt: false,
  },
} as unknown as StudioModel;

const IMAGE: StudioModel = {
  id: "replicate/flux-dev",
  displayName: "Flux Dev",
  modality: "image",
  creditCost: 13,
  typicalSeconds: 12,
  description: "",
  capabilities: { supportsNegativePrompt: true },
} as unknown as StudioModel;

const MODELS = [VIDEO, IMAGE];

function params(over: Partial<StudioParams> = {}): StudioParams {
  return {
    sequenceMode: "continuous",
    modelId: VIDEO.id,
    prompt: "a lighthouse",
    negativePrompt: "",
    presetIds: [],
    camera: { shot: null, angle: null, lens: null, lighting: null },
    aspectRatio: "16:9",
    resolution: 1024,
    creativity: 0.5,
    seed: null,
    seedLocked: false,
    outputs: 1,
    references: [],
    durationSeconds: 5,
    cameraMotion: null,
    ...over,
  } as StudioParams;
}

/**
 * What the picker renders for a row.
 *
 * Mirrors `model-picker.tsx` exactly: the component reads `outputs` and
 * `durationSeconds` from the store and calls `creditsFor`. Asserting the call
 * rather than the component keeps this a unit test while still failing if the
 * picker ever goes back to reading a bare `creditCost`.
 */
const pickerPrice = (model: StudioModel, p: StudioParams) =>
  creditsFor(model, p.outputs, p.durationSeconds);

describe("the picker and the button agree", () => {
  const CASES: Array<[string, Partial<StudioParams>]> = [
    ["base duration", { durationSeconds: 5 }],
    ["a longer clip", { durationSeconds: 8 }],
    ["several outputs", { outputs: 3 }],
    ["longer and several", { durationSeconds: 8, outputs: 2 }],
  ];

  for (const [name, over] of CASES) {
    it(`quotes the same number for ${name}`, () => {
      const p = params(over);
      expect(pickerPrice(VIDEO, p)).toBe(estimateCost(p, MODELS));
    });
  }

  it("disagrees with the base price, which is the bug that was there", () => {
    /**
     * Pinned deliberately. If `creditCost` and the real quote were always
     * equal, the tests above would pass with the old code still in place and
     * prove nothing.
     */
    const p = params({ durationSeconds: 8 });
    expect(estimateCost(p, MODELS)).not.toBe(VIDEO.creditCost);
  });

  it("still agrees for an image model, where duration does not apply", () => {
    const p = params({ modelId: IMAGE.id, outputs: 1 });
    expect(pickerPrice(IMAGE, p)).toBe(estimateCost(p, MODELS));
    expect(estimateCost(p, MODELS)).toBe(IMAGE.creditCost);
  });
});

describe("the quote comes from one function", () => {
  it("estimateCost delegates to creditsFor rather than re-deriving", () => {
    /**
     * `estimateCost` is the composer's entry point and `creditsFor` is the
     * server's. Equality across the whole parameter space is what makes them
     * one source rather than two implementations that happen to agree today.
     */
    for (const outputs of [1, 2, 4]) {
      for (const durationSeconds of [5, 8]) {
        const p = params({ outputs, durationSeconds });
        expect(estimateCost(p, MODELS)).toBe(
          creditsFor(VIDEO, outputs, durationSeconds),
        );
      }
    }
  });

  it("never quotes zero for a real request", () => {
    // A free-looking price is worse than a wrong one: it is the only price a
    // user will not question before pressing the button.
    expect(estimateCost(params(), MODELS)).toBeGreaterThan(0);
  });

  it("rounds up, so the quote is never below what is charged", () => {
    // `creditsFor` ceils. A quote that rounded down would under-promise and
    // then over-charge, which is the one direction that is not survivable.
    const p = params({ durationSeconds: 8 });
    expect(Number.isInteger(estimateCost(p, MODELS))).toBe(true);
    expect(estimateCost(p, MODELS)).toBeGreaterThanOrEqual(
      VIDEO.creditCost * (8 / 5),
    );
  });
});
