import { describe, expect, it } from "vitest";

import {
  BENCHMARK_COPY,
  COMMERCIAL_CONTINUITY,
  compileCommercialPrompt,
  describeIdentityStrength,
  planCommercial,
  referenceStrategy,
  type CommercialBrief,
} from "@/services/ai/commercial-director";
import {
  CUT_SCORE_THRESHOLD,
  escapeDrawText,
  planPostProduction,
  runDeliveryGate,
} from "@/services/video/delivery-gate";

/**
 * Both files, as measured on 2026-08-23 — not as described.
 *
 * ffprobe for the containers; `ffmpeg -vf scdet=threshold=0,metadata=print` for
 * the cuts, after that method was validated against the reference, which has
 * three known cuts. The first detector tried (`select=gt(scene,T)` + showinfo)
 * found none in the reference either, which is how it was caught.
 */
const ATHEOS_BASELINE = {
  hasVideoStream: true,
  hasAudioStream: false,
  width: 1920,
  height: 1088,
  frameRate: 24,
  durationSeconds: 10.041667,
  // Highest scene score anywhere in the file. The weakest real cut in the
  // reference scores 13.2, so nothing here is an edit.
  cutTimestamps: [] as number[],
};

const GEMINI_REFERENCE = {
  hasVideoStream: true,
  hasAudioStream: true,
  width: 1280,
  height: 720,
  frameRate: 24,
  durationSeconds: 10.0,
  audioPeakDb: -0.2,
  audioDurationSeconds: 10.005,
  audioChannels: 2,
  audioSampleRate: 48_000,
  cutTimestamps: [2.166667, 4.916667, 7.416667],
};

const BRIEF: CommercialBrief = {
  prompt: "a red convertible on a coastal road",
  subject: "the red Porsche 911 Cabriolet from the reference image",
  objective: "Sell the feeling of an open-top coast drive",
  slogan: "ESCAPE THE ORDINARY",
  audio: "native",
  aspectRatio: "16:9",
  durationSeconds: 10,
};

describe("the measured gap between the two files", () => {
  it("records that the reference is smaller and better", () => {
    // A quarter of the pixels and the better commercial. Resolution was never
    // the gap, and a plan that chases resolution is chasing the wrong thing.
    expect(GEMINI_REFERENCE.height).toBeLessThan(ATHEOS_BASELINE.height);
    expect(GEMINI_REFERENCE.cutTimestamps.length).toBe(3);
    expect(ATHEOS_BASELINE.cutTimestamps.length).toBe(0);
    expect(GEMINI_REFERENCE.hasAudioStream).toBe(true);
    expect(ATHEOS_BASELINE.hasAudioStream).toBe(false);
  });

  it("puts the cut threshold between the two files", () => {
    // The weakest real cut scores 13.2; the busiest Atheos frame scores 2.28.
    expect(CUT_SCORE_THRESHOLD).toBeGreaterThan(2.28);
    expect(CUT_SCORE_THRESHOLD).toBeLessThan(13.2);
  });
});

describe("planning a commercial", () => {
  const plan = planCommercial(BRIEF);

  it("lays four shots evenly across ten seconds", () => {
    expect(plan.shots).toHaveLength(4);
    expect(plan.shots.map((s) => [s.start, s.end])).toEqual([
      [0, 2.5],
      [2.5, 5],
      [5, 7.5],
      [7.5, 10],
    ]);
  });

  it("counts one fewer cut than shots", () => {
    expect(plan.hardCuts).toBe(3);
  });

  it("asks for the overhead shot in terms of the lens, not the mood", () => {
    /**
     * "Near-vertical top-down" produced a high oblique rear shot twice. Naming
     * the optical axis is harder to reinterpret than an adjective.
     */
    expect(plan.shots[2].camera).toMatch(/straight down/);
    expect(plan.shots[2].camera).toMatch(/perpendicular to the road/);
  });

  it("ends on a pullback where the subject gets smaller", () => {
    expect(plan.shots[3].movement).toMatch(/car becomes small/);
  });

  it("carries every continuity clause", () => {
    for (const clause of COMMERCIAL_CONTINUITY) {
      expect(plan.continuity, clause).toContain(clause);
    }
  });
});

describe("compiling the commercial prompt", () => {
  const { prompt, negativePrompt } = compileCommercialPrompt(
    planCommercial(BRIEF),
  );

  it("opens with the exact edit instruction", () => {
    expect(
      prompt.startsWith(
        "Create an edited commercial containing exactly 4 separate shots and exactly 3 unmistakable hard cuts. Do not make one continuous orbit or uninterrupted drone movement.",
      ),
    ).toBe(true);
  });

  it("marks three hard cuts between four numbered shots", () => {
    expect(prompt.split("HARD CUT.").length - 1).toBe(3);
    const order = [...prompt.matchAll(/SHOT \d|HARD CUT\./g)].map((m) => m[0]);
    expect(order).toEqual([
      "SHOT 1",
      "HARD CUT.",
      "SHOT 2",
      "HARD CUT.",
      "SHOT 3",
      "HARD CUT.",
      "SHOT 4",
    ]);
  });

  it("names the subject specifically rather than by category", () => {
    // "the same red convertible" is what produced a 1960s roadster from a
    // modern Porsche. A category noun is not an identity.
    expect(prompt).toContain("Porsche 911 Cabriolet from the reference image");
    expect(prompt).toContain("the same headlights and taillights");
    expect(prompt).toContain("the same wheel design");
  });

  it("forbids the model rendering any text", () => {
    /**
     * Generated lettering fails at exactly the moment it matters, and a
     * misspelt slogan cannot be corrected without paying for another
     * generation. Atheos draws the copy afterwards.
     */
    expect(prompt).toContain("Render no text");
    expect(negativePrompt).toContain("on-screen text");
    expect(negativePrompt).toContain("lettering");
  });

  it("keeps the slogan out of the model's prompt entirely", () => {
    // If the copy is not in the prompt, the model cannot misspell it.
    expect(prompt).not.toContain("ESCAPE THE ORDINARY");
  });

  it("asks for diegetic audio only when the mode promises native sound", () => {
    expect(prompt).toMatch(/No speech, no dialogue/);
    const silent = compileCommercialPrompt(
      planCommercial({ ...BRIEF, audio: "silent" }),
    );
    expect(silent.prompt).not.toMatch(/Audio:/);
  });
});

describe("the reference capability hierarchy", () => {
  const veoStandard = {
    supportsReferenceImages: true,
    maxReferenceImages: 3,
    acceptsImageInput: true,
    acceptsEndFrame: true,
  };
  const veoFast = {
    supportsReferenceImages: false,
    acceptsImageInput: true,
    acceptsEndFrame: true,
  };
  const motionOne = {
    supportsReferenceImages: false,
    acceptsImageInput: false,
    acceptsEndFrame: false,
  };

  it("prefers several references when the model takes them", () => {
    expect(referenceStrategy(veoStandard, 3).strategy).toBe("multi_reference");
  });

  it("falls to a first frame when there is no reference input", () => {
    const { strategy, note } = referenceStrategy(veoFast, 1);
    expect(strategy).toBe("first_frame");
    // The honest caveat: the last Veo run held the Porsche for about three
    // seconds and then became a different car.
    expect(note).toMatch(/identity can drift/);
  });

  it("calls text-only what it is", () => {
    expect(referenceStrategy(motionOne, 1).strategy).toBe("text_only");
    expect(referenceStrategy(veoStandard, 0).strategy).toBe("text_only");
  });

  it("never advertises strong identity for a text-only model", () => {
    /**
     * The rule this hierarchy exists to enforce. The baseline was text-only and
     * returned a different car; a card promising strong consistency there would
     * be selling something the model cannot do.
     */
    expect(describeIdentityStrength("text_only")).toMatch(/^None/);
    expect(describeIdentityStrength("text_only")).not.toMatch(/strong/i);
    expect(describeIdentityStrength("first_frame")).toMatch(/^Partial/);
    expect(describeIdentityStrength("multi_reference")).toMatch(/^Strong/);
  });
});

describe("the delivery gate", () => {
  const commercialPromise = {
    durationSeconds: 10,
    aspectRatio: "16:9" as const,
    nativeHeight: 1080 as const,
    audioPromised: true,
    shotsPromised: 4,
  };

  it("fails the actual Atheos baseline", () => {
    /**
     * The whole point. This file was delivered as complete while the composer
     * showed a four-shot plan and "Soundscape added by Atheos".
     */
    const result = runDeliveryGate({
      measured: ATHEOS_BASELINE,
      promised: commercialPromise,
    });
    expect(result.outcome).toBe("fail");
    expect(result.deliver).toBe(false);
    expect(result.settleCredits).toBe(false);
    expect(result.failures.join(" ")).toMatch(/no audio stream at all/);
    expect(result.failures.join(" ")).toMatch(/no cuts at all/);
  });

  it("passes the Gemini reference against the same promise", () => {
    // Sanity: a gate that fails everything proves nothing.
    const result = runDeliveryGate({
      measured: GEMINI_REFERENCE,
      promised: { ...commercialPromise, nativeHeight: 720 },
    });
    expect(result.outcome).toBe("pass");
    expect(result.settleCredits).toBe(true);
    expect(result.label).toBe("4-shot commercial");
  });

  it("does not charge for a silent file sold with audio", () => {
    const result = runDeliveryGate({
      measured: { ...GEMINI_REFERENCE, hasAudioStream: false },
      promised: { ...commercialPromise, nativeHeight: 720 },
    });
    expect(result.settleCredits).toBe(false);
    expect(result.deliver).toBe(false);
  });

  it("fails when the audio level could not be measured at all", () => {
    /**
     * Fail closed. The check used to be `(peak ?? -100) < -60`, which looks
     * fail-closed and is not: `??` does not catch NaN, and a failed loudness
     * parse yields NaN, so `NaN < -60` waved the file through. Found by running
     * the gate against the real reference file rather than a fixture.
     */
    for (const peak of [undefined, Number.NaN]) {
      const result = runDeliveryGate({
        measured: { ...GEMINI_REFERENCE, audioPeakDb: peak },
        promised: { ...commercialPromise, nativeHeight: 720 },
      });
      expect(result.outcome, String(peak)).toBe("fail");
      expect(result.failures.join(" ")).toMatch(/could not be measured/);
    }
  });

  it("fails an audio stream that exists but is silent", () => {
    const result = runDeliveryGate({
      measured: { ...GEMINI_REFERENCE, audioPeakDb: -95 },
      promised: { ...commercialPromise, nativeHeight: 720 },
    });
    expect(result.failures.join(" ")).toMatch(/present but silent/);
  });

  it("treats 1088 as padding to normalise, not as a failure", () => {
    // H.264 codes in 16px macroblocks and 1080 is not a multiple of 16.
    const result = runDeliveryGate({
      measured: {
        ...ATHEOS_BASELINE,
        hasAudioStream: true,
        audioPeakDb: -14,
        audioDurationSeconds: 10.041667,
        audioChannels: 2,
        audioSampleRate: 48_000,
        cutTimestamps: [2.5, 5, 7.5],
      },
      promised: commercialPromise,
    });
    expect(result.outcome).toBe("pass");
    expect(result.warnings.join(" ")).toMatch(/macroblock padding/);
  });

  it("marks an uncertain shot count best-effort rather than failing it", () => {
    // A match cut can be invisible to a detector. Refusing delivery on that
    // would be worse than saying the count is uncertain.
    const result = runDeliveryGate({
      measured: { ...GEMINI_REFERENCE, cutTimestamps: [2.1, 5.0] },
      promised: { ...commercialPromise, nativeHeight: 720 },
    });
    expect(result.outcome).toBe("best_effort");
    expect(result.deliver).toBe(true);
    // Delivered, but not billed on a heuristic.
    expect(result.settleCredits).toBe(false);
    expect(result.label).toMatch(/best effort, for review/);
  });

  it("says nothing about shots when a continuous clip was promised", () => {
    const result = runDeliveryGate({
      measured: { ...GEMINI_REFERENCE, cutTimestamps: [] },
      promised: {
        ...commercialPromise,
        nativeHeight: 720,
        shotsPromised: 1,
      },
    });
    expect(result.outcome).toBe("pass");
    expect(result.label).toBe("Continuous clip");
  });

  it("accepts one frame of duration drift", () => {
    // The baseline's 241 frames at 24fps is 10.0417s against a 10s promise.
    const result = runDeliveryGate({
      measured: {
        ...GEMINI_REFERENCE,
        durationSeconds: 10.041667,
        audioDurationSeconds: 10.041667,
        cutTimestamps: [2.5, 5, 7.5],
      },
      promised: { ...commercialPromise, nativeHeight: 720 },
    });
    expect(result.failures.join(" ")).not.toMatch(/not the 10s promised/);
  });
});

describe("deterministic post-production", () => {
  it("crops 1088 back to 1080 rather than rescaling the whole frame", () => {
    const plan = planPostProduction({
      measured: { width: 1920, height: 1088, frameRate: 24 },
      aspectRatio: "16:9",
      overlays: [],
    });
    expect(plan.targetHeight).toBe(1080);
    expect(plan.filters[0]).toMatch(/^crop=1920:1080/);
    // Scaling would resample every pixel to remove rows that were never picture.
    expect(plan.filters.join(" ")).not.toMatch(/scale=/);
  });

  it("renders the supplied copy exactly", () => {
    const plan = planPostProduction({
      measured: { width: 1920, height: 1080, frameRate: 24 },
      aspectRatio: "16:9",
      overlays: BENCHMARK_COPY.map((text, i) => ({
        text,
        start: i * 2.5,
        end: i * 2.5 + 2,
        emphasis: "headline" as const,
      })),
    });
    for (const line of BENCHMARK_COPY) {
      expect(plan.filters.join("\n"), line).toContain(`text='${line}'`);
    }
  });

  it("keeps titles inside a 5% safe area", () => {
    const plan = planPostProduction({
      measured: { width: 1920, height: 1080, frameRate: 24 },
      aspectRatio: "16:9",
      overlays: [{ text: "HELLO", start: 0, end: 1, emphasis: "headline" }],
    });
    // 5% of 1080 is 54px; the headline sits above that plus its own height.
    expect(plan.filters.join(" ")).toMatch(/y=h-142/);
  });

  it("escapes a slogan that would break the filter graph", () => {
    /**
     * A colon separates filter options and a quote ends the literal, so an
     * unescaped slogan is either a crash or — worse — a caption silently
     * truncated at the colon.
     */
    expect(escapeDrawText("NOW: PURE FREEDOM")).toBe("NOW\\: PURE FREEDOM");
    expect(escapeDrawText("IT'S TIME")).toBe("IT\\'S TIME");
    expect(escapeDrawText("100% FREEDOM")).toBe("100\\% FREEDOM");
  });

  it("normalises loudness and can emit a clean plate", () => {
    const plan = planPostProduction({
      measured: { width: 1920, height: 1080, frameRate: 24 },
      aspectRatio: "16:9",
      overlays: [],
      cleanVersion: true,
    });
    expect(plan.loudnessTargetLufs).toBe(-14);
    expect(plan.emitCleanVersion).toBe(true);
  });

  it("preserves the frame rate rather than resampling it", () => {
    const plan = planPostProduction({
      measured: { width: 1920, height: 1088, frameRate: 24 },
      aspectRatio: "16:9",
      overlays: [],
    });
    expect(plan.frameRate).toBe(24);
  });
});
