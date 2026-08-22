import { describe, expect, it } from "vitest";

import {
  buildDirectorPlan,
  compileShots,
  describePlan,
  readShotStructure,
  VEHICLE_CONTINUITY_PROHIBITIONS,
  type PlannedShot,
  type VideoDirectorPlan,
} from "@/services/ai/video-director";
import {
  buildAudioPlan,
  describeAudioSource,
  readAudioIntent,
  validateAudioTechnical,
} from "@/services/ai/audio-director";
import {
  BENCHMARK_IS_NOT_HD_PLUS,
  CINEMATIC_BENCHMARK,
} from "@/tests/fixtures/cinematic-benchmark";

/**
 * The measured benchmark lives in one place and is read from there.
 *
 * Duplicating the numbers into each test file is how a fixture quietly drifts
 * from the file it describes.
 */
const REFERENCE = {
  width: CINEMATIC_BENCHMARK.video.width,
  height: CINEMATIC_BENCHMARK.video.height,
  frameRate: CINEMATIC_BENCHMARK.video.frameRate,
  frameCount: CINEMATIC_BENCHMARK.video.frameCount,
  videoDurationSeconds: CINEMATIC_BENCHMARK.video.durationSeconds,
  audioDurationSeconds: CINEMATIC_BENCHMARK.audio.durationSeconds,
  sampleRate: CINEMATIC_BENCHMARK.audio.sampleRate,
  channels: CINEMATIC_BENCHMARK.audio.channels,
  shots: CINEMATIC_BENCHMARK.shots.length,
} as const;

const CINEMATIC_ES =
  "haz un video cinematográfico del carro rojo en la carretera de la costa, " +
  "desde el cielo, de todos los ángulos, con el mar al costado y con audio";

function coastalPlan(prompt: string, seconds = 10): VideoDirectorPlan {
  return buildDirectorPlan({
    prompt,
    durationSeconds: seconds,
    subject: "a red convertible",
    subjectIdentity: "the same blonde woman driving",
    location: "a coastal highway beside a blue ocean",
    colorPalette: "vivid Mediterranean blues, natural greens, bright red car",
  });
}

describe("the reference is a direction benchmark, not a resolution one", () => {
  it("is 720p, the resolution Motion 1 already reaches", () => {
    expect(REFERENCE.height).toBe(720);
    // Stated explicitly so nobody later reads the benchmark as a 4K target.
    expect(REFERENCE.width).toBe(1280);
    expect(BENCHMARK_IS_NOT_HD_PLUS).toBe(true);
  });

  it("records the continuity facts that were actually observed", () => {
    // Read off extracted frames, not inferred from the prompt.
    expect(CINEMATIC_BENCHMARK.continuity.oceanSide).toBe("right");
    expect(CINEMATIC_BENCHMARK.continuity.occupants).toBe(2);
    expect(CINEMATIC_BENCHMARK.continuity.sameVehicleThroughout).toBe(true);
  });

  it("keeps its shot list in order and inside the clip", () => {
    const times = CINEMATIC_BENCHMARK.shots.map((s) => s.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times[times.length - 1]).toBeLessThan(
      CINEMATIC_BENCHMARK.video.durationSeconds,
    );
  });

  it("runs 240 frames at 24fps, which is exactly ten seconds", () => {
    expect(REFERENCE.frameCount / REFERENCE.frameRate).toBeCloseTo(10, 3);
  });

  it("carries stereo audio at 48kHz", () => {
    expect(REFERENCE.channels).toBe(2);
    expect(REFERENCE.sampleRate).toBe(48_000);
  });
});

describe("single-shot versus multi-shot intent", () => {
  it("stays continuous when nothing asks for cuts", () => {
    /**
     * The default matters more than the multi-shot path. A cut nobody asked for
     * reads as the model losing track of the scene — the exact artefact users
     * complain about — so cutting has to be requested, not assumed.
     */
    expect(readShotStructure("un carro rojo en la carretera")).toBe(
      "continuous",
    );
  });

  it("reads 'de todos los ángulos' as a multi-angle sequence", () => {
    expect(readShotStructure("el carro de todos los ángulos")).toBe(
      "multi_angle",
    );
  });

  it("reads commercial and cinematic language, in both languages", () => {
    for (const prompt of [
      "un comercial del carro",
      "video publicitario",
      "cinematográfico",
      "a cinematic sequence of the car",
      "commercial for the car",
      "different drone views",
    ]) {
      expect(readShotStructure(prompt), prompt).toBe("multi_angle");
    }
  });

  it("lets an explicit continuous request beat a stylistic one", () => {
    // "cinematic" describes a look; "sin cortes" describes the edit. The
    // specific instruction wins.
    expect(readShotStructure("video cinematográfico sin cortes")).toBe(
      "continuous",
    );
  });

  it("obeys an explicit UI choice over anything parsed", () => {
    expect(readShotStructure(CINEMATIC_ES, "continuous")).toBe("continuous");
    expect(readShotStructure("un carro rojo", "multi_angle")).toBe(
      "multi_angle",
    );
  });
});

describe("the shot plan reproduces the benchmark's structure", () => {
  const plan = coastalPlan(CINEMATIC_ES);

  it("plans four shots for a cinematic multi-angle request", () => {
    expect(plan.structure).toBe("multi_angle");
    expect(plan.shots).toHaveLength(REFERENCE.shots);
  });

  it("opens behind and above, and closes wide", () => {
    // The shape that makes the reference feel finished: the last shot answers
    // the first by showing the same place whole.
    expect(plan.shots[0].angle).toMatch(/rear/);
    expect(plan.shots[0].framing).toMatch(/entire vehicle/);
    expect(plan.shots[3].movement).toMatch(/pullback/);
    expect(plan.shots[3].framing).toMatch(/small within the landscape/);
  });

  it("includes a near-vertical overhead shot", () => {
    expect(plan.shots.some((s) => /top-down/.test(s.angle))).toBe(true);
  });

  it("covers the full duration with no gaps or overlaps", () => {
    let cursor = 0;
    for (const shot of plan.shots) {
      expect(shot.start).toBeCloseTo(cursor, 2);
      expect(shot.end).toBeGreaterThan(shot.start);
      cursor = shot.end;
    }
    // The last shot absorbs rounding so the plan lands exactly on the request.
    expect(cursor).toBe(10);
  });

  it("rescales to a shorter piece rather than truncating it", () => {
    /**
     * A 6s cut is the same film at a different length, not the first two shots
     * and an abrupt stop — which is what fixed second boundaries would produce.
     */
    const short = coastalPlan(CINEMATIC_ES, 6);
    expect(short.shots).toHaveLength(4);
    expect(short.shots[short.shots.length - 1].end).toBe(6);
  });

  it("gives a continuous request exactly one shot spanning the whole piece", () => {
    const continuous = coastalPlan("el carro rojo desde el cielo sin cortes");
    expect(continuous.shots).toHaveLength(1);
    expect(continuous.shots[0].start).toBe(0);
    expect(continuous.shots[0].end).toBe(10);
    // And it keeps the camera the user actually asked for.
    expect(continuous.shots[0].camera).toBe("drone");
  });
});

describe("continuity is a contract, not a wish", () => {
  const plan = coastalPlan(CINEMATIC_ES);

  it("carries identity for subject, driver and place", () => {
    expect(plan.continuity.subject).toMatch(/red convertible/);
    expect(plan.continuity.subjectIdentity).toMatch(/blonde woman/);
    expect(plan.continuity.location).toMatch(/coastal/);
  });

  it("anchors the ocean to one side for the whole piece", () => {
    // The failure the benchmark names explicitly, and the one a multi-shot plan
    // makes most likely: each cut is a chance to mirror the world.
    expect(plan.continuity.spatialAnchors.join(" ")).toMatch(
      /ocean remains on the same side/,
    );
  });

  it("prohibits every named vehicle-continuity failure", () => {
    for (const prohibition of VEHICLE_CONTINUITY_PROHIBITIONS) {
      expect(plan.continuity.prohibited, prohibition).toContain(prohibition);
    }
  });

  it("prohibits the interior camera and the teleporting camera", () => {
    expect(plan.continuity.prohibited).toContain("interior camera appearing");
    expect(plan.continuity.prohibited).toContain("camera teleporting");
  });
});

describe("one colour plan for the whole piece", () => {
  const plan = coastalPlan(CINEMATIC_ES);

  it("fixes the sun direction across shots", () => {
    // Shadows disagreeing between shots is the tell that says "four clips".
    expect(plan.color.sunDirection).toMatch(/consistent across every shot/);
  });

  it("refuses the grades that ruin this kind of footage", () => {
    for (const avoided of [
      "heavy teal and orange grading",
      "blown sky highlights",
      "colour changes between shots",
      "flickering exposure",
      "waxy skin",
      "artificial oversharpening",
    ]) {
      expect(plan.color.avoid, avoided).toContain(avoided);
    }
  });
});

describe("audio is planned, and its origin is never misstated", () => {
  const plan = coastalPlan(CINEMATIC_ES);

  it("reads 'con audio' as a request for sound", () => {
    expect(readAudioIntent("con audio").wantsAudio).toBe(true);
    expect(readAudioIntent("with sound").wantsAudio).toBe(true);
  });

  it("adds no music unless music was asked for", () => {
    /**
     * A stock cinematic bed under a drone shot is the single most common way
     * generated video announces itself. The benchmark has none.
     */
    const audio = buildAudioPlan({
      prompt: CINEMATIC_ES,
      plan,
      providerHasNativeAudio: false,
    });
    expect(audio.layers.some((l) => l.kind === "music")).toBe(false);
  });

  it("adds an original bed when music is requested, never an imitation", () => {
    const audio = buildAudioPlan({
      prompt: "el carro con música",
      plan,
      providerHasNativeAudio: false,
    });
    const music = audio.layers.find((l) => l.kind === "music");
    expect(music?.description).toMatch(/original/);
    expect(music?.description).toMatch(/no artist imitation/);
  });

  it("builds the environmental layers the scene actually has", () => {
    const audio = buildAudioPlan({
      prompt: CINEMATIC_ES,
      plan,
      providerHasNativeAudio: false,
    });
    const kinds = audio.layers.map((l) => l.kind);
    expect(kinds).toContain("engine");
    expect(kinds).toContain("foley");
    expect(kinds).toContain("ambience");
  });

  it("moves perspective with the camera", () => {
    // Sound that ignores the picture is worse than silence: an engine that does
    // not recede when the camera pulls back tells the viewer it is wallpaper.
    const audio = buildAudioPlan({
      prompt: CINEMATIC_ES,
      plan,
      providerHasNativeAudio: false,
    });
    expect(audio.perspectiveByShot).toHaveLength(plan.shots.length);
    expect(audio.perspectiveByShot[3].note).toMatch(/wind and surf forward/);
  });

  it("calls an Atheos soundscape what it is", () => {
    /**
     * The distinction that must survive to the UI. Presenting audio we
     * assembled as the model's own output is a plain lie about how the video
     * was made — and the models Atheos ships produce none at all.
     */
    const audio = buildAudioPlan({
      prompt: CINEMATIC_ES,
      plan,
      providerHasNativeAudio: false,
    });
    expect(audio.source).toBe("atheos_soundscape");
    expect(audio.notes.join(" ")).toMatch(/not provider audio/);
    expect(describeAudioSource(audio.source)).toMatch(
      /Soundscape added by Atheos/,
    );
    expect(describeAudioSource(audio.source)).not.toBe("Audio generated");
  });

  it("calls native audio native only when it really is", () => {
    const audio = buildAudioPlan({
      prompt: CINEMATIC_ES,
      plan,
      providerHasNativeAudio: true,
    });
    expect(audio.source).toBe("native");
    expect(describeAudioSource("native")).toMatch(/by the video model/);
  });

  it("is silent by intent when nothing asked for sound", () => {
    const audio = buildAudioPlan({
      prompt: "un carro rojo en la carretera",
      plan,
      providerHasNativeAudio: false,
    });
    expect(audio.source).toBe("muted");
    expect(audio.layers).toHaveLength(0);
  });

  it("matches the plan's duration", () => {
    const audio = buildAudioPlan({
      prompt: CINEMATIC_ES,
      plan,
      providerHasNativeAudio: false,
    });
    expect(audio.durationSeconds).toBe(plan.durationSeconds);
    expect(audio.sampleRate).toBe(48_000);
    expect(audio.channels).toBe(2);
  });
});

describe("audio is validated, not assumed", () => {
  const good = {
    hasStream: true,
    sampleRate: 48_000,
    channels: 2,
    durationSeconds: REFERENCE.audioDurationSeconds,
    videoDurationSeconds: REFERENCE.videoDurationSeconds,
    peakDb: -1.2,
    meanDb: -21,
    longestSilenceSeconds: 0.2,
  };

  it("passes the reference file's own measurements", () => {
    /**
     * The benchmark's audio runs 10.005s against a 10.000s picture. Demanding
     * exact equality would fail a file that is demonstrably fine, which is why
     * the tolerance is 50ms rather than zero.
     */
    expect(validateAudioTechnical(good).ok).toBe(true);
  });

  it("fails a missing stream rather than calling it quiet", () => {
    const report = validateAudioTechnical({ ...good, hasStream: false });
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toMatch(/no audio stream/);
  });

  it("catches audio drifting out of sync with the picture", () => {
    const report = validateAudioTechnical({ ...good, durationSeconds: 9.2 });
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/out from the video/);
  });

  it("catches clipping", () => {
    const report = validateAudioTechnical({ ...good, peakDb: 0 });
    expect(report.problems.join(" ")).toMatch(/clipping/);
  });

  it("catches a silent track that technically exists", () => {
    // "There is an audio stream" is not "the video has sound".
    const report = validateAudioTechnical({ ...good, meanDb: -90 });
    expect(report.problems.join(" ")).toMatch(/effectively silent/);
  });

  it("catches an unexplained gap", () => {
    const report = validateAudioTechnical({
      ...good,
      longestSilenceSeconds: 4,
    });
    expect(report.problems.join(" ")).toMatch(/unexplained silence/);
  });

  it("catches mono and the wrong sample rate", () => {
    const report = validateAudioTechnical({
      ...good,
      channels: 1,
      sampleRate: 44_100,
    });
    expect(report.problems.join(" ")).toMatch(/expected stereo/);
    expect(report.problems.join(" ")).toMatch(/expected 48000/);
  });
});

describe("compiling a plan onto a provider that cannot do it", () => {
  const plan = coastalPlan(CINEMATIC_ES);
  const render = (shot: PlannedShot) => `${shot.angle}, ${shot.movement}`;

  const singleClipProvider = {
    supportsMultiShot: false,
    supportsNegativePrompt: false,
    supportsNativeAudio: false,
    maxDurationSeconds: 7.5,
  };

  it("says plainly that a four-shot plan cannot be generated in one request", () => {
    /**
     * The honest finding of this whole sprint. Neither model Atheos ships
     * returns a shot list — they return one continuous clip. Delivering four
     * shots means four generations and four times the cost, which is a decision
     * with a price attached rather than something to do quietly.
     */
    const compiled = compileShots(plan, singleClipProvider, render);
    expect(compiled.collapsed).toBe(true);
    expect(compiled.clips).toHaveLength(1);
    expect(compiled.unsupported.join(" ")).toMatch(/one continuous clip/);
  });

  it("keeps the establishing shot when it has to collapse", () => {
    // The shot that carries the location, and the one a viewer forgives least
    // when it is missing.
    const compiled = compileShots(plan, singleClipProvider, render);
    expect(compiled.clips[0].shot.angle).toMatch(/rear/);
  });

  it("clamps the collapsed shot to the provider's own ceiling", () => {
    const compiled = compileShots(plan, singleClipProvider, render);
    expect(compiled.clips[0].shot.end).toBeLessThanOrEqual(7.5);
  });

  it("reports that continuity prohibitions never reach the model", () => {
    const compiled = compileShots(plan, singleClipProvider, render);
    expect(compiled.unsupported.join(" ")).toMatch(
      /prohibitions are not sent to the provider/,
    );
  });

  it("reports that audio must be produced separately", () => {
    const compiled = compileShots(plan, singleClipProvider, render);
    expect(compiled.unsupported.join(" ")).toMatch(/no native audio/);
  });

  it("emits every shot on a provider that can take them", () => {
    const compiled = compileShots(
      plan,
      {
        supportsMultiShot: true,
        supportsNegativePrompt: true,
        supportsNativeAudio: true,
        maxDurationSeconds: 10,
      },
      render,
    );
    expect(compiled.collapsed).toBe(false);
    expect(compiled.clips).toHaveLength(4);
    expect(compiled.unsupported).toHaveLength(0);
  });

  it("does not collapse a continuous plan, which already fits", () => {
    const continuous = coastalPlan("el carro desde el cielo sin cortes", 5);
    const compiled = compileShots(continuous, singleClipProvider, render);
    expect(compiled.collapsed).toBe(false);
  });
});

describe("the pre-generation summary", () => {
  it("states duration, shot count and the sequence", () => {
    const plan = coastalPlan(CINEMATIC_ES);
    const summary = describePlan(plan, "Environmental audio");
    expect(summary).toMatch(/10 seconds · 4 shots/);
    expect(summary).toMatch(/→/);
    expect(summary).toMatch(/Environmental audio/);
  });

  it("says one shot rather than 1 shots", () => {
    const plan = coastalPlan("el carro sin cortes", 5);
    expect(describePlan(plan, "No audio")).toMatch(/5 seconds · 1 shot\n/);
  });
});
