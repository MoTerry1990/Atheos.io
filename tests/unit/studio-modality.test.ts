import { describe, expect, it } from "vitest";

import {
  chooseModelForModality,
  modalityOf,
} from "@/features/studio/lib/modality";

/** A catalogue shaped like the real one: several image models, fewer video. */
const CATALOGUE = [
  { id: "flux/schnell", modality: "IMAGE" },
  { id: "flux/dev", modality: "IMAGE" },
  { id: "replicate/motion-1", modality: "VIDEO" },
  { id: "replicate/motion-pro", modality: "VIDEO" },
  { id: "eleven/voice", modality: "AUDIO" },
] as const;

describe("reading a model's modality", () => {
  it("translates the catalogue's enum into the rail's vocabulary", () => {
    expect(modalityOf({ modality: "IMAGE" })).toBe("image");
    expect(modalityOf({ modality: "VIDEO" })).toBe("video");
    expect(modalityOf({ modality: "AUDIO" })).toBe("audio");
  });

  it("falls back rather than throwing on something unrecognised", () => {
    // A modality nobody has seen before should leave the studio usable.
    expect(modalityOf({ modality: "HOLOGRAM" })).toBe("image");
  });
});

describe("switching modality actually changes the model", () => {
  it("returns a model of the requested kind", () => {
    /**
     * The regression this file exists for. The rail was `useState<Modality>`
     * wired to its own highlight and nothing else: clicking Image while Motion 1
     * was selected moved the pill and left the composer on the video model,
     * heading, placeholder and 90-credit estimate included.
     */
    expect(chooseModelForModality({ models: CATALOGUE, next: "image" })).toBe(
      "flux/schnell",
    );
    expect(chooseModelForModality({ models: CATALOGUE, next: "video" })).toBe(
      "replicate/motion-1",
    );
    expect(chooseModelForModality({ models: CATALOGUE, next: "audio" })).toBe(
      "eleven/voice",
    );
  });

  it("returns the model the user was last using in that modality", () => {
    // Going to video and back should not silently move someone from Flux Dev to
    // whichever image model happens to be first in the catalogue.
    expect(
      chooseModelForModality({
        models: CATALOGUE,
        next: "image",
        remembered: { image: "flux/dev" },
      }),
    ).toBe("flux/dev");
  });

  it("ignores a remembered model that has left the catalogue", () => {
    // Selecting a withdrawn id would point the composer at nothing.
    expect(
      chooseModelForModality({
        models: CATALOGUE,
        next: "video",
        remembered: { video: "replicate/retired" },
      }),
    ).toBe("replicate/motion-1");
  });

  it("ignores a remembered model of the wrong modality", () => {
    const chosen = chooseModelForModality({
      models: CATALOGUE,
      next: "video",
      remembered: { video: "flux/dev" },
    });
    // `flux/dev` is in the catalogue, so the existence check passes — but it is
    // an image model, and returning it would put the composer in image mode
    // while the rail says video. Exactly the disagreement this replaced.
    expect(chosen).toBe("replicate/motion-1");
  });

  it("returns null when the catalogue has nothing of that kind", () => {
    /**
     * Null rather than a fallback to some other modality's model: the caller has
     * to say "no model for this output type" out loud. Quietly selecting an
     * image model when the user asked for audio is the original bug wearing a
     * different hat.
     */
    expect(
      chooseModelForModality({
        models: [{ id: "flux/schnell", modality: "IMAGE" }],
        next: "audio",
      }),
    ).toBeNull();
    expect(chooseModelForModality({ models: [], next: "image" })).toBeNull();
  });
});
