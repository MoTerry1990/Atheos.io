import { describe, expect, it } from "vitest";

import { buildAudioPlan } from "@/services/ai/audio-director";
import {
  compileDirectedPrompt,
  CONTINUOUS_CAMERA_WORDING,
  MULTI_SHOT_EXCLUSIONS,
} from "@/services/ai/directed-prompt";
import { generateLabel, quoteSequence } from "@/services/ai/sequence";
import { CINEMATIC_FAST } from "@/services/ai/sequence-models.public";
import {
  describeDelivered,
  detectShotBoundaries,
} from "@/services/ai/veo-adapter";
import { buildDirectorPlan } from "@/services/ai/video-director";

/**
 * The edit, not the orbit.
 *
 * ## What happened
 *
 * The first directed benchmark was instructed with four camera beats and came
 * back as **one unbroken drone orbit with zero cuts** at every detection
 * threshold tried. It was then reported — by me — as "four beats delivered",
 * which conflates *camera positions visited during one move* with *distinct
 * edited shots*. Independent review caught it.
 *
 * The cause was in the prompt, not the model. The compiler opened with "A
 * single continuous 8-second piece with 4 deliberate camera positions". Veo did
 * exactly that. "Camera positions" says where a camera stands; nothing in that
 * sentence asked for an edit, and the one thing it did commit to was
 * *continuous*.
 *
 * These tests hold the fix in place from both ends: the prompt must demand an
 * edit, and the UI must not claim one until a file has been checked.
 */

const CINEMATIC_ES =
  "video cinematográfico del carro rojo en la carretera de la costa, " +
  "desde el cielo, de todos los ángulos, con audio";

const PLAN = buildDirectorPlan({
  prompt: CINEMATIC_ES,
  durationSeconds: 8,
  subject: "a red convertible",
  subjectIdentity: "the same blonde adult woman driving",
  location: "a coastal road beside vivid blue ocean water",
});

const AUDIO = buildAudioPlan({
  prompt: CINEMATIC_ES,
  plan: PLAN,
  providerHasNativeAudio: true,
});

const MULTI = compileDirectedPrompt({
  plan: PLAN,
  durationSeconds: 8,
  audio: AUDIO,
  supportsNegativePrompt: true,
});

/**
 * The shot descriptions alone.
 *
 * The header and the exclusion list *must* contain phrases like "one continuous
 * orbit" — that is how they forbid them. Only the shots themselves have to be
 * free of continuous-move language, so that is what gets scanned.
 */
function shotBody(prompt: string): string {
  const start = prompt.indexOf("SHOT 1");
  const end = prompt.indexOf("- no single continuous camera orbit");
  return prompt.slice(start, end === -1 ? undefined : end);
}

describe("1. a multi-shot prompt demands exactly N separate shots", () => {
  it("asks for an edit, in those words, before describing anything", () => {
    expect(MULTI.prompt).toContain(
      "Create an EDITED cinematic sequence containing exactly 4 separate shots",
    );
  });

  it("scales the demand to the plan rather than hardcoding four", () => {
    const twoBeat = compileDirectedPrompt({
      plan: { ...PLAN, shots: PLAN.shots.slice(0, 2) },
      durationSeconds: 8,
    });
    expect(twoBeat.prompt).toContain("exactly 2 separate shots");
  });
});

describe("2. it demands N-1 hard cuts", () => {
  it("names the count", () => {
    expect(MULTI.prompt).toContain("Use 3 unmistakable hard cuts");
  });

  it("marks every one of them in the body", () => {
    // A count in the header that the body does not deliver is a header nobody
    // has to honour.
    expect(MULTI.prompt.split("HARD CUT.").length - 1).toBe(3);
  });

  it("scales with the shot count", () => {
    const twoBeat = compileDirectedPrompt({
      plan: { ...PLAN, shots: PLAN.shots.slice(0, 2) },
      durationSeconds: 8,
    });
    expect(twoBeat.prompt).toContain("Use 1 unmistakable hard cuts");
    expect(twoBeat.prompt.split("HARD CUT.").length - 1).toBe(1);
  });
});

describe("3. each shot is structurally separated", () => {
  it("gives every shot its own numbered, timed header", () => {
    for (let n = 1; n <= 4; n += 1) {
      expect(MULTI.prompt).toMatch(
        new RegExp(`SHOT ${n} — \\d\\.\\d–\\d\\.\\d seconds`),
      );
    }
  });

  it("alternates shot and cut, in order", () => {
    const order = [...MULTI.prompt.matchAll(/SHOT \d|HARD CUT\./g)].map(
      (match) => match[0],
    );
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

  it("carries the explicit exclusions", () => {
    for (const rule of MULTI_SHOT_EXCLUSIONS) {
      expect(MULTI.prompt, rule).toContain(rule);
    }
  });
});

describe("4. continuous-camera wording cannot appear in multi-shot mode", () => {
  it("is absent from every shot description", () => {
    expect(shotBody(MULTI.prompt)).not.toMatch(CONTINUOUS_CAMERA_WORDING);
  });

  it("appears only where it is being forbidden", () => {
    // The header has to say "do not create one continuous orbit" to rule it
    // out. That is the one place the phrase belongs.
    expect(MULTI.prompt).toContain("Do not create one continuous orbit");
  });

  it("replaces the continuity line that used to contradict the cuts", () => {
    /**
     * The compiler emitted "the camera moves continuously" in its own
     * continuity block while demanding hard cuts three paragraphs above. It was
     * arguing with itself, and the model sided with "continuous".
     */
    expect(MULTI.prompt).toContain("Each shot holds its own camera setup");
    expect(MULTI.prompt).not.toContain("the camera moves continuously");
  });

  it("strips a caller's continuous-move beat text", () => {
    // Beat descriptions come from callers, who can innocently describe an orbit.
    const orbiting = compileDirectedPrompt({
      plan: {
        ...PLAN,
        shots: PLAN.shots.map((shot, index) => ({
          ...shot,
          start: index * 2,
          end: (index + 1) * 2,
          angle: "the drone swings back and around to settle behind the car",
          movement: "",
          framing: "",
        })),
      },
      durationSeconds: 8,
    });
    expect(orbiting.prompt).not.toContain("swings back and around");
    expect(shotBody(orbiting.prompt)).not.toMatch(CONTINUOUS_CAMERA_WORDING);
    // The rest of the description survives — the beat is edited, not blanked.
    expect(orbiting.prompt).toContain("behind the car");
  });

  it("keeps the global continuity requirements intact", () => {
    expect(MULTI.prompt).toMatch(/Throughout the entire video/);
    expect(MULTI.prompt).toMatch(/one vehicle only, never a second copy/);
    expect(MULTI.prompt).toMatch(/one consistent direction/);
    expect(MULTI.prompt).toMatch(/sun in the same place/);
    expect(MULTI.prompt).toMatch(/Wheels rotate/);
  });
});

describe("5. continuous mode remains available and demands no cuts", () => {
  const single = compileDirectedPrompt({
    plan: buildDirectorPlan({
      prompt: "el carro rojo desde el cielo sin cortes",
      durationSeconds: 8,
    }),
    durationSeconds: 8,
  });

  it("asks for one unbroken take", () => {
    /**
     * The wording grew stronger, and the assertion with it.
     *
     * "One unbroken 8-second shot" left the model room to read the beat
     * timeline as a shot list and return a montage — several different images
     * in sequence, which is the opposite failure to the frozen frame and just
     * as wrong for a take that is meant to be continuous. The instruction now
     * names it three ways, and this checks all three rather than the old
     * prefix.
     */
    expect(single.prompt).toContain(
      "One unbroken 8-second single continuous shot",
    );
    expect(single.prompt).toMatch(/No scene cuts/i);
    expect(single.prompt).toMatch(/no montage/i);
  });

  it("contains no edit instruction at all", () => {
    expect(single.prompt).not.toContain("HARD CUT");
    expect(single.prompt).not.toContain("EDITED cinematic sequence");
    expect(single.prompt).not.toContain("SHOT 1");
  });

  it("keeps the continuous-camera line, which is correct here", () => {
    expect(single.prompt).toContain("the camera moves continuously");
  });

  it("carries none of the multi-shot exclusions", () => {
    for (const rule of MULTI_SHOT_EXCLUSIONS) {
      expect(single.prompt, rule).not.toContain(rule);
    }
  });
});

describe("6. the UI says directed camera movement until shots are verified", () => {
  it("will not name a shot count without a file to check", () => {
    expect(describeDelivered({ beatsInstructed: 4 })).toBe(
      "Directed camera movement (shots not verified)",
    );
  });

  it("labels the button by the instruction, not by a shot count", () => {
    const quote = quoteSequence({
      baseCredits: 288,
      plan: PLAN,
      facts: CINEMATIC_FAST,
      mode: "directed",
    });
    expect(generateLabel(quote)).toMatch(/^Generate directed camera movement/);
    expect(generateLabel(quote)).not.toMatch(/shot/);
  });

  it("calls a single-beat delivery a continuous clip", () => {
    expect(describeDelivered({ beatsInstructed: 1 })).toBe("Continuous clip");
  });
});

describe("7. N-shot sequence appears only after validation confirms it", () => {
  it("names the shot count once the cuts are found", () => {
    const validation = detectShotBoundaries({
      cutTimestamps: [2, 4, 6],
      expectedShots: 4,
      durationSeconds: 8,
    });
    expect(validation.matchesPlan).toBe(true);
    expect(describeDelivered({ beatsInstructed: 4, validation })).toBe(
      "4-shot sequence",
    );
  });

  it("names the actual benchmark result correctly", () => {
    /**
     * The real measurement: zero cuts at every threshold tried, four beats
     * instructed. This is the case that was reported as "four beats delivered".
     */
    const validation = detectShotBoundaries({
      cutTimestamps: [],
      expectedShots: 4,
      durationSeconds: 8,
    });
    expect(validation.cutsDetected).toBe(0);
    expect(validation.shotsDetected).toBe(1);
    expect(validation.matchesPlan).toBe(false);
    expect(validation.note).toMatch(/one continuous camera move/);
    expect(describeDelivered({ beatsInstructed: 4, validation })).toBe(
      "Directed camera movement — one continuous take, no cuts",
    );
  });

  it("reports a shortfall rather than rounding up to the plan", () => {
    const validation = detectShotBoundaries({
      cutTimestamps: [3],
      expectedShots: 4,
      durationSeconds: 8,
    });
    expect(describeDelivered({ beatsInstructed: 4, validation })).toBe(
      "Directed camera movement — 2 shots found, 4 requested",
    );
  });

  it("ignores detections at the file boundaries", () => {
    // A scene score at 0.0 or the final frame is the file starting and ending,
    // not an edit.
    const validation = detectShotBoundaries({
      cutTimestamps: [0, 2, 4, 6, 8],
      expectedShots: 4,
      durationSeconds: 8,
    });
    expect(validation.cutsDetected).toBe(3);
    expect(validation.shotsDetected).toBe(4);
  });

  it("reports where the cuts landed", () => {
    const validation = detectShotBoundaries({
      cutTimestamps: [2.5, 4.9, 7.5],
      expectedShots: 4,
      durationSeconds: 10,
    });
    // The Gemini reference's own cut positions, for comparison.
    expect(validation.note).toContain("2.5s, 4.9s, 7.5s");
  });
});
