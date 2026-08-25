import { describe, expect, it } from "vitest";

import {
  audioCapabilityOf,
  catalogueModelId,
  publicModelId,
  toPublicModel,
} from "@/features/studio/lib/public-model";
import type { StudioModel } from "@/features/studio/types";

/**
 * What a browser is allowed to know about a model.
 *
 * ## The leak this closes, measured
 *
 * The live `/api/generations` response carried **56 occurrences of
 * "replicate"**: `providerId` on every model, and the id itself —
 * `replicate/flux-schnell` — naming the vendor and its own model slug. A
 * customer's browser was told which vendor runs every generation and which one
 * produced every finished file.
 *
 * "Many vendors, one interface" is the product promise. A client that knows the
 * vendor has already broken it, and it is what would make a provider switch
 * visible to customers instead of invisible.
 */

const model = (over: Partial<StudioModel> = {}): StudioModel =>
  ({
    id: "replicate/flux-schnell",
    providerId: "replicate",
    displayName: "FLUX Schnell",
    modality: "IMAGE",
    description: "Fast drafts.",
    creditCost: 4,
    typicalSeconds: 12,
    capabilities: {
      operations: ["text-to-image"],
      supportsImageInput: false,
      supportsNegativePrompt: false,
      supportsSeed: true,
      maxOutputs: 4,
      aspectRatios: ["1:1"],
    },
    ...over,
  }) as unknown as StudioModel;

describe("nothing about the provider survives", () => {
  it("drops providerId entirely rather than renaming it", () => {
    /**
     * Dropped, not renamed. A renamed field comes back the next time somebody
     * needs "the real id" for debugging; a field that does not exist cannot.
     */
    const publicModel = toPublicModel(model());

    expect("providerId" in publicModel).toBe(false);
    expect("providerName" in publicModel).toBe(false);
  });

  it("replaces the provider-prefixed id with an opaque one", () => {
    const publicModel = toPublicModel(model());

    expect(publicModel.id).toBe("atheos-image-fast");
    expect(publicModel.id).not.toMatch(/replicate|flux|schnell/i);
  });

  it("carries no provider string anywhere in the serialised object", () => {
    // The assertion that matters: whatever fields exist, none of them says it.
    const serialised = JSON.stringify(toPublicModel(model()));

    expect(serialised).not.toMatch(/replicate|openai|google|veo|flux|wan/i);
  });

  it("hides the vendor's model name for every catalogue entry", () => {
    /**
     * Stripping the prefix would not be enough: `veo-3.1-fast` still names
     * Google's model and its version, which is why the table is hand-written
     * rather than derived.
     */
    for (const id of [
      "replicate/veo-3.1-fast",
      "replicate/veo-3.1",
      "replicate/video-gen",
      "replicate/music",
    ]) {
      expect(publicModelId(id)).not.toMatch(/replicate|veo|wan|\//i);
    }
  });

  it("gives an unmapped model an ugly id rather than a disclosure", () => {
    /**
     * A model added without a table entry must not leak its provider because
     * somebody forgot. The failure mode is a hash, not a path.
     */
    const id = publicModelId("replicate/some-new-model-v2");

    expect(id).toMatch(/^model-[a-z0-9]+$/);
    expect(id).not.toMatch(/replicate|some-new-model/);
  });

  it("is stable, so a provider swap changes no id a browser has seen", () => {
    expect(publicModelId("replicate/flux-dev")).toBe("atheos-image-realistic");
    expect(publicModelId("replicate/flux-dev")).toBe(
      publicModelId("replicate/flux-dev"),
    );
  });
});

describe("the server can still resolve what a client sent", () => {
  it("maps a public id back to its catalogue id", () => {
    expect(catalogueModelId("atheos-image-fast")).toBe(
      "replicate/flux-schnell",
    );
    expect(catalogueModelId("cinematic-fast")).toBe("replicate/veo-3.1-fast");
  });

  it("returns null for an id it does not know", () => {
    // An unknown id is refused rather than guessed at — a client-supplied
    // string must never become a model path by accident.
    expect(catalogueModelId("made-up")).toBeNull();
    expect(catalogueModelId("replicate/veo-3.1-fast")).toBeNull();
  });

  it("round-trips every mapped model", () => {
    for (const id of [
      "replicate/flux-schnell",
      "replicate/video-gen",
      "replicate/veo-3.1-fast",
      "replicate/sfx",
    ]) {
      expect(catalogueModelId(publicModelId(id))).toBe(id);
    }
  });
});

describe("audio capability reaches the Studio at last", () => {
  it("calls Motion 1 silent, plainly", () => {
    /**
     * The Studio had no audio field at all, so the picker could not say this
     * however honest the marketing page was.
     */
    const { audio, audioNote } = audioCapabilityOf(
      "replicate/video-gen",
      "VIDEO",
    );

    expect(audio).toBe("silent");
    expect(audioNote).toMatch(/no audio track/i);
  });

  it("calls Motion Pro silent too", () => {
    expect(audioCapabilityOf("replicate/video-pro", "VIDEO").audio).toBe(
      "silent",
    );
  });

  it("never promises a mix that does not exist", () => {
    // The wording this replaces described a pipeline that was never built.
    for (const id of ["replicate/video-gen", "replicate/video-pro"]) {
      const { audioNote } = audioCapabilityOf(id, "VIDEO");
      expect(audioNote).not.toMatch(/atheos adds|added afterwards|sound mix/i);
    }
  });

  it("calls Cinematic Fast native, because it genuinely is", () => {
    const { audio, audioNote } = audioCapabilityOf(
      "replicate/veo-3.1-fast",
      "VIDEO",
    );

    expect(audio).toBe("native");
    expect(audioNote).toMatch(/same pass/i);
  });

  it("treats an unknown video model as silent, not as native", () => {
    // Fail closed. A model that has proved nothing gets the claim that cannot
    // disappoint anyone.
    expect(audioCapabilityOf("replicate/unknown", "VIDEO").audio).toBe(
      "silent",
    );
  });

  it("says nothing about sound for a still", () => {
    expect(audioCapabilityOf("replicate/flux-dev", "IMAGE").audio).toBe(
      "not_applicable",
    );
  });

  it("puts the capability on the public model", () => {
    const motion = toPublicModel(
      model({ id: "replicate/video-gen", modality: "VIDEO" }),
    );

    expect(motion.audio).toBe("silent");
    expect(motion.audioNote).toBeTruthy();
  });
});

describe("reference capability is stated rather than inferred by the client", () => {
  it("reports true when the model takes an image", () => {
    const withRef = toPublicModel(
      model({
        capabilities: {
          ...model().capabilities,
          supportsImageInput: true,
        } as StudioModel["capabilities"],
      }),
    );
    expect(withRef.takesReference).toBe(true);
  });

  it("reports false when it does not", () => {
    expect(toPublicModel(model()).takesReference).toBe(false);
  });
});
