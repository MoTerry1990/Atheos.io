import { describe, expect, it } from "vitest";

import { AUDIO_CAPABILITIES } from "@/services/ai/audio-strategy";
import { planFromPrompt } from "@/services/ai/intent-planner";
import { compileDirectedPrompt } from "@/services/ai/directed-prompt";
import type { CreativeBrief } from "@/services/ai/creative-brief";

/**
 * Nothing that worked yesterday stopped working.
 *
 * ## What this sprint added, and to what
 *
 * Three fields that did not exist before: `durationMode` and `audioAlwaysOn`
 * on the public model DTO, and `subjectMotion` / `environmentMotion` /
 * `motionIntent` on the creative brief. All five are read back by surfaces
 * that render *stored* records — history, "reuse these settings", the plan
 * panel — and those records were written before any of them existed.
 *
 * A field that is merely optional in a type is not proof of that. These
 * exercise the actual functions against actual old shapes.
 *
 * ## And the capability table, which is where a mistake would be quiet
 *
 * One new model was added with an unusual combination — always-on audio, no
 * duration enum. The risk is not that it is wrong; it is that some *other*
 * model picks the combination up by sharing a default. The last block asserts
 * every existing model still declares exactly what it declared before.
 */

describe("a brief written before the motion fields still works", () => {
  /** Exactly the shape `planFromPrompt` produced last month. */
  const legacyBrief = {
    version: 1,
    originalPrompt: "a surfer on a wave",
    objective: { value: "cinematic", from: "fallback", why: "" },
    primarySubject: { value: "a surfer", from: "fallback", why: "" },
    subjectIdentity: { value: [], from: "fallback", why: "" },
    environment: { value: "an ocean wave", from: "fallback", why: "" },
    action: { value: "surfing", from: "fallback", why: "" },
    visualStyle: { value: "photorealistic", from: "fallback", why: "" },
    realism: { value: "photorealistic", from: "fallback", why: "" },
    colorAndLighting: { value: "golden hour", from: "fallback", why: "" },
    durationSeconds: { value: 5, from: "explicit", why: "" },
    aspectRatio: { value: "16:9", from: "fallback", why: "" },
    resolution: { value: "720p", from: "fallback", why: "" },
    shotCount: { value: 1, from: "fallback", why: "" },
    shots: { value: [], from: "fallback", why: "" },
    cutStyle: { value: "single", from: "fallback", why: "" },
    continuityRules: { value: [], from: "fallback", why: "" },
    audioStrategy: { value: "SILENT", from: "fallback", why: "" },
    environmentalSound: { value: "", from: "fallback", why: "" },
    subjectSound: { value: "", from: "fallback", why: "" },
    music: { value: false, from: "fallback", why: "" },
    dialogue: { value: false, from: "fallback", why: "" },
    commercialCopy: { value: [], from: "fallback", why: "" },
    logoOverlay: { value: false, from: "fallback", why: "" },
    negativeConstraints: { value: [], from: "fallback", why: "" },
    references: {
      value: { count: 0, use: "style_only" },
      from: "fallback",
      why: "",
    },
    required: [],
    overallConfidence: 0.6,
    // No subjectMotion. No environmentMotion. No motionIntent.
  } as unknown as CreativeBrief;

  it("has none of the three new fields, which is the point", () => {
    expect(legacyBrief.subjectMotion).toBeUndefined();
    expect(legacyBrief.environmentMotion).toBeUndefined();
    expect(legacyBrief.motionIntent).toBeUndefined();
  });

  it("is readable without throwing", () => {
    // The surfaces that render history reach for these directly.
    expect(() => legacyBrief.subjectMotion?.value).not.toThrow();
    expect(legacyBrief.originalPrompt).toBe("a surfer on a wave");
  });

  it("compiles with no MOVEMENT block rather than a broken one", () => {
    const plan = {
      durationSeconds: 5,
      aspectRatio: "16:9",
      visualStyle: "photorealistic",
      structure: "single" as const,
      continuity: {
        subject: "a surfer",
        subjectIdentity: "the same surfer",
        location: "an ocean wave",
        timeOfDay: "golden hour",
        colorPalette: "warm",
        spatialAnchors: [],
      },
      color: { palette: "warm", grade: "natural" },
      shots: [
        {
          index: 0,
          start: 0,
          end: 5,
          angle: "wide",
          movement: "tracking",
          framing: "full body",
        },
      ],
    };

    const compiled = compileDirectedPrompt({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plan: plan as any,
      durationSeconds: 5,
      // No `motion` — the old call shape.
    });

    expect(compiled.prompt).toBeTruthy();
    expect(compiled.prompt).not.toMatch(/MOVEMENT —/);
    // The old generation is not rewritten, only re-rendered.
    expect(compiled.beats).toHaveLength(1);
  });
});

describe("a new brief resolves the fields, and an image brief needs none", () => {
  it("fills both for a new video prompt", () => {
    const brief = planFromPrompt({ prompt: "a surfer on a wave" });

    expect(brief.subjectMotion?.value).toBeTruthy();
    expect(brief.environmentMotion?.value).toBeTruthy();
    expect(brief.motionIntent).toBe("inferred");
  });

  it("leaves them absent when the user asked for stillness", () => {
    const brief = planFromPrompt({ prompt: "a static shot of a surfer" });

    expect(brief.motionIntent).toBe("explicit_static");
    expect(brief.subjectMotion).toBeUndefined();
  });
});

describe("the audio table still says what it said", () => {
  /**
   * Asserted model by model, exhaustively.
   *
   * The failure this guards is not a wrong entry — it is a *shared* one. One
   * model was added with an unusual pair of properties, and the way that goes
   * wrong is another model quietly acquiring them.
   */
  const expected: Record<
    string,
    { strategies: string[]; alwaysOn: boolean; label: string }
  > = {
    "replicate/video-gen": {
      strategies: ["ATHEOS_SOUND_DESIGN", "SILENT"],
      alwaysOn: false,
      label: "Motion 1",
    },
    "replicate/video-pro": {
      strategies: ["ATHEOS_SOUND_DESIGN", "SILENT"],
      alwaysOn: false,
      label: "Motion Pro",
    },
    "replicate/veo-3.1-fast": {
      strategies: ["NATIVE", "SILENT"],
      alwaysOn: false,
      label: "Cinematic Fast",
    },
    "replicate/veo-3.1": {
      strategies: ["NATIVE", "SILENT"],
      alwaysOn: false,
      label: "Cinematic",
    },
    "google/omni-1.1-flash": {
      strategies: ["NATIVE"],
      alwaysOn: true,
      label: "Cinematic Next",
    },
  };

  it("keeps Motion 1 and Motion Pro silent", () => {
    for (const id of ["replicate/video-gen", "replicate/video-pro"]) {
      const entry = AUDIO_CAPABILITIES[id]!;
      expect(entry.strategies, id).not.toContain("NATIVE");
      expect(entry.audioAlwaysOn, id).toBeFalsy();
    }
  });

  it("keeps Cinematic Fast and Cinematic on native audio, switchable", () => {
    for (const id of ["replicate/veo-3.1-fast", "replicate/veo-3.1"]) {
      const entry = AUDIO_CAPABILITIES[id]!;
      expect(entry.strategies, id).toContain("NATIVE");
      // They can still be asked for silence — that is what makes them the
      // alternative offered when Cinematic Next refuses.
      expect(entry.strategies, id).toContain("SILENT");
      expect(entry.audioAlwaysOn, id).toBeFalsy();
    }
  });

  it("marks Cinematic Next native and always on, alone", () => {
    const entry = AUDIO_CAPABILITIES["google/omni-1.1-flash"]!;

    expect(entry.strategies).toEqual(["NATIVE"]);
    expect(entry.audioAlwaysOn).toBe(true);

    // And it is the only one. A second always-on model is a decision, not an
    // accident, and it should have to change this line.
    const alwaysOn = Object.entries(AUDIO_CAPABILITIES)
      .filter(([, value]) => value.audioAlwaysOn)
      .map(([id]) => id);
    expect(alwaysOn).toEqual(["google/omni-1.1-flash"]);
  });

  it("matches the recorded expectation for every entry, exactly", () => {
    for (const [id, want] of Object.entries(expected)) {
      const entry = AUDIO_CAPABILITIES[id];
      expect(entry, id).toBeDefined();
      expect([...entry!.strategies], id).toEqual(want.strategies);
      expect(Boolean(entry!.audioAlwaysOn), id).toBe(want.alwaysOn);
      expect(entry!.label, id).toBe(want.label);
    }
  });
});
