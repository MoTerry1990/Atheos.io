import { describe, expect, it } from "vitest";

import {
  type AudioMode,
  defaultAudioMode,
  isAudioMode,
  isNativeAudioMode,
  readStoredAudioMode,
  supportedAudioModes,
  validateAudioIntent,
} from "@/services/ai/audio-intent";
import {
  VIDEO_CAPABILITIES,
  availableVideoModels,
  nativeAudioModels,
  videoCapability,
} from "@/services/ai/video-capabilities";
import { MODEL_COSTS } from "@/services/billing/model-costs";

/**
 * The audio contract, and the claims the capability table is allowed to make.
 *
 * ## What this exists to catch
 *
 * Sprint 5D found that **neither shipped video model can produce audio** — not
 * as a wiring gap but as an absence in both provider schemas. The risk that
 * follows is not a crash; it is a "Native audio" badge appearing on a model
 * that returns a silent file, and a user paying 90 credits to find out.
 *
 * So these tests assert two different things, and the distinction matters:
 *
 *  - **Contract tests** pin behaviour that must hold whatever the catalogue
 *    contains — audio defaults ON where it is possible, refusals happen before
 *    money moves, silence is always available.
 *  - **Fact tests** pin what the providers actually offered on 2026-08-16. If
 *    Replicate ships audio on Wan tomorrow, those failures are the correct and
 *    intended way to find out, because the marketing copy will need to change
 *    with them.
 */

const SHIPPED = ["replicate/video-gen", "replicate/video-pro"] as const;

describe("the capability table describes reality", () => {
  it("gives every entry a provider slug and a verification date", () => {
    for (const entry of VIDEO_CAPABILITIES) {
      // A claim with no traceable source is the thing this table replaced.
      expect(entry.slug, entry.id).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);
      expect(entry.verifiedAt, entry.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.notes.length, entry.id).toBeGreaterThan(40);
    }
  });

  it("prices every model it offers", () => {
    // An available model with no cost entry is an unpriced generation, which
    // is the one thing the spending breaker cannot protect against.
    const priced = new Set(MODEL_COSTS.map((cost) => cost.modelId));
    for (const entry of availableVideoModels()) {
      expect(priced.has(entry.id), `${entry.id} has no cost entry`).toBe(true);
    }
  });

  it("keeps duration, resolution and ratio lists free of duplicates", () => {
    for (const entry of VIDEO_CAPABILITIES) {
      const lists: readonly (readonly (string | number)[])[] = [
        entry.durationsSeconds,
        entry.resolutions,
        entry.aspectRatios,
      ];

      for (const list of lists) {
        expect(new Set(list).size, entry.id).toBe(list.length);
      }
    }
  });

  it("claims no per-channel audio control without native audio", () => {
    for (const entry of VIDEO_CAPABILITIES) {
      if (entry.audio === "native") continue;
      expect(
        entry.dialogueDirection ||
          entry.sfxDirection ||
          entry.ambienceDirection ||
          entry.musicDirection ||
          entry.silentOption,
        `${entry.id} claims an audio control but has no audio`,
      ).toBe(false);
    }
  });
});

describe("what the providers actually offered on 2026-08-16", () => {
  it("has no shipped model that can generate audio", () => {
    /**
     * The headline finding. Both schemas were read from
     * `/v1/models/{slug}/versions/{id}`: wan-2.2-t2v-fast exposes prompt, seed,
     * num_frames, frames_per_second, resolution, aspect_ratio and lora fields;
     * seedance-1-lite exposes prompt, image, last_frame_image,
     * reference_images, duration, resolution, aspect_ratio, fps, camera_fixed
     * and seed. Neither has an audio input of any kind.
     *
     * When this fails, a model gained audio — go and check the schema, then
     * update the homepage copy in the same commit.
     */
    expect(nativeAudioModels()).toHaveLength(0);

    for (const id of SHIPPED) {
      expect(videoCapability(id)?.audio, id).toBe("none");
    }
  });

  it("records Veo 3 as the one audio-capable model, and keeps it off", () => {
    const veo = videoCapability("google/veo-3");
    expect(veo?.audio).toBe("native");
    // Off until a metered run establishes the per-second price. Enabling it
    // without one puts an unpriced model in front of the breaker.
    expect(veo?.available).toBe(false);
  });

  it("does not claim image input on a text-to-video model", () => {
    // wan-2.2-t2v-fast has no `image` input. The catalogue said it did.
    const wan = videoCapability("replicate/video-gen");
    expect(wan?.imageToVideo).toBe(false);
    expect(wan?.negativePrompt).toBe(false);
  });

  it("records seedance's first and last frame inputs", () => {
    // `image` + `last_frame_image` are the only genuine continuity mechanism
    // in the catalogue, and the basis of the storyboard proposal.
    const pro = videoCapability("replicate/video-pro");
    expect(pro?.startFrame).toBe(true);
    expect(pro?.endFrame).toBe(true);
  });

  it("claims no multi-shot or character lock anywhere", () => {
    // Both are things a storyboard feature would want and no verified model
    // provides. Continuity has to be built from seeds and frame chaining.
    for (const entry of VIDEO_CAPABILITIES) {
      expect(entry.multiShot, entry.id).toBe(false);
      expect(entry.characterConsistency, entry.id).toBe(false);
    }
  });
});

describe("default audio behaviour", () => {
  it("defaults to ON for every model that can produce sound", () => {
    // The product rule. Written against the table rather than a fixed list, so
    // it starts governing Veo 3 the moment Veo 3 is switched on.
    for (const entry of VIDEO_CAPABILITIES) {
      if (entry.audio !== "native") continue;
      const mode = defaultAudioMode(entry.id);
      expect(isNativeAudioMode(mode), entry.id).toBe(true);
      expect(validateAudioIntent(entry.id, undefined)).toMatchObject({
        ok: true,
        generateAudio: true,
      });
    }
  });

  it("defaults to silent for a model with no audio input", () => {
    for (const id of SHIPPED) {
      expect(defaultAudioMode(id), id).toBe("silent");
    }
  });

  it("defaults to silent for a model nobody has described", () => {
    // Not a throw: an unknown model is a catalogue gap, and the safe reading
    // of a gap is "makes no promises".
    expect(defaultAudioMode("replicate/does-not-exist")).toBe("silent");
  });

  it("treats a missing request as the default rather than an error", () => {
    const result = validateAudioIntent("replicate/video-gen", undefined);
    expect(result).toEqual({ ok: true, mode: "silent", generateAudio: false });
    expect(validateAudioIntent("replicate/video-gen", null).ok).toBe(true);
  });
});

describe("refusing audio a model cannot make", () => {
  it("rejects every native mode on a silent model", () => {
    const natives: AudioMode[] = [
      "native_full_mix",
      "native_sfx_ambient",
      "native_dialogue",
    ];

    for (const id of SHIPPED) {
      for (const mode of natives) {
        const result = validateAudioIntent(id, mode);
        expect(result.ok, `${id} + ${mode}`).toBe(false);
        if (result.ok) continue;

        expect(result.code).toBe("model_has_no_audio");
        // The refusal has to say what to do next, or the UI has nothing to
        // offer but a dead end.
        expect(result.supported).toContain("silent");
        expect(result.supported.length).toBeGreaterThan(0);
      }
    }
  });

  it("distinguishes a silent model from an unseparable channel", () => {
    // Veo 3 has audio but exposes one boolean, so a dialogue-only request is
    // refused for a different reason than a request to Motion 1 — and leads
    // to a different fix: change the mode, not the model.
    const result = validateAudioIntent("google/veo-3", "native_dialogue");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("channel_not_separable");
      expect(result.supported).toContain("native_full_mix");
    }
  });

  it("accepts the full mix on an audio-capable model", () => {
    expect(validateAudioIntent("google/veo-3", "native_full_mix")).toEqual({
      ok: true,
      mode: "native_full_mix",
      generateAudio: true,
    });
  });

  it("rejects an unknown model rather than assuming silence is fine", () => {
    const result = validateAudioIntent("replicate/nope", "native_full_mix");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unknown_model");
  });

  it("rejects a value that is not a mode at all", () => {
    // The server sees whatever the network sends, including a mode invented by
    // a client that is a version ahead or a request that was hand-rolled.
    for (const junk of ["loud", "", 7, {}, true, "NATIVE_FULL_MIX"]) {
      const result = validateAudioIntent("google/veo-3", junk);
      expect(result.ok, String(junk)).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_mode");
    }
  });

  it("never returns a rejection with nothing to fall back to", () => {
    for (const entry of VIDEO_CAPABILITIES) {
      for (const mode of ["native_dialogue", "native_sfx_ambient"] as const) {
        const result = validateAudioIntent(entry.id, mode);
        if (result.ok) continue;
        expect(result.supported.length, entry.id).toBeGreaterThan(0);
        expect(result.message.length, entry.id).toBeGreaterThan(10);
      }
    }
  });
});

describe("the mode list every model offers", () => {
  it("always offers silence and always offers a separate soundtrack", () => {
    // Silence is unconditionally deliverable. A post-processed track is too:
    // it is a second generation laid under the clip, which works regardless of
    // what the video model can do.
    for (const entry of VIDEO_CAPABILITIES) {
      const modes = supportedAudioModes(entry);
      expect(modes, entry.id).toContain("silent");
      expect(modes, entry.id).toContain("post_process");
    }
  });

  it("offers a native mode only where the schema has an audio input", () => {
    for (const entry of VIDEO_CAPABILITIES) {
      const native = supportedAudioModes(entry).filter(isNativeAudioMode);
      if (entry.audio === "native") {
        expect(native.length, entry.id).toBeGreaterThan(0);
      } else {
        expect(native, entry.id).toEqual([]);
      }
    }
  });

  it("accepts every mode it advertises", () => {
    // The list the composer renders and the list the server accepts are the
    // same list. Any drift between them is a control that fails on submit.
    for (const entry of VIDEO_CAPABILITIES) {
      for (const mode of supportedAudioModes(entry)) {
        expect(
          validateAudioIntent(entry.id, mode).ok,
          `${entry.id}/${mode}`,
        ).toBe(true);
      }
    }
  });

  it("sets generateAudio only for native modes", () => {
    // post_process must not set the provider flag: the sound comes from a
    // second job, and setting it would bill for audio twice.
    const result = validateAudioIntent("google/veo-3", "post_process");
    expect(result).toMatchObject({ ok: true, generateAudio: false });
  });
});

describe("reading back what was stored", () => {
  it("reports silent for generations written before this contract existed", () => {
    // Every historical row. They have no audioMode key, and they were silent.
    for (const value of [null, undefined, {}, { seed: 4 }, "x", 3]) {
      expect(readStoredAudioMode(value)).toBe("silent");
    }
  });

  it("round-trips a stored mode", () => {
    expect(readStoredAudioMode({ audioMode: "native_full_mix" })).toBe(
      "native_full_mix",
    );
  });

  it("ignores a stored value that is no longer a mode", () => {
    expect(readStoredAudioMode({ audioMode: "native_music_only" })).toBe(
      "silent",
    );
  });

  it("recognises exactly the modes it exports", () => {
    expect(isAudioMode("silent")).toBe(true);
    expect(isAudioMode("native_music_only")).toBe(false);
  });
});
