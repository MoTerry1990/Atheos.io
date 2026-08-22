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
  describeOutput,
  judgeAssessment,
  qualityOptionsFor,
  type VideoAssessment,
} from "@/services/ai/video-quality";
import { VIDEO_CAPABILITIES } from "@/services/ai/video-capabilities";

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
  const good: VideoAssessment = {
    promptAdherence: 0.93,
    cameraCompliance: 0.97,
    motionAccuracy: 0.92,
    subjectConsistency: 0.95,
    temporalStability: 0.91,
    colorConsistency: 0.94,
    artifactRisk: 0.05,
    mandatoryConstraintsPassed: true,
    failedConstraints: [],
  };

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
