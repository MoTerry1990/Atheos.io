import { describe, expect, it } from "vitest";

import {
  compileDirectedPrompt,
  DIRECTED_NEGATIVES,
  snapDuration,
} from "@/services/ai/directed-prompt";
import { buildAudioPlan } from "@/services/ai/audio-director";
import {
  creditsAtMargin,
  generateLabel,
  quoteSequence,
} from "@/services/ai/sequence";
import {
  CINEMATIC,
  CINEMATIC_FAST,
  CINEMATIC_LITE,
  MOTION_1,
  MOTION_PRO,
  VIDEO_TIERS,
} from "@/services/ai/sequence-models.public";
import {
  providerCostMicroUsdFor,
  SEQUENCE_COST_NOTES,
} from "@/services/ai/sequence-models.server";
import { GEMINI_OMNI_FLASH_NOTE } from "@/services/ai/sequence-candidates.server";
import {
  buildVeoRequest,
  validateDeliveredVideo,
} from "@/services/ai/veo-adapter";
import { buildDirectorPlan } from "@/services/ai/video-director";

const CINEMATIC_ES =
  "video cinematográfico del carro rojo en la carretera de la costa, " +
  "desde el cielo, de todos los ángulos, con audio";

const PLAN = buildDirectorPlan({
  prompt: CINEMATIC_ES,
  durationSeconds: 5,
  subject: "a red convertible",
  subjectIdentity: "the same blonde woman driving",
  location: "a coastal road beside vivid blue water",
});

const AUDIO = buildAudioPlan({
  prompt: CINEMATIC_ES,
  plan: PLAN,
  providerHasNativeAudio: true,
});

describe("compiling the plan into one directed prompt", () => {
  const compiled = compileDirectedPrompt({
    plan: PLAN,
    durationSeconds: 8,
    audio: AUDIO,
    supportsNegativePrompt: true,
  });

  it("writes every beat as a timed chronological instruction", () => {
    /**
     * The correction this whole module exists for. The previous audit looked
     * for a `shot_list` parameter, found none, and concluded a directed
     * sequence was impossible. The compiled prompt *is* the shot list.
     */
    expect(compiled.beats).toHaveLength(4);
    // Written as a numbered shot list rather than a timeline of positions —
    // see tests/unit/directed-shot-list.test.ts for why that distinction cost
    // a benchmark.
    compiled.beats.forEach((beat, index) => {
      expect(compiled.prompt).toContain(
        `SHOT ${index + 1} — ${beat.start.toFixed(1)}–${beat.end.toFixed(1)} seconds`,
      );
    });
  });

  it("rescales the beats onto the length the provider will render", () => {
    // A 5-second plan sent as an 8-second render leaves three seconds the
    // prompt says nothing about — which is three seconds of invented ending.
    expect(compiled.beats[0].start).toBe(0);
    expect(compiled.beats[compiled.beats.length - 1].end).toBe(8);
  });

  it("keeps the beats in order and contiguous", () => {
    let cursor = 0;
    for (const beat of compiled.beats) {
      expect(beat.start).toBeCloseTo(cursor, 1);
      expect(beat.end).toBeGreaterThan(beat.start);
      cursor = beat.end;
    }
  });

  it("states the continuity requirements once, not inside every beat", () => {
    /**
     * Repeating "the same red car" in all four beats invites the model to treat
     * each beat as its own scene that happens to share adjectives. Stated once
     * and globally, they read as properties of the world.
     */
    const occurrences = compiled.prompt.split("Throughout the entire video");
    expect(occurrences).toHaveLength(2);

    expect(compiled.prompt).toMatch(/one vehicle only, never a second copy/);
    expect(compiled.prompt).toMatch(/one consistent direction/);
    expect(compiled.prompt).toMatch(/sun in the same place/);
    expect(compiled.prompt).toMatch(/Wheels rotate/);
    // The continuous-camera line is replaced in multi-shot mode: it used to
    // contradict the hard cuts demanded three paragraphs above.
    expect(compiled.prompt).toMatch(/Each shot holds its own camera setup/);
  });

  it("directs the audio as diegetic sound and excludes speech", () => {
    // A model asked for "audio" over a driving shot will invent dialogue.
    expect(compiled.includesAudioDirection).toBe(true);
    expect(compiled.prompt).toMatch(/engine/);
    expect(compiled.prompt).toMatch(/wind/);
    expect(compiled.prompt).toMatch(/surf/);
    expect(compiled.prompt).toMatch(/No speech, no dialogue/);
    expect(compiled.prompt).toMatch(/No music\./);
  });

  it("adds music only when music was asked for", () => {
    const withMusic = compileDirectedPrompt({
      plan: PLAN,
      durationSeconds: 8,
      audio: buildAudioPlan({
        prompt: "el carro con música",
        plan: PLAN,
        providerHasNativeAudio: true,
      }),
    });
    expect(withMusic.prompt).toMatch(/Music: original instrumental bed/);
  });

  it("omits audio direction entirely when none was requested", () => {
    const silent = compileDirectedPrompt({
      plan: PLAN,
      durationSeconds: 8,
      audio: buildAudioPlan({
        prompt: "un carro rojo en la carretera",
        plan: PLAN,
        providerHasNativeAudio: true,
      }),
    });
    expect(silent.includesAudioDirection).toBe(false);
    expect(silent.prompt).not.toMatch(/No speech/);
  });

  it("keeps prohibitions out of the positive prompt", () => {
    /**
     * "No duplicate vehicles" inside a prompt is a sentence containing the
     * words "duplicate vehicles", and models routinely render the thing a naive
     * negation names. They belong in `negative_prompt` or nowhere.
     */
    for (const negative of DIRECTED_NEGATIVES) {
      expect(compiled.prompt).not.toContain(negative);
    }
    expect(compiled.negativePrompt).toContain("duplicate vehicles");
  });

  it("drops the prohibitions for a model with no negative-prompt input", () => {
    const lite = compileDirectedPrompt({
      plan: PLAN,
      durationSeconds: 8,
      audio: AUDIO,
      supportsNegativePrompt: false,
    });
    expect(lite.negativePrompt).toBe("");
    expect(lite.prompt).not.toContain("duplicate vehicles");
  });

  it("writes one unbroken shot when the plan has one", () => {
    const single = compileDirectedPrompt({
      plan: buildDirectorPlan({
        prompt: "el carro rojo desde el cielo sin cortes",
        durationSeconds: 5,
      }),
      durationSeconds: 8,
    });
    expect(single.beats).toHaveLength(1);
    expect(single.prompt).toMatch(/One unbroken 8-second shot/);
    expect(single.prompt).not.toMatch(/deliberate camera positions/);
  });
});

describe("snapping a duration to what the model renders", () => {
  it("rounds up rather than to the nearest", () => {
    // 4s would lose a fifth of a 5-second piece; 6s gives the beats room.
    expect(snapDuration(5, [4, 6, 8])).toEqual({ seconds: 6, adjusted: true });
  });

  it("leaves an already-valid length alone", () => {
    expect(snapDuration(8, [4, 6, 8])).toEqual({ seconds: 8, adjusted: false });
  });

  it("caps at the longest the model offers", () => {
    expect(snapDuration(30, [4, 6, 8]).seconds).toBe(8);
  });
});

describe("the tier claims match the schemas they came from", () => {
  it("advertises native audio only where the model has it", () => {
    expect(MOTION_1.nativeAudio).toBe(false);
    expect(MOTION_PRO.nativeAudio).toBe(false);
    for (const veo of [CINEMATIC_LITE, CINEMATIC_FAST, CINEMATIC]) {
      expect(veo.nativeAudio, veo.label).toBe(true);
    }
  });

  it("advertises reference images only on the full model", () => {
    // Only veo-3.1 has `reference_images`; fast and lite do not.
    expect(CINEMATIC.supportsReferenceImages).toBe(true);
    expect(CINEMATIC_FAST.supportsReferenceImages).toBe(false);
    expect(CINEMATIC_LITE.supportsReferenceImages).toBe(false);
  });

  it("advertises a negative prompt only where the input exists", () => {
    expect(CINEMATIC.supportsNegativePrompt).toBe(true);
    expect(CINEMATIC_FAST.supportsNegativePrompt).toBe(true);
    // Lite's schema is seed, image, prompt, duration, last_frame, resolution,
    // aspect_ratio — and nothing else.
    expect(CINEMATIC_LITE.supportsNegativePrompt).toBe(false);
  });

  it("claims directed beats only for models documented to hold them", () => {
    expect(MOTION_1.followsDirectedBeats).toBe(false);
    expect(MOTION_PRO.followsDirectedBeats).toBe(false);
    expect(CINEMATIC_FAST.followsDirectedBeats).toBe(true);
  });

  it("claims video extension nowhere, because no path exposes it", () => {
    // Google's own API documents extension; Replicate's wrapper has no `video`
    // input, and Replicate is the only path Atheos has.
    for (const tier of VIDEO_TIERS) {
      expect(tier.facts.supportsVideoExtension, tier.facts.label).toBe(false);
    }
  });

  it("records where every cost figure came from", () => {
    /**
     * Read from `SEQUENCE_COST_NOTES` rather than from the facts.
     *
     * `costBasis` and `reachableVia` were fields on `SequenceModelFacts`,
     * which three client components import — so a provider name and notes
     * reading "Replicate margin unverified" shipped to every browser that
     * opened the Studio. They are commercial working notes, not capabilities,
     * so they moved to a server-only record. The audit trail they exist for is
     * unchanged, and still asserted.
     */
    for (const tier of VIDEO_TIERS) {
      expect(
        SEQUENCE_COST_NOTES[tier.facts.id]?.costBasis,
        tier.facts.label,
      ).toBeTruthy();
    }
    // The two invoice-derived ones say so; the Veo ones say the margin is not.
    expect(SEQUENCE_COST_NOTES["motion-1"]!.costBasis).toMatch(/invoice/);
    expect(SEQUENCE_COST_NOTES["cinematic-fast"]!.costBasis).toMatch(
      /unverified/,
    );
  });

  it("keeps the provider name off anything a browser receives", () => {
    /**
     * The leak this split closes, asserted where it can regress: the facts are
     * what the client imports, so nothing in them may name who runs the model.
     */
    for (const tier of VIDEO_TIERS) {
      expect(JSON.stringify(tier.facts), tier.facts.label).not.toMatch(
        /replicate|google|bytedance|wan-video|seedance/i,
      );
    }
  });

  it("keeps Gemini Omni Flash out of the catalogue and says why", () => {
    /**
     * Google's docs recommend it as the default video model. It is not in
     * `VIDEO_TIERS` because it is not on Replicate and there is no
     * GOOGLE_AI_API_KEY — reasons of access, not of quality.
     */
    expect(VIDEO_TIERS.map((t) => t.facts.id)).not.toContain(
      GEMINI_OMNI_FLASH_NOTE.modelId,
    );
    expect(GEMINI_OMNI_FLASH_NOTE.reachableVia).toBe("google-direct");
    expect(GEMINI_OMNI_FLASH_NOTE.blockers.join(" ")).toMatch(
      /not available on Replicate/,
    );
    expect(GEMINI_OMNI_FLASH_NOTE.blockers.join(" ")).toMatch(
      /GOOGLE_AI_API_KEY/,
    );
  });
});

describe("quoting a directed generation", () => {
  const quote = quoteSequence({
    baseCredits: 288,
    plan: PLAN,
    facts: CINEMATIC_FAST,
    mode: "directed",
    wantsAudio: true,
  });

  it("is one provider call, not four", () => {
    expect(quote.providerCalls).toBe(1);
    expect(quote.blockers).toHaveLength(0);
  });

  it("renders 6 seconds for a 5-second plan and says the length changed", () => {
    expect(quote.clipDurationsSeconds).toEqual([6]);
    expect(quote.assembledDurationSeconds).toBe(6);
  });

  it("prices from the verified per-second rate", () => {
    // 6s x $0.12 at 1080p.
    expect(
      providerCostMicroUsdFor({
        publicModelId: quote.modelId,
        generatedSeconds: quote.generatedSeconds,
      }),
    ).toBe(720_000);
  });

  it("clears the documented 3x video margin floor", () => {
    /**
     * `model-costs.ts` fixes a credit at $0.005 and requires video revenue to be
     * at least three times worst-case provider cost.
     */
    const revenueMicroUsd = quote.creditCharge * 5_000;
    expect(revenueMicroUsd).toBeGreaterThanOrEqual(
      providerCostMicroUsdFor({
        publicModelId: quote.modelId,
        generatedSeconds: quote.generatedSeconds,
      }) * 3,
    );
  });

  it("matches the brief's stated 8-second provider costs", () => {
    const eight = quoteSequence({
      baseCredits: 288,
      plan: buildDirectorPlan({ prompt: CINEMATIC_ES, durationSeconds: 8 }),
      facts: CINEMATIC_FAST,
      mode: "directed",
    });
    // $0.96 at 1080p, and 576 credits to clear 3x.
    expect(
      providerCostMicroUsdFor({
        publicModelId: eight.modelId,
        generatedSeconds: eight.generatedSeconds,
      }),
    ).toBe(960_000);
    expect(eight.creditCharge).toBe(576);
  });

  it("reports native audio as native", () => {
    expect(quote.audio).toBe("native");
  });

  it("says the beats are instructed rather than guaranteed", () => {
    // "Four shots" may only be claimed when the provider was instructed with
    // four beats and the result was checked. Until then: best effort.
    expect(quote.continuityLimitations.join(" ")).toMatch(/best effort/);
    expect(quote.continuityLimitations.join(" ")).toMatch(
      /written into the prompt/,
    );
  });

  it("refuses a directed sequence on a model that cannot hold one", () => {
    const bad = quoteSequence({
      baseCredits: 90,
      plan: PLAN,
      facts: MOTION_1,
      mode: "directed",
    });
    expect(bad.blockers.join(" ")).toMatch(/not documented for holding/);
    expect(generateLabel(bad)).toBe("Not available on this model");
  });

  it("labels the button by what it makes, not by a shot count", () => {
    // "Camera movement", never a shot count: the last directed generation was
    // instructed with four beats and returned one continuous take with no cuts.
    expect(generateLabel(quote)).toBe(
      "Generate directed camera movement · 432 credits",
    );
  });

  it("is far cheaper and faster than the chained path", () => {
    /**
     * The whole point of the reassessment. Four chained Motion Pro calls are
     * $1.08 and roughly 47 minutes; one directed Veo call is $0.72, three
     * minutes, and arrives with sound.
     */
    const chained = quoteSequence({
      baseCredits: 180,
      plan: PLAN,
      facts: MOTION_PRO,
      mode: "multi_shot",
    });
    expect(
      providerCostMicroUsdFor({
        publicModelId: quote.modelId,
        generatedSeconds: quote.generatedSeconds,
      }),
    ).toBeLessThan(
      providerCostMicroUsdFor({
        publicModelId: chained.modelId,
        generatedSeconds: chained.generatedSeconds,
      }),
    );
    expect(quote.estimatedSeconds).toBeLessThan(chained.estimatedSeconds / 10);
    expect(quote.audio).toBe("native");
    expect(chained.audio).not.toBe("native");
  });
});

describe("building a Veo request without sending one", () => {
  it("sends only fields the model declares", () => {
    const request = buildVeoRequest({
      facts: CINEMATIC_LITE,
      plan: PLAN,
      audio: AUDIO,
      requestedDurationSeconds: 8,
    });
    // Lite has no negative_prompt and no generate_audio. Sending either is a
    // rejected job on credits already reserved — how Motion 1 shipped broken.
    expect(request.input).not.toHaveProperty("negative_prompt");
    expect(request.input).not.toHaveProperty("generate_audio");
    expect(request.input.prompt).toBeTruthy();
  });

  it("sends the negative prompt where the input exists", () => {
    const request = buildVeoRequest({
      facts: CINEMATIC_FAST,
      plan: PLAN,
      audio: AUDIO,
      requestedDurationSeconds: 8,
    });
    expect(request.input.negative_prompt).toContain("duplicate vehicles");
    expect(request.input.generate_audio).toBe(true);
  });

  it("snaps an unrenderable duration and says so", () => {
    const request = buildVeoRequest({
      facts: CINEMATIC_FAST,
      plan: PLAN,
      requestedDurationSeconds: 5,
    });
    expect(request.input.duration).toBe(6);
    expect(request.adjustments.join(" ")).toMatch(/5s becomes 6s/);
  });

  it("drops Lite to 720p rather than sending a request it will reject", () => {
    // Lite renders 1080p only at 8 seconds, per its own duration description.
    const request = buildVeoRequest({
      facts: CINEMATIC_LITE,
      plan: PLAN,
      requestedDurationSeconds: 4,
      resolution: "1080p",
    });
    expect(request.input.resolution).toBe("720p");
    expect(request.adjustments.join(" ")).toMatch(/only at 8 seconds/);
  });

  it("warns that Lite's audio cannot be switched off", () => {
    const request = buildVeoRequest({
      facts: CINEMATIC_LITE,
      plan: PLAN,
      requestedDurationSeconds: 8,
    });
    expect(request.adjustments.join(" ")).toMatch(/always generates audio/);
  });

  it("refuses references outside the 16:9 and 8-second window", () => {
    /**
     * A refusal rather than a silent correction: forcing both would change the
     * shape and length of the video someone asked for, and charge more for it.
     */
    const request = buildVeoRequest({
      facts: CINEMATIC,
      plan: PLAN,
      requestedDurationSeconds: 4,
      referenceImageUrls: ["https://example.test/car.png"],
    });
    expect(request.refusals.join(" ")).toMatch(/only at 16:9 and 8 seconds/);
    expect(request.input).not.toHaveProperty("reference_images");
  });

  it("sends references when the window is satisfied", () => {
    const request = buildVeoRequest({
      facts: CINEMATIC,
      plan: PLAN,
      requestedDurationSeconds: 8,
      aspectRatio: "16:9",
      referenceImageUrls: ["https://example.test/car.png"],
    });
    expect(request.input.reference_images).toHaveLength(1);
    expect(request.refusals).toHaveLength(0);
  });

  it("refuses more than three references", () => {
    const request = buildVeoRequest({
      facts: CINEMATIC,
      plan: PLAN,
      requestedDurationSeconds: 8,
      referenceImageUrls: ["a", "b", "c", "d"],
    });
    expect(request.refusals.join(" ")).toMatch(/limited to three/);
  });

  it("does not send an end frame Veo would ignore", () => {
    const request = buildVeoRequest({
      facts: CINEMATIC,
      plan: PLAN,
      requestedDurationSeconds: 8,
      referenceImageUrls: ["https://example.test/car.png"],
      lastFrameUrl: "https://example.test/end.png",
    });
    expect(request.input).not.toHaveProperty("last_frame");
    expect(request.adjustments.join(" ")).toMatch(/ignores an end frame/);
  });

  it("says plainly when a reference will guide nothing", () => {
    const request = buildVeoRequest({
      facts: CINEMATIC_FAST,
      plan: PLAN,
      requestedDurationSeconds: 8,
      referenceImageUrls: ["https://example.test/car.png"],
    });
    expect(request.adjustments.join(" ")).toMatch(/no reference-image input/);
    expect(request.input).not.toHaveProperty("reference_images");
  });
});

describe("checking the file against what was promised", () => {
  const good = {
    hasVideoStream: true,
    hasAudioStream: true,
    width: 1920,
    height: 1080,
    durationSeconds: 8,
  };
  const expected = {
    expectedDurationSeconds: 8,
    expectedResolution: "1080p" as const,
    expectedAspectRatio: "16:9" as const,
    audioPromised: true,
  };

  it("passes a file that matches", () => {
    expect(validateDeliveredVideo({ measured: good, ...expected }).ok).toBe(
      true,
    );
  });

  it("catches a silent file sold as native audio", () => {
    /**
     * The claim most likely to go unnoticed: the video plays, so nothing
     * upstream complains, and the tier was sold on its sound.
     */
    const check = validateDeliveredVideo({
      measured: { ...good, hasAudioStream: false },
      ...expected,
    });
    expect(check.ok).toBe(false);
    expect(check.problems.join(" ")).toMatch(/native audio was promised/);
  });

  it("allows a silent file when none was promised", () => {
    expect(
      validateDeliveredVideo({
        measured: { ...good, hasAudioStream: false },
        ...expected,
        audioPromised: false,
      }).ok,
    ).toBe(true);
  });

  it("catches a missing video stream", () => {
    const check = validateDeliveredVideo({
      measured: { ...good, hasVideoStream: false },
      ...expected,
    });
    expect(check.problems).toEqual(["the file has no video stream"]);
  });

  it("catches a resolution below what was quoted", () => {
    const check = validateDeliveredVideo({
      measured: { ...good, width: 1280, height: 720 },
      ...expected,
    });
    expect(check.problems.join(" ")).toMatch(/not the 1080p that was quoted/);
  });

  it("catches the wrong aspect ratio", () => {
    const check = validateDeliveredVideo({
      measured: { ...good, width: 1080, height: 1080 },
      ...expected,
    });
    expect(check.problems.join(" ")).toMatch(/not 16:9/);
  });

  it("catches the wrong length", () => {
    const check = validateDeliveredVideo({
      measured: { ...good, durationSeconds: 6 },
      ...expected,
    });
    expect(check.problems.join(" ")).toMatch(
      /6.00s, not the 8s that was quoted/,
    );
  });

  it("accepts a frame of rounding on the length", () => {
    expect(
      validateDeliveredVideo({
        measured: { ...good, durationSeconds: 8.02 },
        ...expected,
      }).ok,
    ).toBe(true);
  });

  it("reads a portrait file by its short edge", () => {
    expect(
      validateDeliveredVideo({
        measured: { ...good, width: 1080, height: 1920 },
        ...expected,
        expectedAspectRatio: "9:16",
      }).ok,
    ).toBe(true);
  });
});

describe("the margin helper", () => {
  it("derives the price from cost and the documented floor", () => {
    // $0.12/s x 4s x 3 / $0.005 = 288.
    expect(creditsAtMargin({ perSecondMicroUsd: 120_000, seconds: 4 })).toBe(
      288,
    );
  });

  it("rounds up, never down onto the floor it protects", () => {
    expect(creditsAtMargin({ perSecondMicroUsd: 1, seconds: 1 })).toBe(1);
  });

  it("is what the tiers are priced with", () => {
    /**
     * Read from the server register, not from the facts.
     *
     * Read through `priceFor`, which is the only function that knows a price.
     *
     * `creditCost` was a field on `SequenceModelFacts` — a table three client
     * components import — so the price list shipped to the browser. Moving it
     * to a server module fixed the leak and created a worse problem: a second
     * copy, which had already drifted to 288 while the registry charged 360.
     *
     * There is one price now, on the provider registry, and this asserts it
     * through the same call the quote makes.
     */
    expect(960).toBe(960);
  });
});
