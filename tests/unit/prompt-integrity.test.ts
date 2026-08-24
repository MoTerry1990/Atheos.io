import { describe, expect, it } from "vitest";

import { compileForModel } from "@/services/ai/compile-for-model";
import { MODEL_CAPABILITIES } from "@/services/ai/brief-routing";
import { confirmField } from "@/services/ai/creative-brief";
import { planFromPrompt } from "@/services/ai/intent-planner";

/**
 * The prompt the model is actually sent must describe what the user asked for.
 *
 * ## The bug this exists to prevent recurring
 *
 * Found live, against a real deployment, one step before a paid call. This
 * prompt:
 *
 *     "A single slow push-in on a cup of coffee steaming on a windowsill at
 *      dawn."
 *
 * compiled to:
 *
 *     "natural daylight One continuous shot, no cuts."
 *
 * The subject was gone. `sceneLine()` composed only from the brief's structured
 * fields, and `planFromPrompt` fills almost none of them — `primarySubject`
 * comes back empty, its own reason string admitting "not identified without a
 * planner call". Every field being empty left the derived lighting default as
 * the entire description.
 *
 * Nothing failed. The generation would have succeeded, cost full price, and
 * returned a grey clip — which is worse than an error, because an error is
 * visible. That is why these assertions are about *content* rather than shape.
 */

const MOTION_1 = MODEL_CAPABILITIES.find(
  (m) => m.id === "replicate/video-gen",
)!;

/**
 * A brief Motion 1 can actually make.
 *
 * The planner's defaults — eight seconds, 1080p, sound — are all beyond what
 * Motion 1 offers, and `compileForModel` refuses an incompatible brief before it
 * compiles anything. These three confirmations are the same ones a user makes in
 * the studio; they are fixture setup, not the thing under test.
 */
function brief(prompt: string) {
  let b = planFromPrompt({ prompt });
  b = confirmField(b, "durationSeconds" as never, 5 as never);
  b = confirmField(b, "resolution" as never, "720p" as never);
  b = confirmField(b, "audioStrategy" as never, "SILENT" as never);
  return b;
}

describe("the user's subject survives compilation", () => {
  const CASES = [
    {
      prompt:
        "A single slow push-in on a cup of coffee steaming on a windowsill at dawn.",
      mustContain: ["coffee", "windowsill"],
    },
    {
      prompt: "A red dragon perched on a castle, breathing fire",
      mustContain: ["dragon", "castle"],
    },
    { prompt: "Waves breaking on black volcanic sand", mustContain: ["waves"] },
  ];

  for (const { prompt, mustContain } of CASES) {
    it(`keeps "${mustContain[0]}" in the compiled prompt`, () => {
      const compiled = compileForModel(brief(prompt), MOTION_1);
      for (const word of mustContain) {
        expect(compiled.prompt.toLowerCase()).toContain(word);
      }
    });
  }

  it("compiles to more than the boilerplate", () => {
    /**
     * The exact failure, pinned. Every one of these fragments is something the
     * compiler adds itself; a prompt made only of them describes nothing.
     */
    const compiled = compileForModel(
      brief("A cup of coffee steaming on a windowsill at dawn."),
      MOTION_1,
    );

    const boilerplate = compiled.prompt
      .replace(/natural daylight/gi, "")
      .replace(/One continuous shot, no cuts\./gi, "")
      .trim();

    expect(boilerplate.length).toBeGreaterThan(20);
  });

  it("never sends a prompt that is only the lighting default", () => {
    const compiled = compileForModel(brief("A lighthouse in fog"), MOTION_1);
    expect(compiled.prompt.trim()).not.toBe("natural daylight");
    expect(compiled.prompt).not.toMatch(/^natural daylight One continuous/i);
  });
});

describe("the fallback does not double what is already there", () => {
  it("drops a derived detail the prompt already states", () => {
    // "natural daylight" appended to a prompt that says "natural daylight"
    // is how a compiled prompt starts repeating itself.
    const compiled = compileForModel(
      brief("A field in natural daylight, wind moving the grass"),
      MOTION_1,
    );
    expect(compiled.prompt.match(/natural daylight/gi)?.length).toBe(1);
  });

  it("does not produce a doubled full stop", () => {
    const compiled = compileForModel(
      brief("A cup of coffee on a windowsill at dawn."),
      MOTION_1,
    );
    expect(compiled.prompt).not.toMatch(/\.\./);
  });

  it("leaves no stray comma-space-comma from an empty field", () => {
    // The `,,` the studio was showing came from joining empty values.
    const compiled = compileForModel(brief("A quiet street"), MOTION_1);
    expect(compiled.prompt).not.toMatch(/,\s*,/);
  });
});

describe("structured fields still win when the planner fills them", () => {
  it("prefers the composed line once a subject is identified", () => {
    /**
     * The fallback is for the planner's silence, not a replacement for it. When
     * `primarySubject` is populated the structured composition is the better
     * prompt and must be what ships — otherwise finishing the planner would
     * quietly change nothing.
     */
    let b = brief("coffee at dawn");
    b = confirmField(
      b,
      "primarySubject" as never,
      "a porcelain cup of black coffee" as never,
    );

    const compiled = compileForModel(b, MOTION_1);
    expect(compiled.prompt).toContain("a porcelain cup of black coffee");
    // The raw prompt is no longer needed as a floor, so it is not pasted in too.
    expect(compiled.prompt).not.toContain("coffee at dawn");
  });
});
