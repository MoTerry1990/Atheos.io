import { describe, expect, it } from "vitest";

import {
  producesNativeAudio,
  readAudioIntent,
  rejectImpossibleAudio,
  routeAudio,
} from "@/services/ai/audio-routing";

/**
 * Which model runs, and what it will sound like.
 *
 * ## The two failures these encode
 *
 * **Silence nobody asked for.** Motion 1 was the default, Motion 1 cannot
 * produce sound, and a user who never thought about audio got a silent clip.
 *
 * **A silent model quietly becoming an expensive one.** The fix for the first
 * failure must not create the second: recommending a model that costs several
 * times more is a suggestion, never an action.
 */

const MOTION_1 = "replicate/video-gen";
const MOTION_PRO = "replicate/video-pro";
const CINEMATIC_FAST = "replicate/veo-3.1-fast";

const CREDITS: Record<string, number> = {
  [MOTION_1]: 90,
  [MOTION_PRO]: 180,
  [CINEMATIC_FAST]: 360,
};

const route = (over: Partial<Parameters<typeof routeAudio>[0]> = {}) =>
  routeAudio({
    prompt: "a wolf in a forest",
    selectedModelId: MOTION_1,
    creditsFor: (id) => CREDITS[id],
    nativeAudioAvailable: true,
    ...over,
  });

describe("reading the audio instruction", () => {
  it("defaults to AUTO when the user said nothing", () => {
    expect(readAudioIntent("a wolf in a forest").intent).toBe("AUTO");
  });

  for (const phrase of [
    "a wolf in a forest, no audio",
    "a wolf, silent",
    "a wolf without sound",
    "a wolf in a forest, muted",
  ]) {
    it(`reads "${phrase}" as silent`, () => {
      expect(readAudioIntent(phrase).intent).toBe("SILENT");
    });
  }

  it("does not read 'no dialogue' as silence", () => {
    /**
     * The trap. A negation next to the word audio is not a request for
     * silence — this user wants effects and ambience, just nobody talking.
     */
    const read = readAudioIntent("a busy market, no dialogue");

    expect(read.intent).toBe("NATIVE_AUDIO");
    expect(read.reason).toMatch(/effects and ambience/);
  });

  it("does not read 'no music' as silence either", () => {
    const read = readAudioIntent("a forest at dawn, no music");

    expect(read.intent).toBe("NATIVE_AUDIO");
    expect(read.reason).toMatch(/effects and ambience/);
  });

  it("reads an explicit request for sound", () => {
    expect(readAudioIntent("a storm with sound").intent).toBe("NATIVE_AUDIO");
  });
});

describe("who can actually produce sound", () => {
  it("Motion 1 and Motion Pro cannot, and the catalogue says so", () => {
    expect(producesNativeAudio(MOTION_1)).toBe(false);
    expect(producesNativeAudio(MOTION_PRO)).toBe(false);
  });

  it("Cinematic Fast can", () => {
    expect(producesNativeAudio(CINEMATIC_FAST)).toBe(true);
  });
});

describe("AUTO recommends, and asks", () => {
  it("recommends Cinematic Fast when the silent model was selected", () => {
    const result = route();

    expect(result.intent).toBe("AUTO");
    expect(result.recommendedModelId).toBe(CINEMATIC_FAST);
    expect(result.nativeAudio).toBe(true);
    expect(result.switchedFrom).toBe(MOTION_1);
  });

  it("requires confirmation, because it costs four times more", () => {
    /**
     * The commercial rule. Acting on "the user expressed no preference" by
     * spending more of their credits is not a decision to make for them.
     */
    const result = route();

    expect(result.requiresConfirmation).toBe(true);
    expect(result.refusals).toEqual([]);
  });

  it("explains the swap in plain terms", () => {
    expect(route().notes.join(" ")).toMatch(
      /Motion 1 produces no audio.*Cinematic Fast generates synchronised sound/,
    );
  });

  it("does not switch when the selected model already has sound", () => {
    const result = route({ selectedModelId: CINEMATIC_FAST });

    expect(result.recommendedModelId).toBe(CINEMATIC_FAST);
    expect(result.switchedFrom).toBeUndefined();
    expect(result.requiresConfirmation).toBe(false);
  });
});

describe("SILENT keeps the cheap model", () => {
  it("permits Motion 1 and asks for no confirmation", () => {
    const result = route({ prompt: "a wolf in a forest, no audio" });

    expect(result.intent).toBe("SILENT");
    expect(result.recommendedModelId).toBe(MOTION_1);
    expect(result.nativeAudio).toBe(false);
    expect(result.requiresConfirmation).toBe(false);
    expect(result.refusals).toEqual([]);
  });

  it("never upgrades a silent request to a paid model", () => {
    // The expensive failure in reverse: a user who asked for silence must not
    // be moved onto a model that costs four times as much.
    expect(route({ prompt: "silent clip of a wolf" }).recommendedModelId).toBe(
      MOTION_1,
    );
  });

  it("silences every model that is currently offered", () => {
    /**
     * This asserted the always-on note, using Cinematic Lite — the one tier
     * whose schema has no `generate_audio` field, so a Silent switch on it
     * would have been wired to nothing.
     *
     * Lite was withdrawn on 2026-08-26: a separate endpoint on a separate
     * pinned version from the two Cinematic tiers, so a separate licence
     * question that has not been answered. With it gone, **every** offered
     * video model can genuinely be silenced, and that is the more useful thing
     * to pin — a Silent request must never be quietly ignored.
     *
     * The always-on branch is still live code and still covered by a fixture
     * in `video-audio.test.ts`; `routeAudio` resolves a model by id, and a
     * withdrawn id has nothing to resolve to.
     */
    for (const selectedModelId of [
      "replicate/video-gen",
      "replicate/video-pro",
      "replicate/veo-3.1-fast",
      "replicate/veo-3.1",
    ]) {
      const result = route({ prompt: "no audio please", selectedModelId });

      expect(result.intent, selectedModelId).toBe("SILENT");
      expect(result.nativeAudio, selectedModelId).toBe(false);
      expect(result.notes.join(" "), selectedModelId).not.toMatch(
        /silent export is not available/,
      );
    }
  });
});

describe("an explicit audio request on a silent model is refused, not warned", () => {
  it("refuses when native audio is unavailable to this account", () => {
    /**
     * Submitting the silent model anyway would deliver the opposite of what was
     * asked. A warning next to a submit button is not a refusal.
     */
    const result = route({
      prompt: "a storm with sound",
      nativeAudioAvailable: false,
    });

    expect(result.refusals.length).toBeGreaterThan(0);
    expect(result.refusals.join(" ")).toMatch(/not available on your account/);
  });

  it("degrades AUTO to silent rather than refusing it", () => {
    // AUTO expressed no preference, so an account without native audio simply
    // gets the honest silent path and is told.
    const result = route({ nativeAudioAvailable: false });

    expect(result.intent).toBe("SILENT");
    expect(result.refusals).toEqual([]);
    expect(result.notes.join(" ")).toMatch(/silent video/);
  });
});

describe("the audio control beats the prompt", () => {
  it("honours SILENT from the control over 'with sound' in the text", () => {
    const result = route({
      prompt: "a storm with sound",
      requestedIntent: "SILENT",
    });

    expect(result.intent).toBe("SILENT");
    expect(result.intentReason).toMatch(/audio control/);
  });

  it("treats AUTO from the control as no instruction at all", () => {
    const result = route({
      prompt: "a wolf, no audio",
      requestedIntent: "AUTO",
    });
    expect(result.intent).toBe("SILENT");
  });
});

describe("the sound mix is honest about not existing", () => {
  it("refuses rather than pretending", () => {
    const result = route({ requestedIntent: "ATHEOS_SOUND_MIX" });

    expect(result.refusals.join(" ")).toMatch(/not built yet/);
    expect(result.nativeAudio).toBe(false);
  });
});

describe("the server refuses forged combinations", () => {
  it("rejects Motion 1 with a native-audio promise", () => {
    /**
     * The composer is the one place an attacker controls completely, so the
     * client's routing is a convenience and this is the rule.
     */
    expect(
      rejectImpossibleAudio({ modelId: MOTION_1, wantsNativeAudio: true }),
    ).toMatch(/cannot produce native audio/);
  });

  it("rejects Motion Pro the same way", () => {
    expect(
      rejectImpossibleAudio({ modelId: MOTION_PRO, wantsNativeAudio: true }),
    ).toBeTruthy();
  });

  it("allows Cinematic Fast", () => {
    expect(
      rejectImpossibleAudio({
        modelId: CINEMATIC_FAST,
        wantsNativeAudio: true,
      }),
    ).toBeNull();
  });

  it("allows any model when no audio was promised", () => {
    expect(
      rejectImpossibleAudio({ modelId: MOTION_1, wantsNativeAudio: false }),
    ).toBeNull();
  });

  it("rejects an unknown model that claims sound", () => {
    // A model absent from the capability table has proved nothing.
    expect(
      rejectImpossibleAudio({
        modelId: "replicate/made-up",
        wantsNativeAudio: true,
      }),
    ).toBeTruthy();
  });
});
