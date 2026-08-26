import { describe, expect, it } from "vitest";

import { inferSceneAudio } from "@/services/ai/audio-inference";

/**
 * What Atheos decides a scene should sound like, and what it must never decide.
 *
 * ## Why inference exists
 *
 * A native-audio model handed no audio direction invents its own, and what it
 * invents is usually speech — an unasked-for narrator over somebody's car
 * advert. So the compiler always sends an audio clause, and this fills it in
 * when the prompt says nothing about sound.
 *
 * ## The line these tests police
 *
 * Inference may add *ambience*. It may not add *authorship*. Wind and engine
 * noise are what the scene would make; a music cue and a voiceover are
 * creative decisions belonging to the customer.
 *
 * The dangerous failure is not a missing seagull — it is inference quietly
 * overruling somebody who said no. Every override case below exists because
 * the first draft of this got one of them wrong: a prompt reading "no music"
 * for a product advert had the commercial archetype fire *and* the user
 * decline, and the archetype won.
 */

describe("scene-appropriate ambience", () => {
  it("gives a driving scene engine, tyres and wind", () => {
    const result = inferSceneAudio("a sports car on a mountain road at dusk");

    expect(result.matched).toContain("driving");
    expect(result.sound).toMatch(/engine/i);
    expect(result.sound).toMatch(/tyre/i);
    expect(result.sound).toMatch(/wind/i);
  });

  it("combines archetypes rather than picking one", () => {
    /**
     * "A sports car on a coastal road" is driving *and* ocean. A viewer who
     * hears the engine but no surf notices the absence.
     */
    const result = inferSceneAudio("a sports car on a coastal road by the sea");

    expect(result.matched).toEqual(
      expect.arrayContaining(["driving", "ocean"]),
    );
  });

  it("gives a dragon fire, wings and the place around it", () => {
    const result = inferSceneAudio("a red dragon circling a castle at night");

    expect(result.matched).toContain("creature");
    expect(result.sound).toMatch(/roar|breath/i);
    expect(result.sound).toMatch(/wings/i);
  });

  it("falls back to general ambience rather than guessing", () => {
    /**
     * A wrong specific answer — seagulls in a forest — is worse than a right
     * general one, so an unrecognised scene gets a description of its own
     * environment rather than a borrowed archetype.
     */
    const result = inferSceneAudio("an abstract shape rotating slowly");

    expect(result.matched).toEqual([]);
    expect(result.sound).toMatch(/environmental sound/i);
    expect(result.music).toBe(false);
  });
});

describe("music is not added uninvited", () => {
  it("scores a product commercial, which would read as unfinished silent", () => {
    const result = inferSceneAudio(
      "a 30 second commercial for a new pair of headphones",
    );

    expect(result.matched).toContain("commercial");
    expect(result.music).toBe(true);
    expect(result.sound).toMatch(/sound design/i);
  });

  it("leaves an ordinary ocean scene unscored", () => {
    // The boundary case. Waves are what the place sounds like; a score is a
    // decision the customer did not make.
    const result = inferSceneAudio("waves breaking on a rocky shore at dawn");

    expect(result.matched).toContain("ocean");
    expect(result.music).toBe(false);
  });

  it("does not treat 'cinematic' as a request for music", () => {
    /**
     * "Cinematic" describes the look — lensing, grade, movement. Reading it as
     * "add a score" would put music on most video prompts Atheos receives,
     * because almost everyone writes the word.
     */
    const result = inferSceneAudio("a cinematic shot of a mountain at sunrise");

    expect(result.music).toBe(false);
  });

  it("does not score a nature or city scene", () => {
    for (const prompt of [
      "a slow push through a pine forest",
      "a rainy city street seen from a rooftop",
    ]) {
      expect(inferSceneAudio(prompt).music, prompt).toBe(false);
    }
  });
});

describe("speech is never invented", () => {
  it("returns no dialogue for any archetype", () => {
    /**
     * The single most damaging thing inference could do: put words into a
     * customer's advert. No archetype may describe speech, narration or a
     * voiceover, and this asserts it across the whole table rather than one
     * prompt at a time.
     */
    for (const prompt of [
      "a sports car on a coastal road",
      "a dragon over a castle",
      "a commercial for a coffee machine",
      "a forest in the rain",
      "a city street at night",
      "a cathedral interior",
      "an unrecognised abstract scene",
    ]) {
      const { sound } = inferSceneAudio(prompt);

      expect(sound, prompt).not.toMatch(
        /dialogue|narrat|voice|speech|speaking|says|talks/i,
      );
    }
  });
});

describe("word boundaries, so a match is a real one", () => {
  it("does not match a cue inside a longer word", () => {
    /**
     * "port" inside "portrait" is the bug this shape of lexicon invites, and
     * it has bitten this codebase before in the scene-intent work.
     */
    const result = inferSceneAudio(
      "a portrait of a woman against a plain wall",
    );

    expect(result.matched).not.toContain("ocean");
  });

  it("is case-insensitive", () => {
    expect(inferSceneAudio("A DRAGON over a CASTLE").matched).toContain(
      "creature",
    );
  });
});

describe("it never reaches for a blocked model", () => {
  it("describes sound in words, and names no model or vendor", () => {
    /**
     * Inference produces prompt text for the video model that is already
     * running. It must never read as a reason to call Score — which is
     * blocked outright — or name any vendor.
     */
    for (const prompt of [
      "a commercial for a watch",
      "a dragon over a castle",
      "waves on a beach",
    ]) {
      const { sound } = inferSceneAudio(prompt);

      expect(sound, prompt).not.toMatch(
        /musicgen|score|replicate|veo|foley|meta\b/i,
      );
    }
  });
});
