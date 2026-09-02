import { describe, expect, it } from "vitest";

import {
  hasObservableMotion,
  inferSceneMotion,
  NON_MOTION_WORDS,
} from "@/services/ai/motion-inference";
import { compileDirectedPrompt } from "@/services/ai/directed-prompt";
import { planFromPrompt } from "@/services/ai/intent-planner";

/**
 * "A surfer on a wave" must not come back as a photograph.
 *
 * ## The failure being tested
 *
 * The brief described where the camera stood, what was in frame and how it was
 * lit. The subject's *action* was a noun phrase — "surfing a wave" — which a
 * beautifully lit still satisfies completely. Every negative constraint in the
 * compiler was about the camera, so the prompt argued about lens work while
 * the surfer stood still.
 *
 * ## Why the assertions are about events, not adjectives
 *
 * The tempting fix is to append "cinematic, dynamic, realistic movement".
 * Those are style words: a model that already renders photorealistically will
 * render a photorealistic statue. So nothing below accepts them as evidence,
 * and one test asserts that directly.
 */

const SURFER = "a surfer on a wave";

describe("the surfer prompt acquires movement it did not state", () => {
  const motion = inferSceneMotion(SURFER);

  it("recognises the scene rather than falling back to the generic clause", () => {
    expect(motion.archetype).toBe("surf");
  });

  it("moves the board across frame", () => {
    // Displacement, not "surfing". A viewer must be able to point at it.
    expect(motion.subject).toMatch(/board visibly displaces across frame/i);
    expect(motion.subject).toMatch(/travels along the wave face/i);
  });

  it("changes the body, not just the position", () => {
    expect(motion.subject).toMatch(/rises to their feet/i);
    expect(motion.subject).toMatch(/body lowers and re-balances/i);
  });

  it("breaks the wave and produces spray and foam", () => {
    expect(motion.environment).toMatch(/\bbreaks\b/i);
    expect(motion.environment).toMatch(/spray/i);
    expect(motion.environment).toMatch(/foam/i);
  });

  it("keeps the background alive", () => {
    expect(motion.environment).toMatch(/constant motion|horizon shifts/i);
  });

  it("resolves the action rather than ending mid-pose", () => {
    expect(motion.subject).toMatch(/resolves as they carve out/i);
  });
});

describe("a compiled video prompt describes movement across the whole clip", () => {
  /**
   * The end-to-end shape: a bare prompt goes in, and what comes out has to
   * satisfy the motion guard. Built through the real planner and the real
   * compiler rather than by hand, so a change to either is caught here.
   */
  const brief = planFromPrompt({ prompt: SURFER });

  it("resolves both motion fields before anything is quoted", () => {
    expect(brief.subjectMotion?.value).toBeTruthy();
    expect(brief.environmentMotion?.value).toBeTruthy();
  });

  it("marks them as inferred, so the panel can offer them for editing", () => {
    // Never `explicit`. The user did not ask for spray; they must be able to
    // see what was added and change it.
    expect(brief.subjectMotion?.from).toBe("inferred");
    expect(brief.environmentMotion?.from).toBe("inferred");
  });

  it("preserves the original prompt untouched", () => {
    expect(brief.originalPrompt).toBe(SURFER);
  });
});

describe("style words are not evidence of movement", () => {
  it("rejects a prompt that is cinematic and static", () => {
    const verdict = hasObservableMotion(
      "A cinematic, dynamic, stunning shot of a surfer on a wave. " +
        "Beautiful lighting, realistic movement, epic composition.",
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/describes a look/i);
    // It found the style words and refused to count them.
    expect(verdict.styleWordsIgnored.length).toBeGreaterThan(2);
  });

  it("names every word it refuses to count", () => {
    // A denylist nobody can see is a denylist nobody maintains.
    for (const word of ["cinematic", "dynamic", "realistic movement"]) {
      expect(NON_MOTION_WORDS).toContain(word);
    }
  });

  it("is not satisfied by a single verb bolted onto a still description", () => {
    /**
     * One verb is met by "a cinematic shot of a surfer moving", which is the
     * exact sentence this module exists to reject. Three forces a beginning, a
     * middle and an end.
     */
    const verdict = hasObservableMotion(
      "A surfer on a wave, moving. Golden hour, wide lens.",
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.verbs.length).toBeLessThan(3);
  });

  it("accepts the inferred clause, which describes ordered events", () => {
    const motion = inferSceneMotion(SURFER);
    const verdict = hasObservableMotion(
      `${motion.subject}. ${motion.environment}.`,
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.verbs.length).toBeGreaterThanOrEqual(3);
    // And it earned that without a single style word.
    expect(verdict.styleWordsIgnored).toEqual([]);
  });
});

describe("audio for the beach scene is the sea, and nothing else", () => {
  it("asks for waves, foam and wind without music or narration", async () => {
    const { inferSceneAudio } = await import("@/services/ai/audio-inference");
    const audio = inferSceneAudio(SURFER);

    expect(JSON.stringify(audio)).toMatch(/wave|surf|water/i);
    // The two things that must never be added because a scene sounded
    // cinematic: a soundtrack and a voice nobody asked for.
    expect(audio.music).toBe(false);
    expect(JSON.stringify(audio)).not.toMatch(/narrat|voiceover|dialogue/i);
  });
});

describe("older briefs still render", () => {
  it("compiles when the motion fields are absent entirely", () => {
    /**
     * Backward compatibility, asserted rather than assumed. Briefs written
     * before these fields existed are read back to render history and to reuse
     * settings; a compiler that threw on their absence would break every one
     * of them.
     */
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
      // No `motion` at all — the old shape.
    });

    expect(compiled.prompt).toBeTruthy();
    expect(compiled.prompt).not.toMatch(/MOVEMENT —/);
  });

  it("adds the movement block when motion is supplied", () => {
    const motion = inferSceneMotion(SURFER);
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
          movement: "tracking laterally with the surfer",
          framing: "full body",
        },
      ],
    };

    const compiled = compileDirectedPrompt({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plan: plan as any,
      durationSeconds: 5,
      motion: { subject: motion.subject, environment: motion.environment },
    });

    // Tied to the clip length, not floating free.
    expect(compiled.prompt).toMatch(/whole 5 seconds/);
    expect(compiled.prompt).toMatch(
      /From 0\.0s the subject is already in motion/,
    );
    expect(compiled.prompt).toMatch(/by 5\.0s it has ended up somewhere/);
    expect(compiled.prompt).toMatch(/No frozen pose/);
    // The camera follows: it is in the shot description, not invented here.
    expect(compiled.prompt).toMatch(/tracking laterally with the surfer/);

    expect(hasObservableMotion(compiled.prompt).ok).toBe(true);
  });
});

describe("the user's own decision about movement wins", () => {
  it("adds nothing when a static shot is asked for", async () => {
    /**
     * The correction that matters most in this module. Inferring movement is
     * right for a prompt that describes a scene and says nothing about whether
     * it moves. It is wrong for one that asks for stillness — a director who
     * requests a locked-off frame and is overruled has been ignored, and has
     * paid for the wrong clip.
     */
    for (const prompt of [
      "a static shot of a surfer on a wave",
      "a surfer on a wave, locked-off camera",
      "a surfer, tripod shot, the camera does not move",
      "a still frame of a surfer",
    ]) {
      const motion = inferSceneMotion(prompt);

      expect(motion.intent, prompt).toBe("explicit_static");
      // Not a quieter clause — none at all, so nothing in the compiled prompt
      // argues with the held frame.
      expect(motion.subject, prompt).toBe("");
      expect(motion.environment, prompt).toBe("");
      expect(motion.archetype, prompt).toBe("static");
    }
  });

  it("omits the fields from the brief entirely for a static request", async () => {
    const brief = planFromPrompt({
      prompt: "a static shot of a surfer on a wave",
    });

    // An empty string marked `inferred` would still read as "we decided there
    // is no motion". Absent fields plus the intent say the user decided.
    expect(brief.motionIntent).toBe("explicit_static");
    expect(brief.subjectMotion).toBeUndefined();
    expect(brief.environmentMotion).toBeUndefined();
  });

  it("marks motion explicit when the user asked for it themselves", async () => {
    const brief = planFromPrompt({
      prompt: "a fast-paced tracking shot of a surfer on a wave",
    });

    expect(brief.motionIntent).toBe("explicit_dynamic");
    expect(brief.subjectMotion?.from).toBe("explicit");
    expect(brief.environmentMotion?.from).toBe("explicit");
  });

  it("infers only when nothing was said", async () => {
    const brief = planFromPrompt({ prompt: "a surfer on a wave" });

    expect(brief.motionIntent).toBe("inferred");
    expect(brief.subjectMotion?.from).toBe("inferred");
  });
});

describe("a single take is asked for as a single take", () => {
  it("names 'single continuous shot' and forbids cuts", () => {
    /**
     * The opposite failure to the frozen frame, and just as wrong: a model
     * handed a beat timeline reads it as a shot list and returns a montage —
     * several different images in sequence rather than one take.
     */
    const motion = inferSceneMotion(SURFER);
    const plan = {
      durationSeconds: 10,
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
          end: 10,
          angle: "wide",
          movement: "tracking laterally with the surfer",
          framing: "full body",
        },
      ],
    };

    const compiled = compileDirectedPrompt({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plan: plan as any,
      durationSeconds: 10,
      motion: { subject: motion.subject, environment: motion.environment },
    });

    expect(compiled.prompt).toMatch(/single continuous shot/i);
    expect(compiled.prompt).toMatch(/No scene cuts/i);
    expect(compiled.prompt).toMatch(/no montage/i);

    // And the movement still spans the full ten seconds.
    expect(compiled.prompt).toMatch(/whole 10 seconds/);
    expect(compiled.prompt).toMatch(/by 10\.0s it has ended up somewhere/);
    expect(hasObservableMotion(compiled.prompt).ok).toBe(true);
  });
});

describe("the surfer benchmark, on the complete compiled prompt", () => {
  /**
   * Built through the real planner and the real compiler, then asserted
   * against the **whole** output string rather than a summary of it.
   *
   * Searching for the word "motion" would pass on "cinematic motion blur".
   * Every claim below names a physical event: the board displacing, the body
   * re-balancing, the wave breaking. That is what a viewer can point at, and
   * it is the only thing that separates a clip from an animated photograph.
   */
  const brief = planFromPrompt({ prompt: SURFER });

  const plan = {
    durationSeconds: 10,
    aspectRatio: "16:9",
    visualStyle: "photorealistic",
    structure: "single" as const,
    continuity: {
      subject: "a surfer",
      subjectIdentity: "the same surfer throughout",
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
        end: 10,
        angle: "wide",
        movement: "tracking laterally alongside the surfer",
        framing: "full body",
      },
    ],
  };

  const compiled = compileDirectedPrompt({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plan: plan as any,
    durationSeconds: 10,
    motion: {
      subject: brief.subjectMotion!.value,
      environment: brief.environmentMotion!.value,
    },
    originalPrompt: SURFER,
    dialogueRequested: false,
  });

  it("carries both motion fields into the prompt", () => {
    expect(brief.subjectMotion?.value).toBeTruthy();
    expect(brief.environmentMotion?.value).toBeTruthy();
    expect(compiled.prompt).toContain(brief.subjectMotion!.value);
    expect(compiled.prompt).toContain(brief.environmentMotion!.value);
  });

  it("spreads the movement across the clip rather than one moment", () => {
    // Start, middle and end, each tied to the clip length.
    expect(compiled.prompt).toMatch(/whole 10 seconds, not in one moment/);
    expect(compiled.prompt).toMatch(
      /From 0\.0s the subject is already in motion/,
    );
    expect(compiled.prompt).toMatch(/Across the take .* changes continuously/);
    expect(compiled.prompt).toMatch(
      /by 10\.0s it has ended up somewhere it was not/,
    );
  });

  it("moves the board and changes the body", () => {
    expect(compiled.prompt).toMatch(/board visibly displaces across frame/);
    expect(compiled.prompt).toMatch(/rises to their feet/);
    expect(compiled.prompt).toMatch(/body lowers and re-balances/);
  });

  it("breaks the wave and throws spray and foam", () => {
    expect(compiled.prompt).toMatch(/wave advances and breaks/);
    expect(compiled.prompt).toMatch(/spray/);
    expect(compiled.prompt).toMatch(/foam/);
  });

  it("keeps the camera with the surfer", () => {
    expect(compiled.prompt).toMatch(/tracking laterally alongside the surfer/);
  });

  it("asks for one take, by name, and forbids cuts", () => {
    expect(compiled.prompt).toMatch(/single continuous shot/i);
    expect(compiled.prompt).toMatch(/No scene cuts/i);
    expect(compiled.prompt).toMatch(/no montage/i);
  });

  it("forbids the frozen frame explicitly", () => {
    expect(compiled.prompt).toMatch(/No frozen pose/);
    expect(compiled.prompt).toMatch(/animated photograph/);
  });

  it("passes the motion guard on the whole string", () => {
    const verdict = hasObservableMotion(compiled.prompt);

    expect(verdict.ok).toBe(true);
    expect(verdict.verbs.length).toBeGreaterThanOrEqual(3);
  });

  it("adds no narration and no music", () => {
    expect(brief.music.value).toBe(false);
    expect(brief.dialogue.value).toBe(false);
    expect(compiled.prompt).not.toMatch(
      /narrat|voice[- ]?over|soundtrack|music/i,
    );
    expect(compiled.includesAudioDirection).toBe(false);
  });
});

describe("the surfer's sound is the sea", () => {
  it("asks for waves and wind at an audible level", async () => {
    const { inferSceneAudio } = await import("@/services/ai/audio-inference");
    const audio = inferSceneAudio(SURFER);

    expect(audio.sound).toMatch(/breaking waves/i);
    expect(audio.sound).toMatch(/foam/i);
    expect(audio.sound).toMatch(/wind/i);
    // Foreground, not a background wash — the defect this wording corrected.
    expect(audio.sound).toMatch(/clearly audible/i);
    expect(audio.music).toBe(false);
  });
});

describe("a Spanish prompt keeps its dialogue and gets English direction", () => {
  const ES = 'un surfista en una ola, y dice "el mar está bravo hoy"';

  it("compiles the direction in English and quotes the line in Spanish", () => {
    const plan = {
      durationSeconds: 8,
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
          end: 8,
          angle: "wide",
          movement: "tracking",
          framing: "full body",
        },
      ],
    };

    const compiled = compileDirectedPrompt({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plan: plan as any,
      durationSeconds: 8,
      originalPrompt: ES,
      dialogueRequested: true,
    });

    // The instruction is English, where the model's behaviour is documented.
    expect(compiled.prompt).toMatch(
      /reproduce exactly as written, in Spanish/i,
    );
    expect(compiled.prompt).toMatch(/Do not translate, paraphrase/i);
    // The customer's words are untouched.
    expect(compiled.prompt).toContain('"el mar está bravo hoy"');
    // And names are protected because the prompt is not English.
    expect(compiled.prompt).toMatch(
      /proper nouns, brand names and visible on-screen text/i,
    );
  });

  it("adds no dialogue clause when none was requested", () => {
    const brief = planFromPrompt({ prompt: "un surfista en una ola grande" });

    expect(brief.dialogue.value).toBe(false);
    expect(brief.originalPrompt).toBe("un surfista en una ola grande");
  });
});
