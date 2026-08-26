import { describe, expect, it } from "vitest";

import { compileForModel } from "@/services/ai/compile-for-model";
import { MODEL_CAPABILITIES } from "@/services/ai/brief-routing";
import {
  confirmField,
  explicit,
  type CreativeBrief,
} from "@/services/ai/creative-brief";
import { planFromPrompt } from "@/services/ai/intent-planner";

/**
 * The audio clause the native-audio models actually receive.
 *
 * `audio-inference.test.ts` covers what a scene *should* sound like in
 * isolation. This covers the thing that matters commercially: what ends up in
 * the compiled prompt once the user's own words are taken into account.
 *
 * The distinction is where the bug was. Inference is only ever allowed to fill
 * a vacuum, and the first version let the commercial archetype add music to a
 * prompt whose author had written "no music" — the archetype fired, the user
 * declined, and the archetype won. Provenance decides it now, and these pin
 * that down from the compiler's side rather than the lexicon's.
 */

const MODEL = Object.fromEntries(MODEL_CAPABILITIES.map((m) => [m.id, m]));
const CINEMATIC = MODEL["replicate/veo-3.1"]!;

/** A fully confirmed brief, so nothing is left blocking compilation. */
function briefFor(prompt: string): CreativeBrief {
  let brief = planFromPrompt({ prompt, referenceImageCount: 1 });
  brief = confirmField(brief, "resolution" as never, "720p" as never);

  for (const field of brief.required) {
    const current = brief[field] as unknown as { value: unknown };
    brief = confirmField(brief, field, current.value as never);
  }
  return brief;
}

const compile = (brief: CreativeBrief) => compileForModel(brief, CINEMATIC);

describe("inference fills a vacuum", () => {
  it("describes the scene's own sound when the prompt says nothing", () => {
    const brief = briefFor(
      "an 8 second shot of a sports car on a coastal road",
    );
    const { prompt } = compile(brief);

    expect(prompt).toMatch(/Audio:/);
    expect(prompt).toMatch(/engine/i);
  });

  it("always forbids speech when the user did not ask for it", () => {
    /**
     * The clause that stops Veo narrating somebody's advert. It is emitted
     * whatever the scene is, because speech is never inferred.
     */
    for (const scene of [
      "a sports car on a coastal road",
      "a commercial for a watch",
      "a dragon over a castle",
    ]) {
      const { prompt } = compile(briefFor(`an 8 second shot of ${scene}`));
      expect(prompt, scene).toMatch(/No speech, dialogue or narration/);
    }
  });
});

describe("the user always outranks inference", () => {
  it("adds music to a product commercial", () => {
    // The one archetype allowed to score itself: a product film with no music
    // reads as unfinished rather than restrained.
    const brief = briefFor("an 8 second commercial for a pair of headphones");
    const { prompt } = compile(brief);

    expect(prompt).toMatch(/sound design/i);
    expect(prompt).not.toMatch(/No music/);
    // And still no narration, because that was never asked for.
    expect(prompt).toMatch(/No speech, dialogue or narration/);
  });

  it("obeys an explicit refusal of music, even on a commercial", () => {
    /**
     * The regression this file exists for. Both things are true at once: the
     * commercial archetype fires, and the author said no. The author wins.
     */
    let brief = briefFor("an 8 second commercial for a pair of headphones");
    brief = { ...brief, music: explicit(false, "the user asked for no music") };

    const { prompt } = compile(brief);
    expect(prompt).toMatch(/No music/);
  });

  it("keeps music when the user explicitly asks for it on a plain scene", () => {
    // The mirror case, so the rule is "the user decides", not "no music".
    let brief = briefFor("an 8 second shot of waves on a rocky shore");
    brief = { ...brief, music: explicit(true, "the user asked for music") };

    const { prompt } = compile(brief);
    expect(prompt).not.toMatch(/No music/);
  });

  it("leaves an ordinary scene unscored", () => {
    const brief = briefFor("an 8 second shot of waves on a rocky shore");
    expect(compile(brief).prompt).toMatch(/No music/);
  });

  it("preserves dialogue the user wrote", () => {
    /**
     * Never inventing speech and never *removing* it are different promises,
     * and both matter. A user who wrote dialogue must not have the no-speech
     * rule appended over the top of it.
     */
    let brief = briefFor("an 8 second shot of two people in a kitchen");
    brief = { ...brief, dialogue: explicit(true, "the user wrote dialogue") };

    const { prompt } = compile(brief);
    expect(prompt).not.toMatch(/No speech, dialogue or narration/);
  });
});

describe("silence is not negotiable", () => {
  it("emits no audio clause at all for a silent brief", () => {
    /**
     * Explicit silence is handled before inference is ever consulted: the
     * strategy stops being NATIVE, so the whole block is skipped. Asserted
     * here because "no audio direction" and "audio direction saying nothing"
     * are very different instructions to a model that defaults to sound.
     */
    let brief = briefFor("an 8 second commercial for a pair of headphones");
    brief = {
      ...brief,
      audioStrategy: explicit("SILENT" as never, "the user asked for silence"),
    };

    const { prompt, parameters } = compile(brief);

    expect(prompt).not.toMatch(/Audio:/);
    expect(parameters.generate_audio).toBe(false);
  });
});

describe("nothing here reaches for a blocked model", () => {
  it("names no vendor or model in the compiled audio clause", () => {
    /**
     * The audio clause is prompt text for the video model already running. It
     * must never read as an instruction to call Score, which is blocked
     * outright, and must not name a vendor.
     */
    const { prompt } = compile(
      briefFor("an 8 second commercial for a watch by the sea"),
    );

    expect(prompt).not.toMatch(/musicgen|replicate|veo|bytedance|foley/i);
  });
});
