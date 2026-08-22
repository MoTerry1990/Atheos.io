import { describe, expect, it } from "vitest";

import {
  AERIAL_VIOLATIONS,
  buildVideoPrompt,
  readCameraIntent,
  readMotionIntent,
  renderPrompt,
  withCameraDefaults,
} from "@/services/ai/prompt-intelligence";
import { chooseVideoModel } from "@/services/ai/video-routing";
import {
  DEFAULT_THRESHOLDS,
  assessmentFrom,
  describeOutput,
  judgeAssessment,
  qualityOptionsFor,
  type VideoAssessment,
} from "@/services/ai/video-quality";
import { VIDEO_CAPABILITIES } from "@/services/ai/video-capabilities";
import { PRESERVE_ALL, renderImageToVideo } from "@/services/ai/image-to-video";

/**
 * The permanent video benchmark suite.
 *
 * ## Nothing here spends money
 *
 * Every case is prompt construction, routing and scoring — the parts that can
 * be checked without a provider. Assessments are fixtures standing in for
 * measurements a future scorer will produce, so the *gates* are testable today
 * even though the measurement is not implemented.
 *
 * That boundary is deliberate and worth stating: this suite proves the request
 * we send is the request that was asked for, and that a bad result would be
 * rejected. It proves nothing about what the models actually return. Only a
 * paid comparison can do that, and it needs approval first.
 *
 * ## The red car is the reference case
 *
 * "un carro rojo desde el cielo siguiendo la carretera con el mar al costado" —
 * the prompt that produced a bumper-cam shot instead of an aerial one. Every
 * failure condition from that report is asserted below.
 */

const RED_CAR_ES =
  "un carro rojo convertible corriendo por la carretera desde el cielo, " +
  "siguiendo el carro, con el mar al costado y que se vea el cielo";

const RED_CAR_EN =
  "a red convertible driving along the coastal road, aerial drone shot " +
  "following the car, ocean beside the road, sky visible";

const RED_CAR_MIXED =
  "aerial drone shot de un carro rojo corriendo por la carretera, ocean al costado";

function redCarPrompt(text: string) {
  return buildVideoPrompt({
    prompt: text,
    scene: {
      subject: "a red convertible with a blonde woman driving",
      environment: "a coastal road beside a bright blue ocean",
      lighting: "natural sunlight with hard shadows",
      colorPalette: "cyan-blue sky, white clouds, red car",
      composition: "wide cinematic composition, whole car visible",
      style: "photorealistic",
      negative: ["cropped vehicle", "extra passengers"],
    },
    durationSeconds: 8,
    frameRateTarget: 24,
    extraConstraints: [
      "same red car in every frame",
      "same blonde driver in every frame",
    ],
  });
}

describe("benchmark: aerial car tracking — camera intent", () => {
  it("reads 'desde el cielo' as an elevated aerial drone camera", () => {
    const read = readCameraIntent(RED_CAR_ES);
    expect(read.explicit).toBe(true);
    expect(read.camera.platform).toBe("drone");
    expect(read.camera.height).toBe("high aerial");
  });

  it("reads 'siguiendo el carro' as a tracking shot", () => {
    expect(readCameraIntent(RED_CAR_ES).camera.motion).toBe(
      "smooth parallel tracking shot",
    );
  });

  it("reads 'que se vea el cielo' as oblique, never straight down", () => {
    /**
     * A perfectly vertical top-down view has no horizon, so the sky cannot be
     * in it. The cue exists because "aerial" alone tends to produce exactly
     * that, and then the user's other instruction is silently impossible.
     */
    const read = readCameraIntent(RED_CAR_ES);
    expect(read.camera.angle).toMatch(/oblique/);
    expect(read.forbids).toContain("perfectly vertical top-down view");
  });

  it("preserves the road/ocean relationship across the shot", () => {
    const motion = readMotionIntent(RED_CAR_ES);
    expect(motion.direction).toBe("forward along the coastal road");
    expect(motion.constraints).toContain(
      "ocean remains on the same side of the road in every frame",
    );
  });

  it("reads English and mixed Spanish/English identically", () => {
    for (const text of [RED_CAR_EN, RED_CAR_MIXED]) {
      const read = readCameraIntent(text);
      expect(read.camera.platform, text).toBe("drone");
      expect(read.camera.height, text).toBe("high aerial");
    }
  });
});

describe("benchmark: aerial car tracking — failure conditions", () => {
  const prompt = redCarPrompt(RED_CAR_ES);
  const rendered = renderPrompt(prompt);

  it("never reinterprets aerial as a camera on or in the car", () => {
    // The exact wrong answers from the report, every one pushed into the
    // negative set rather than left to the model's priors.
    for (const violation of AERIAL_VIOLATIONS) {
      expect(prompt.temporal.negativeMotion, violation).toContain(violation);
    }
  });

  it("forbids cuts, close-ups and shake", () => {
    for (const banned of [
      "scene cuts",
      "sudden close-up",
      "camera shake",
      "speed warping",
    ]) {
      expect(prompt.temporal.negativeMotion, banned).toContain(banned);
    }
  });

  it("forbids the flicker and drift failures", () => {
    for (const banned of [
      "flickering",
      "frame-to-frame color shifts",
      "morphing shapes",
    ]) {
      expect(prompt.temporal.negativeMotion, banned).toContain(banned);
    }
  });

  it("requires identity to hold for both car and driver", () => {
    expect(prompt.temporal.constraints).toContain(
      "same red car in every frame",
    );
    expect(prompt.temporal.constraints).toContain(
      "same blonde driver in every frame",
    );
  });

  it("keeps the camera aerial for the whole shot", () => {
    expect(prompt.temporal.constraints).toContain(
      "camera remains aerial throughout",
    );
  });

  it("puts the camera at the front of the rendered prompt", () => {
    /**
     * Order is the mechanism, not decoration. Diffusion models weight the head
     * of a caption most heavily, so the instruction most likely to be discarded
     * goes first. A camera clause buried after the scenery is one the model
     * will trade away for a prettier composition.
     */
    const head = rendered.text.slice(0, 90);
    expect(head).toMatch(/drone/);
    expect(head).toMatch(/aerial/);
    // Scene detail must not have displaced it.
    expect(head).not.toMatch(/photorealistic/);
  });

  it("sends negatives separately from the prompt text", () => {
    // A model with a negative_prompt input should receive them there. Only a
    // model without one gets them appended — wan-2.2 has no negative input.
    expect(rendered.negative).toMatch(/camera entering the vehicle/);
    expect(rendered.text).not.toMatch(/camera entering the vehicle/);
  });

  it("de-duplicates negatives arriving from two sources", () => {
    const parts = rendered.negative.split(", ");
    expect(new Set(parts).size).toBe(parts.length);
  });
});

describe("explicit camera beats every default", () => {
  it("keeps a stated aerial camera when defaults would say eye level", () => {
    const read = readCameraIntent(RED_CAR_ES);
    const final = withCameraDefaults(read.camera);
    expect(final.height).toBe("high aerial");
    expect(final.platform).toBe("drone");
  });

  it("fills only the gaps the user left", () => {
    // "primer plano" states a shot size and nothing else; the rest defaults.
    const read = readCameraIntent("primer plano de un gato");
    const final = withCameraDefaults(read.camera);
    expect(final.shotSize).toBe("close-up");
    expect(final.height).toBe("eye level");
  });

  it("lets an explicit studio control outrank a parsed cue", () => {
    // A control the user actually moved is the strongest signal there is.
    const prompt = buildVideoPrompt({
      prompt: RED_CAR_ES,
      scene: {
        subject: "a red convertible",
        environment: "coastal road",
        lighting: "sunlight",
        colorPalette: "blue and red",
        composition: "wide",
        style: "photorealistic",
      },
      durationSeconds: 5,
      frameRateTarget: 24,
      cameraOverride: { motion: "static camera" },
    });
    expect(prompt.camera.motion).toBe("static camera");
    // The aerial cue survives — the override touched only what it named.
    expect(prompt.camera.platform).toBe("drone");
  });

  it("ignores a blank override rather than erasing a cue", () => {
    const prompt = buildVideoPrompt({
      prompt: RED_CAR_ES,
      scene: {
        subject: "car",
        environment: "road",
        lighting: "sun",
        colorPalette: "red",
        composition: "wide",
        style: "photoreal",
      },
      durationSeconds: 5,
      frameRateTarget: 24,
      cameraOverride: { platform: "", height: "" },
    });
    expect(prompt.camera.platform).toBe("drone");
    expect(prompt.camera.height).toBe("high aerial");
  });
});

describe("model routing is evidence-based and never silently dearer", () => {
  it("refuses a text-only model when an input image is required", () => {
    const decision = chooseVideoModel({ needsImageInput: true });
    expect(
      decision.rejected.some((r) => r.model === "replicate/video-gen"),
    ).toBe(true);
    expect(decision.chosen?.model.id).toBe("replicate/video-pro");
  });

  it("says so when the only suitable model costs more", () => {
    const decision = chooseVideoModel({ needsImageInput: true });
    // Motion Pro is dearer than Motion 1; the caller must be told before spend.
    expect(decision.reason).toMatch(/costs more|cheapest/);
    if (decision.costsMore) expect(decision.reason).toMatch(/confirm/i);
  });

  it("prefers the cheaper model when both qualify", () => {
    const decision = chooseVideoModel({ durationSeconds: 5 });
    expect(decision.chosen).not.toBeNull();
    const chosenCost = decision.chosen!.costMicroUsd ?? Infinity;
    for (const candidate of decision.considered) {
      if (candidate.model.id === decision.chosen!.model.id) continue;
      // Either it is dearer, or it won on capability and said so.
      if ((candidate.costMicroUsd ?? Infinity) < chosenCost) {
        expect(decision.costsMore).toBe(true);
      }
    }
  });

  it("refuses native audio, because no shipped model has it", () => {
    /**
     * Sprint 5D read both schemas: neither wan-2.2 nor seedance-1-lite has any
     * audio input. Veo 3 does and is not enabled. Routing must fail rather than
     * pick something and hope.
     */
    const decision = chooseVideoModel({ needsNativeAudio: true });
    expect(decision.chosen).toBeNull();
    expect(decision.reason).toMatch(/No available model/);
  });

  it("rejects a duration past the model's ceiling", () => {
    const decision = chooseVideoModel({ durationSeconds: 30 });
    expect(decision.chosen).toBeNull();
  });

  it("never routes to a model that is not enabled", () => {
    const decision = chooseVideoModel({});
    for (const candidate of decision.considered) {
      expect(candidate.model.available, candidate.model.id).toBe(true);
    }
  });
});

describe("resolution labelling stays honest", () => {
  const motion1 = VIDEO_CAPABILITIES.find(
    (m) => m.id === "replicate/video-gen",
  )!;
  const motionPro = VIDEO_CAPABILITIES.find(
    (m) => m.id === "replicate/video-pro",
  )!;

  it("never claims native 1080p on a model that caps at 720p", () => {
    /**
     * Motion 1 is wan-2.2-t2v-fast: its schema offers 480p and 720p only.
     * Sprint 4.4 already had to retract a "4K" claim on an encoded 1080p
     * asset, and the temptation recurs whenever a marketing number is one
     * string away.
     */
    const output = describeOutput(motion1, "pro");
    expect(output.nativeResolution).toBe("720p");
    expect(output.label).not.toBe("native 1080p");
  });

  it("labels an upscale as an upscale, naming the native resolution", () => {
    const output = describeOutput(motion1, "pro");
    if (output.upscaled) {
      expect(output.label).toMatch(/upscaled from native 720p/);
      expect(output.exportResolution).toBe("1080p");
    }
  });

  it("says 'native' only when the provider really generated it", () => {
    const output = describeOutput(motionPro, "pro");
    expect(output.nativeResolution).toBe("1080p");
    expect(output.upscaled).toBe(false);
    expect(output.label).toBe("native 1080p");
  });

  it("clamps duration to what the model actually offers", () => {
    // Motion 1 caps at 7.5s; asking for 8 must not advertise 8.
    expect(
      describeOutput(motion1, "pro", 8).durationSeconds,
    ).toBeLessThanOrEqual(7.5);
  });

  it("offers every mode with its real output for each model", () => {
    for (const model of VIDEO_CAPABILITIES.filter((m) => m.available)) {
      const options = qualityOptionsFor(model.id);
      expect(options, model.id).toHaveLength(3);
      for (const option of options) {
        expect(model.resolutions).toContain(option.output.nativeResolution);
      }
    }
  });

  it("does not enhance a draft", () => {
    // Spending money to make a preview pretty defeats the preview.
    expect(describeOutput(motion1, "draft").upscaled).toBe(false);
  });
});

describe("quality assessment gates a result", () => {
  // `assessmentFrom` fills the dimensions no scorer measures yet, so a test
  // states only what it is actually about.
  const good: VideoAssessment = assessmentFrom({
    promptAdherence: 0.93,
    cameraCompliance: 0.97,
    motionAccuracy: 0.92,
    subjectConsistency: 0.95,
    temporalStability: 0.91,
    colorConsistency: 0.94,
    artifactRisk: 0.05,
  });

  it("passes a result that clears every threshold", () => {
    expect(judgeAssessment(good).passed).toBe(true);
  });

  it("fails a broken mandatory constraint whatever the scores", () => {
    /**
     * "Beautiful, but the camera went inside the car" is not a partial
     * success. The mandatory gate short-circuits before any score is read.
     */
    const verdict = judgeAssessment({
      ...good,
      promptAdherence: 0.99,
      cameraCompliance: 0.99,
      mandatoryConstraintsPassed: false,
      failedConstraints: ["camera remains aerial throughout"],
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.failures).toContain("camera remains aerial throughout");
  });

  it("holds camera compliance to the highest bar", () => {
    // Camera is what users state most explicitly and models discard most
    // readily, so it is scored hardest.
    expect(DEFAULT_THRESHOLDS.cameraCompliance).toBeGreaterThan(
      DEFAULT_THRESHOLDS.promptAdherence,
    );
    expect(judgeAssessment({ ...good, cameraCompliance: 0.88 }).passed).toBe(
      false,
    );
  });

  it("fails on artefacts even when everything else is strong", () => {
    const verdict = judgeAssessment({ ...good, artifactRisk: 0.4 });
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.join(" ")).toMatch(/artifactRisk/);
  });

  it("names every failure rather than the first", () => {
    const verdict = judgeAssessment({
      ...good,
      temporalStability: 0.2,
      colorConsistency: 0.3,
    });
    expect(verdict.failures).toHaveLength(2);
  });
});

describe("the rest of the benchmark matrix", () => {
  /**
   * Each case states the camera and motion it expects. They run against the
   * prompt builder rather than a provider, so they cost nothing and still catch
   * the regression that matters: a cue quietly ceasing to be understood.
   */
  const CASES: {
    name: string;
    prompt: string;
    expect: { platform?: string; shotSize?: string; motion?: string };
  }[] = [
    {
      name: "walking person",
      prompt: "una persona caminando por la calle, plano general",
      expect: { shotSize: "extreme wide shot" },
    },
    {
      name: "character close-up",
      prompt: "primer plano de una mujer sonriendo",
      expect: { shotSize: "close-up" },
    },
    {
      name: "product rotation",
      prompt: "product shot rotating, static camera",
      expect: { motion: "static camera" },
    },
    {
      name: "ocean landscape",
      prompt: "aerial drone shot over the ocean at sunset",
      expect: { platform: "drone" },
    },
    {
      name: "fast action",
      prompt: "carro corriendo rapido, siguiendo el carro",
      expect: { motion: "smooth parallel tracking shot" },
    },
  ];

  for (const testCase of CASES) {
    it(`reads the camera for: ${testCase.name}`, () => {
      const camera = withCameraDefaults(
        readCameraIntent(testCase.prompt).camera,
      );
      for (const [key, value] of Object.entries(testCase.expect)) {
        expect(camera[key as keyof typeof camera], testCase.name).toBe(value);
      }
    });
  }

  it("leaves a prompt with no camera cue on safe defaults", () => {
    const read = readCameraIntent("a bowl of fruit");
    expect(read.explicit).toBe(false);
    const camera = withCameraDefaults(read.camera);
    expect(camera.motion).toBe("static camera");
  });
});

describe("routing follows measured adherence, not headline capability", () => {
  /**
   * Sprint 6C, one generation per model at 5s on identical prompt text:
   *
   *   Motion 1  (wan-2.2)   correct elevated tracking drone shot, whole car
   *                         visible, ocean held on one side throughout
   *   Motion Pro (seedance) camera at car level beside the hood, car cropped —
   *                         the exact benchmark failure, at three times the cost
   *
   * Capability had ranked them the other way round. This pins the correction.
   */
  it("prefers the model that actually produced an aerial shot", () => {
    const decision = chooseVideoModel({
      aerialTracking: true,
      durationSeconds: 5,
    });
    expect(decision.chosen?.model.id).toBe("replicate/video-gen");
  });

  it("keeps that preference cheaper, not dearer", () => {
    // The measured winner is also the less expensive model, so this correction
    // reduces spend rather than raising it.
    const decision = chooseVideoModel({
      aerialTracking: true,
      durationSeconds: 5,
    });
    expect(decision.costsMore).toBe(false);
  });

  it("never lets the preference override a hard requirement", () => {
    // An aerial shot that must start from a supplied frame still has to go to
    // the model that accepts one — Motion 1 has no image input at all.
    const decision = chooseVideoModel({
      aerialTracking: true,
      needsImageInput: true,
    });
    expect(decision.chosen?.model.id).toBe("replicate/video-pro");
  });
});

describe("the assessment covers every dimension the spec names", () => {
  const complete = assessmentFrom({});

  it("scores all sixteen dimensions", () => {
    for (const field of [
      "promptAdherence",
      "cameraCompliance",
      "subjectPresence",
      "motionAccuracy",
      "motionDirection",
      "subjectConsistency",
      "objectConsistency",
      "temporalStability",
      "temporalFlicker",
      "colorConsistency",
      "sceneStability",
      "firstToLastDrift",
      "motionSmoothness",
      "anatomy",
      "physics",
      "exposure",
    ]) {
      expect(complete, field).toHaveProperty(field);
    }
    expect(complete).toHaveProperty("compressionArtifacts");
    expect(complete).toHaveProperty("resolutionMatchesClaim");
  });

  it("fails a clip whose resolution does not match its label", () => {
    /**
     * Not tradeable against picture quality. Selling 720p as 1080p is a
     * different kind of wrong from a soft shot, and Sprint 4.4 already had to
     * retract one such claim.
     */
    const verdict = judgeAssessment(
      assessmentFrom({ resolutionMatchesClaim: false }),
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.join(" ")).toMatch(/advertised resolution/);
  });

  it("fails bad anatomy even when the shot is otherwise perfect", () => {
    // A wrong hand is what a viewer notices first, so it is scored high.
    expect(judgeAssessment(assessmentFrom({ anatomy: 0.5 })).passed).toBe(
      false,
    );
  });

  it("fails first-to-last drift, the slow failure", () => {
    expect(
      judgeAssessment(assessmentFrom({ firstToLastDrift: 0.4 })).passed,
    ).toBe(false);
  });

  it("passes a clip that is good on every axis", () => {
    expect(judgeAssessment(assessmentFrom({})).passed).toBe(true);
  });
});

describe("image-to-video preserves the picture it was given", () => {
  const seedance = {
    startFrame: true,
    endFrame: true,
    cameraControl: true,
    negativePrompt: false,
  };

  const request = {
    sourceImageUrl: "https://example.test/frame.png",
    preserve: PRESERVE_ALL,
    motion: {
      cameraLocked: true,
      cameraMotion: "",
      subjectMotion: "the car drives forward",
      motionStrength: "moderate" as const,
      durationSeconds: 5,
      aspectRatio: "16:9",
      qualityMode: "quality" as const,
    },
    prompt: "anima esta foto",
  };

  it("asks for identity, vehicle, landscape and light to hold", () => {
    const out = renderImageToVideo(request, seedance);
    expect(out.prompt).toMatch(/identical person/);
    expect(out.prompt).toMatch(/identical vehicle/);
    expect(out.prompt).toMatch(/identical landscape/);
    expect(out.prompt).toMatch(/identical lighting/);
  });

  it("leads with the motion, not the prohibitions", () => {
    // A caption that opens with a list of things not to do produces a still
    // frame — the opposite failure, but a failure.
    const out = renderImageToVideo(request, seedance);
    expect(out.prompt.indexOf("the car drives forward")).toBe(0);
  });

  it("names the specific drift each control guards against", () => {
    const out = renderImageToVideo(request, seedance);
    for (const drift of [
      "extra passengers appearing",
      "vehicle shape changes",
      "wheel deformation",
      "road deformation",
      "frame-to-frame color shifts",
    ]) {
      expect(out.negative, drift).toMatch(drift);
    }
  });

  it("maps camera lock onto the structural input where it exists", () => {
    expect(renderImageToVideo(request, seedance).inputs.cameraFixed).toBe(true);
  });

  it("says plainly what the model cannot honour", () => {
    /**
     * seedance has no negative-prompt input, so every prohibition above is
     * prompt text and nothing more. Reporting that is the difference between a
     * control and the appearance of one.
     */
    const out = renderImageToVideo(request, seedance);
    expect(out.unsupported.join(" ")).toMatch(/no negative prompt/);
  });

  it("reports a missing source-frame input rather than pretending", () => {
    const out = renderImageToVideo(request, {
      ...seedance,
      startFrame: false,
    });
    expect(out.unsupported.join(" ")).toMatch(/cannot take a source frame/);
  });

  it("drops a closing frame the model cannot use", () => {
    const out = renderImageToVideo(
      { ...request, lastFrameImageUrl: "https://example.test/end.png" },
      { ...seedance, endFrame: false },
    );
    expect(out.inputs.lastFrameImage).toBeUndefined();
    expect(out.unsupported.join(" ")).toMatch(/closing frame/);
  });

  it("adds only what was turned on", () => {
    const out = renderImageToVideo(
      { ...request, preserve: { ...PRESERVE_ALL, character: false } },
      seedance,
    );
    expect(out.prompt).not.toMatch(/identical person/);
    expect(out.prompt).toMatch(/identical vehicle/);
  });
});

describe("frame rate is labelled as honestly as resolution", () => {
  const motion1 = VIDEO_CAPABILITIES.find(
    (m) => m.id === "replicate/video-gen",
  )!;
  const motionPro = VIDEO_CAPABILITIES.find(
    (m) => m.id === "replicate/video-pro",
  )!;

  it("names interpolation when the provider interpolates", () => {
    /**
     * Measured in Sprint 6C with ffprobe: Motion 1 delivered 152 frames across
     * 5.07s — 30fps — from a model that renders 81 frames at 16fps with
     * `interpolate_output` defaulting on. Calling that "30fps" unqualified is
     * the same class of claim as calling an upscale "1080p".
     */
    const output = describeOutput(motion1, "quality", 5);
    expect(output.frameRateInterpolated).toBe(true);
    expect(output.frameRateLabel).toBe("30fps interpolated from 16fps");
  });

  it("says nothing extra when the rate is native", () => {
    const output = describeOutput(motionPro, "quality", 5);
    expect(output.frameRateInterpolated).toBe(false);
    expect(output.frameRateLabel).toBe("24fps");
  });

  it("records the measured latency it was timed at", () => {
    // Routing and the pre-generation estimate both need a real number, and a
    // guess would be indistinguishable from one.
    expect(motion1.measuredLatencySeconds).toBeGreaterThan(0);
    expect(motionPro.measuredLatencySeconds).toBeGreaterThan(
      motion1.measuredLatencySeconds!,
    );
  });
});

describe("image-to-video reports prohibitions that never reach the model", () => {
  it("says they are not sent, rather than implying they were", () => {
    /**
     * The red-car clip asked for no extra passengers and returned two
     * occupants. Neither shipped model has a negative-prompt input, and the
     * adapter does not fold negatives into the caption — so the honest report
     * is that the prohibition never left the building.
     */
    const out = renderImageToVideo(
      {
        sourceImageUrl: "https://example.test/a.png",
        preserve: PRESERVE_ALL,
        motion: {
          cameraLocked: false,
          cameraMotion: "slow push in",
          subjectMotion: "the car drives forward",
          motionStrength: "subtle",
          durationSeconds: 5,
          aspectRatio: "16:9",
          qualityMode: "quality",
        },
        prompt: "anima",
      },
      {
        startFrame: true,
        endFrame: true,
        cameraControl: true,
        negativePrompt: false,
      },
    );
    expect(out.unsupported.join(" ")).toMatch(/not sent to the provider/);
    expect(out.unsupported.join(" ")).not.toMatch(/appended/);
  });
});
