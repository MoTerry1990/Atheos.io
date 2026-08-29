import { describe, expect, it } from "vitest";

import {
  assembledDurationMatches,
  clipLengthsFor,
  formatUsd,
  generateLabel,
  quoteSequence,
  retryBudgetFor,
  settleSequence,
  validateSequenceContinuity,
  type ShotMeasurement,
} from "@/services/ai/sequence";
import { MOTION_1, MOTION_PRO } from "@/services/ai/sequence-models.public";
import { buildDirectorPlan } from "@/services/ai/video-director";
import { providerCostMicroUsdFor } from "@/services/ai/sequence-models.server";
import { SEQUENCE_CANDIDATES } from "@/services/ai/sequence-candidates.server";

const CINEMATIC_ES =
  "video cinematográfico del carro rojo en la carretera de la costa, " +
  "desde el cielo, de todos los ángulos, con audio";

/** The prompt from the production test: four shots across five seconds. */
const FOUR_SHOT = buildDirectorPlan({
  prompt: CINEMATIC_ES,
  durationSeconds: 5,
});

const CONTINUOUS = buildDirectorPlan({
  prompt: "el carro rojo desde el cielo, sin cortes",
  durationSeconds: 5,
});

describe("the plan the production test produced", () => {
  it("is four shots, and that is what gets priced", () => {
    expect(FOUR_SHOT.shots).toHaveLength(4);
    expect(
      quoteSequence({
        baseCredits: 90,
        plan: FOUR_SHOT,
        facts: MOTION_PRO,
        mode: "multi_shot",
      }).providerCalls,
    ).toBe(4);
  });
});

describe("a four-shot prompt cannot silently become one shot", () => {
  it("blocks multi-shot on a model that cannot carry a scene between shots", () => {
    /**
     * Motion 1's schema has no image input at all — no `image`, no
     * `last_frame_image`, no `reference_images`. Four calls to it return four
     * unrelated cars, so this is a refusal rather than a warning.
     */
    const quote = quoteSequence({
      baseCredits: 90,
      plan: FOUR_SHOT,
      facts: MOTION_1,
      mode: "multi_shot",
    });
    expect(quote.blockers).not.toHaveLength(0);
    expect(quote.blockers.join(" ")).toMatch(/no image input/);
    expect(quote.blockers.join(" ")).toMatch(/four unrelated clips/);
  });

  it("never quotes one call for a four-shot plan", () => {
    // The exact substitution the old UI made: plan four, generate the first,
    // charge for one. A quote that says "1 call" for a four-shot request is
    // that bug regardless of what the warning text says.
    const quote = quoteSequence({
      baseCredits: 180,
      plan: FOUR_SHOT,
      facts: MOTION_PRO,
      mode: "multi_shot",
    });
    expect(quote.providerCalls).toBe(FOUR_SHOT.shots.length);
    expect(quote.clipDurationsSeconds).toHaveLength(4);
  });

  it("says so plainly when a single-shot plan is asked to be a sequence", () => {
    const quote = quoteSequence({
      baseCredits: 180,
      plan: CONTINUOUS,
      facts: MOTION_PRO,
      mode: "multi_shot",
    });
    expect(quote.blockers.join(" ")).toMatch(/single continuous shot/);
  });
});

describe("the displayed credits buy the whole deliverable", () => {
  it("charges for every clip, not the first one", () => {
    /**
     * The headline number. Motion Pro's floor is 5s, so four shots of 1–1.5s
     * each are still four 5s clips: 20 seconds generated to deliver 5.
     */
    const quote = quoteSequence({
      baseCredits: 180,
      plan: FOUR_SHOT,
      facts: MOTION_PRO,
      mode: "multi_shot",
    });
    expect(quote.clipDurationsSeconds).toEqual([5, 5, 5, 5]);
    expect(quote.generatedSeconds).toBe(20);
    expect(quote.creditCharge).toBe(720);
    // Four times the single-shot price, and not a credit less.
    expect(quote.creditCharge).toBe(
      4 *
        quoteSequence({
          baseCredits: 180,
          plan: CONTINUOUS,
          facts: MOTION_PRO,
          mode: "continuous",
        }).creditCharge,
    );
  });

  it("prices the provider cost from seconds generated, not seconds delivered", () => {
    const quote = quoteSequence({
      baseCredits: 180,
      plan: FOUR_SHOT,
      facts: MOTION_PRO,
      mode: "multi_shot",
    });
    // 20s x $0.054. Quoting the delivered 5s would understate it fourfold.
    expect(
      providerCostMicroUsdFor({
        publicModelId: quote.modelId,
        generatedSeconds: quote.generatedSeconds,
      }),
    ).toBe(1_080_000);
    expect(
      formatUsd(
        providerCostMicroUsdFor({
          publicModelId: quote.modelId,
          generatedSeconds: quote.generatedSeconds,
        }),
      ),
    ).toBe("$1.08");
  });

  it("labels the button with the deliverable and its full price", () => {
    /**
     * "Generate · 90 credits" over a four-shot plan was the lie: 90 credits
     * bought the establishing shot. The label now names both together so they
     * cannot be read apart.
     */
    const sequence = quoteSequence({
      baseCredits: 180,
      plan: FOUR_SHOT,
      facts: MOTION_PRO,
      mode: "multi_shot",
    });
    expect(generateLabel(sequence)).toBe(
      "Generate 4-shot sequence · 720 credits",
    );

    const single = quoteSequence({
      baseCredits: 90,
      plan: FOUR_SHOT,
      facts: MOTION_1,
      mode: "continuous",
    });
    expect(generateLabel(single)).toBe("Generate · 90 credits");

    // And a blocked sequence offers no price at all.
    expect(
      generateLabel(
        quoteSequence({
          baseCredits: 90,
          plan: FOUR_SHOT,
          facts: MOTION_1,
          mode: "multi_shot",
        }),
      ),
    ).toBe("Not available on this model");
  });
});

describe("the two modes are distinct, not a default and a footnote", () => {
  it("differ in calls, cost, credits and time", () => {
    const single = quoteSequence({
      baseCredits: 180,
      plan: FOUR_SHOT,
      facts: MOTION_PRO,
      mode: "continuous",
    });
    const sequence = quoteSequence({
      baseCredits: 180,
      plan: FOUR_SHOT,
      facts: MOTION_PRO,
      mode: "multi_shot",
    });

    expect(single.providerCalls).toBe(1);
    expect(sequence.providerCalls).toBe(4);
    expect(sequence.creditCharge).toBeGreaterThan(single.creditCharge);
    expect(
      providerCostMicroUsdFor({
        publicModelId: sequence.modelId,
        generatedSeconds: sequence.generatedSeconds,
      }),
    ).toBeGreaterThan(
      providerCostMicroUsdFor({
        publicModelId: single.modelId,
        generatedSeconds: single.generatedSeconds,
      }),
    );
    // Chained shots run one after another, so the wait is four clips long.
    expect(sequence.estimatedSeconds).toBe(single.estimatedSeconds * 4);
  });

  it("does not stretch a continuous clip past what the model can render", () => {
    const long = buildDirectorPlan({
      prompt: "el carro sin cortes",
      durationSeconds: 30,
    });
    const quote = quoteSequence({
      baseCredits: 90,
      plan: long,
      facts: MOTION_1,
      mode: "continuous",
    });
    expect(quote.clipDurationsSeconds).toEqual([7.5]);
    expect(quote.assembledDurationSeconds).toBe(7.5);
  });
});

describe("nothing is charged for work that was not done", () => {
  const quote = quoteSequence({
    baseCredits: 180,
    plan: FOUR_SHOT,
    facts: MOTION_PRO,
    mode: "multi_shot",
  });

  it("charges nothing when the user cancels before any provider call", () => {
    const settlement = settleSequence({ quote, outcomes: [] });
    expect(settlement.chargeCredits).toBe(0);
    expect(settlement.deliver).toBe(false);
  });

  it("refuses to deliver or fully charge a partial sequence", () => {
    /**
     * Three shots out of four is not 75% of a video — it is a video with a hole
     * in it. Delivering it while charging for four would be full price for a
     * broken thing, so the sequence is withheld and only the shots that arrived
     * are charged.
     */
    const settlement = settleSequence({
      quote,
      outcomes: [
        { index: 0, status: "succeeded", billedSeconds: 5 },
        { index: 1, status: "succeeded", billedSeconds: 5 },
        { index: 2, status: "failed", billedSeconds: 5 },
        { index: 3, status: "succeeded", billedSeconds: 5 },
      ],
    });
    expect(settlement.deliver).toBe(false);
    expect(settlement.chargeCredits).toBe(540);
    expect(settlement.refundCredits).toBe(180);
    expect(settlement.reason).toMatch(/only 3 of 4/);
    expect(settlement.reason).toMatch(/individual clips/);
  });

  it("charges and delivers only when every shot arrived", () => {
    const settlement = settleSequence({
      quote,
      outcomes: [0, 1, 2, 3].map((index) => ({
        index,
        status: "succeeded" as const,
        billedSeconds: 5,
      })),
    });
    expect(settlement.deliver).toBe(true);
    expect(settlement.chargeCredits).toBe(quote.creditCharge);
    expect(settlement.refundCredits).toBe(0);
  });

  it("keeps the charge and the quote defined as the same number", () => {
    // Re-pricing at settlement time is how the quote and the bill drift apart.
    const settlement = settleSequence({
      quote,
      outcomes: [{ index: 0, status: "succeeded", billedSeconds: 5 }],
    });
    expect(settlement.chargeCredits + settlement.refundCredits).toBe(
      quote.creditCharge,
    );
  });
});

describe("retries have a hard ceiling", () => {
  const quote = quoteSequence({
    baseCredits: 180,
    plan: FOUR_SHOT,
    facts: MOTION_PRO,
    mode: "multi_shot",
  });

  it("allows a first retry", () => {
    const budget = retryBudgetFor({
      quote,
      providerCostMicroUsd: providerCostMicroUsdFor({
        publicModelId: quote.modelId,
        generatedSeconds: quote.generatedSeconds,
      }),
      attemptsSoFar: 1,
      spentMicroUsd: 270_000,
    });
    expect(budget.allowed).toBe(true);
    expect(budget.additionalCostMicroUsd).toBe(270_000);
  });

  it("stops at the attempt limit", () => {
    const budget = retryBudgetFor({
      quote,
      providerCostMicroUsd: providerCostMicroUsdFor({
        publicModelId: quote.modelId,
        generatedSeconds: quote.generatedSeconds,
      }),
      attemptsSoFar: 2,
      spentMicroUsd: 270_000,
    });
    expect(budget.allowed).toBe(false);
    expect(budget.reason).toMatch(/limit 2/);
  });

  it("stops when a retry would break the spend ceiling", () => {
    /**
     * The limit that matters more than the count: retries on a per-call
     * provider are a way to spend an unbounded amount of money on a request the
     * user approved once, at one price.
     */
    const budget = retryBudgetFor({
      quote,
      providerCostMicroUsd: providerCostMicroUsdFor({
        publicModelId: quote.modelId,
        generatedSeconds: quote.generatedSeconds,
      }),
      attemptsSoFar: 0,
      spentMicroUsd: 1_600_000,
    });
    expect(budget.allowed).toBe(false);
    expect(budget.reason).toMatch(/ceiling/);
    expect(budget.additionalCostMicroUsd).toBe(0);
  });
});

describe("continuity is checked before the shots are joined", () => {
  const base: ShotMeasurement = {
    index: 0,
    width: 1920,
    height: 1080,
    frameRate: 24,
    durationSeconds: 5,
    meanLuma: 140,
    meanHueDegrees: 200,
  };

  it("passes shots that match", () => {
    const report = validateSequenceContinuity([
      base,
      { ...base, index: 1, meanLuma: 148, meanHueDegrees: 210 },
    ]);
    expect(report.ok).toBe(true);
  });

  it("catches a shot shot at a different time of day", () => {
    const report = validateSequenceContinuity([
      base,
      { ...base, index: 1, meanLuma: 40 },
    ]);
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/the light does not match/);
  });

  it("catches a shot graded a different colour", () => {
    const report = validateSequenceContinuity([
      base,
      { ...base, index: 1, meanHueDegrees: 20 },
    ]);
    expect(report.problems.join(" ")).toMatch(/the grade does not match/);
  });

  it("treats hue as circular", () => {
    // 350 and 10 are twenty degrees apart, not three hundred and forty.
    const report = validateSequenceContinuity([
      { ...base, meanHueDegrees: 350 },
      { ...base, index: 1, meanHueDegrees: 10 },
    ]);
    expect(report.ok).toBe(true);
  });

  it("catches mismatched frame size and rate", () => {
    const report = validateSequenceContinuity([
      base,
      { ...base, index: 1, width: 1280, height: 720, frameRate: 30 },
    ]);
    expect(report.problems.join(" ")).toMatch(/1280x720/);
    expect(report.problems.join(" ")).toMatch(/30fps/);
  });

  it("has nothing to compare for a single shot", () => {
    expect(validateSequenceContinuity([base]).ok).toBe(true);
  });
});

describe("the delivered duration is the quoted duration", () => {
  const quote = quoteSequence({
    baseCredits: 180,
    plan: FOUR_SHOT,
    facts: MOTION_PRO,
    mode: "multi_shot",
  });

  it("accepts a frame of rounding", () => {
    expect(assembledDurationMatches(quote, 5.02).ok).toBe(true);
  });

  it("rejects a file that is not the length the user was told", () => {
    const check = assembledDurationMatches(quote, 20);
    expect(check.ok).toBe(false);
    // 20s is what was generated; 5s is what was quoted. Shipping the untrimmed
    // concatenation and calling it the deliverable is a real failure mode.
    expect(check.problem).toMatch(/20.000s but was quoted as 5s/);
  });
});

describe("resolution and audio are never overstated", () => {
  it("reports what the provider returns, not what the dropdown offers", () => {
    /**
     * Motion 1's adapter sends `resolution: "720p"` on every call regardless of
     * the Size control, so choosing 1080px changes the label and nothing else.
     */
    const quote = quoteSequence({
      baseCredits: 90,
      plan: CONTINUOUS,
      facts: MOTION_1,
      mode: "continuous",
      requestedResolution: "1080p",
    });
    expect(quote.nativeResolution).toBe("720p");
    expect(quote.exportResolution).toBe("1080p (upscaled from 720p)");
  });

  it("says plain 720p when nothing larger was asked for", () => {
    const quote = quoteSequence({
      baseCredits: 90,
      plan: CONTINUOUS,
      facts: MOTION_1,
      mode: "continuous",
    });
    expect(quote.exportResolution).toBe("720p");
    expect(quote.exportResolution).not.toMatch(/1080|4K/);
  });

  it("calls Atheos audio Atheos audio", () => {
    const quote = quoteSequence({
      baseCredits: 180,
      plan: FOUR_SHOT,
      facts: MOTION_PRO,
      mode: "multi_shot",
      wantsAudio: true,
    });
    // Neither shipped model produces sound. Calling this "native" would be a
    // straightforward lie about how the video was made.
    expect(quote.audio).toBe("atheos_soundscape");
  });

  it("reports no audio when none was asked for", () => {
    expect(
      quoteSequence({
        baseCredits: 90,
        plan: FOUR_SHOT,
        facts: MOTION_PRO,
        mode: "multi_shot",
      }).audio,
    ).toBe("none");
  });

  it("would report native audio only for a model that has it", () => {
    const quote = quoteSequence({
      baseCredits: 90,
      plan: CONTINUOUS,
      facts: { ...MOTION_PRO, nativeAudio: true },
      mode: "continuous",
    });
    expect(quote.audio).toBe("native");
  });
});

describe("the candidate models are recorded honestly", () => {
  it("records that not one of them takes a shot list", () => {
    // The finding that forces the orchestrator: there is no model to route a
    // four-shot request to, at any price.
    for (const candidate of SEQUENCE_CANDIDATES) {
      expect(candidate.multiShot, candidate.slug).toBe(false);
    }
    expect(MOTION_1.acceptsImageInput).toBe(false);
    expect(MOTION_PRO.acceptsEndFrame).toBe(true);
  });

  it("names Veo 3 Fast as the only one with native audio", () => {
    const withAudio = SEQUENCE_CANDIDATES.filter((c) => c.nativeAudio);
    expect(withAudio.map((c) => c.slug)).toEqual(["google/veo-3-fast"]);
  });

  it("keeps unverified costs out of the priced type", () => {
    /**
     * A quote built from a guessed rate is a made-up price. The candidates
     * carry no `perSecondMicroUsd`, so one cannot be passed to `quoteSequence`
     * by accident and priced as though it had been measured.
     */
    for (const candidate of SEQUENCE_CANDIDATES) {
      expect(candidate).not.toHaveProperty("perSecondMicroUsd");
      expect(candidate.note).toMatch(/unverified/i);
    }
  });
});

describe("clip lengths respect the model's own floor and ceiling", () => {
  it("raises a short shot to the model's minimum", () => {
    // The plan's 1s top-down beat is billed as a 5s clip, because that is what
    // the provider charges for.
    const lengths = clipLengthsFor(FOUR_SHOT, MOTION_PRO, "multi_shot");
    expect(Math.min(...lengths)).toBe(5);
  });

  it("caps a long shot at the model's maximum", () => {
    const long = buildDirectorPlan({
      prompt: CINEMATIC_ES,
      durationSeconds: 120,
    });
    for (const length of clipLengthsFor(long, MOTION_PRO, "multi_shot")) {
      expect(length).toBeLessThanOrEqual(12);
    }
  });
});
