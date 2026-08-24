import { describe, expect, it } from "vitest";

import { dtoToHistoryJob } from "@/features/studio/lib/job-mapper";
import type { GenerationDTO } from "@/features/studio/lib/dto";
import { assemblePrompt } from "@/store/studio-store";
import type { StudioParams } from "@/features/studio/types";

/**
 * Reusing a history entry must not grow its prompt.
 *
 * ## The bug
 *
 * `dtoToHistoryJob` restored `dto.prompt` — the *expanded* string, typed text
 * plus every camera and preset fragment — as the composer's typed prompt, with
 * the preset chips cleared. Pressing "reuse settings" therefore put the
 * fragments into the text box, and the next submission appended them again.
 * Three reuses of one entry produced "…cinematic, cinematic, cinematic", and
 * each round was submitted and charged for.
 *
 * The second half of the same failure: a prompt ending in a comma joined to a
 * fragment produced a doubled separator. Real history rows carry it — one
 * begins "make a red dragon on top of a castle fired fire from his mouth,".
 */

const CAMERA_EMPTY = { shot: null, angle: null, lens: null, lighting: null };

function params(over: Partial<StudioParams> = {}): StudioParams {
  return {
    sequenceMode: "continuous",
    modelId: "replicate/flux-dev",
    prompt: "",
    negativePrompt: "",
    presetIds: [],
    camera: { ...CAMERA_EMPTY },
    aspectRatio: "1:1",
    resolution: 1024,
    creativity: 0.5,
    seed: null,
    seedLocked: false,
    outputs: 1,
    references: [],
    durationSeconds: 5,
    cameraMotion: null,
    ...over,
  } as StudioParams;
}

const STYLE = {
  id: "pack:noir",
  name: "Noir",
  hue: 220,
  fragment: "high-contrast noir",
};

function dto(over: Partial<GenerationDTO> = {}): GenerationDTO {
  return {
    id: "g_1",
    status: "succeeded",
    operation: "TEXT_TO_IMAGE",
    modelId: "replicate/flux-dev",
    prompt: "a lighthouse",
    negativePrompt: null,
    creditCost: 4,
    error: null,
    createdAt: 0,
    completedAt: 1,
    parameters: {},
    outputs: [],
    ...over,
  } as GenerationDTO;
}

describe("assembly does not double separators", () => {
  it("drops a trailing comma the user typed", () => {
    // The exact shape of a real history row.
    const assembled = assemblePrompt(
      params({
        prompt:
          "make a red dragon on top of a castle fired fire from his mouth,",
        presetIds: ["pack:noir"],
      }),
      [STYLE],
    );

    expect(assembled).not.toMatch(/,\s*,/);
    expect(assembled).toBe(
      "make a red dragon on top of a castle fired fire from his mouth, high-contrast noir",
    );
  });

  it("drops trailing semicolons and stray whitespace too", () => {
    expect(
      assemblePrompt(
        params({ prompt: "a harbour ;  ", presetIds: ["pack:noir"] }),
        [STYLE],
      ),
    ).toBe("a harbour, high-contrast noir");
  });

  it("leaves the user's internal punctuation alone", () => {
    // Commas between clauses are the user's phrasing, not a join artefact.
    const assembled = assemblePrompt(
      params({ prompt: "a harbour, at dusk, raining" }),
      [],
    );
    expect(assembled).toBe("a harbour, at dusk, raining");
  });

  it("leaves a closing full stop alone", () => {
    // A sentence that ends is not a fragment waiting to be continued.
    expect(assemblePrompt(params({ prompt: "A quiet street." }), [])).toBe(
      "A quiet street.",
    );
  });
});

describe("reuse restores what was typed, not what was sent", () => {
  const RECORDED = dto({
    // What the provider got.
    prompt: "a lighthouse, wide shot, high-contrast noir",
    parameters: {
      promptSource: {
        text: "a lighthouse",
        presetIds: ["pack:noir"],
        camera: { ...CAMERA_EMPTY, shot: "wide shot" },
      },
    },
  });

  it("puts the typed text back in the box", () => {
    const job = dtoToHistoryJob(RECORDED);
    expect(job.params.prompt).toBe("a lighthouse");
    expect(job.params.presetIds).toEqual(["pack:noir"]);
    expect(job.params.camera.shot).toBe("wide shot");
  });

  it("re-assembles to exactly what was submitted the first time", () => {
    /**
     * The whole point. Reuse → submit must reproduce the original prompt
     * byte-for-byte, however many times it goes round.
     */
    const job = dtoToHistoryJob(RECORDED);

    let current = job.params;
    for (let round = 0; round < 3; round++) {
      const assembled = assemblePrompt(current, [STYLE]);
      expect(assembled).toBe("a lighthouse, wide shot, high-contrast noir");
      // Feed the reuse back in, as pressing the button again would.
      current = dtoToHistoryJob(RECORDED).params;
    }
  });

  it("does not compound across repeated reuse", () => {
    const job = dtoToHistoryJob(RECORDED);
    const assembled = assemblePrompt(job.params, [STYLE]);
    expect(assembled.match(/high-contrast noir/g)).toHaveLength(1);
    expect(assembled.match(/wide shot/g)).toHaveLength(1);
  });

  it("is not flagged as expanded", () => {
    expect(dtoToHistoryJob(RECORDED).promptIsExpanded).toBe(false);
  });
});

describe("rows written before the composer's inputs were recorded", () => {
  const LEGACY = dto({ prompt: "a lighthouse, high-contrast noir" });

  it("keeps the expanded prompt, because nothing better survives", () => {
    // The typed text is unrecoverable — it was never stored. Inventing one by
    // stripping suffixes would guess, and guessing wrong rewrites history.
    expect(dtoToHistoryJob(LEGACY).params.prompt).toBe(
      "a lighthouse, high-contrast noir",
    );
  });

  it("is flagged so the composer can warn instead of compounding silently", () => {
    expect(dtoToHistoryJob(LEGACY).promptIsExpanded).toBe(true);
  });

  it("restores no preset chips, so nothing is appended twice", () => {
    /**
     * The fragments are already inside the text. Lighting the chips as well
     * would append them a second time on submit — which is precisely how the
     * corruption spread.
     */
    const job = dtoToHistoryJob(LEGACY);
    expect(job.params.presetIds).toEqual([]);
    expect(job.params.camera).toEqual(CAMERA_EMPTY);
    expect(assemblePrompt(job.params, [STYLE])).toBe(
      "a lighthouse, high-contrast noir",
    );
  });
});

describe("a malformed stored source degrades rather than throws", () => {
  for (const [name, promptSource] of [
    ["null", null],
    ["a string", "a lighthouse"],
    ["missing text", { presetIds: [] }],
    ["wrong types", { text: 42, presetIds: "noir" }],
  ] as const) {
    it(`treats ${name} as no source recorded`, () => {
      const job = dtoToHistoryJob(dto({ parameters: { promptSource } }));
      expect(job.promptIsExpanded).toBe(true);
      expect(job.params.prompt).toBe("a lighthouse");
    });
  }

  it("keeps a valid text even when the preset list is junk", () => {
    const job = dtoToHistoryJob(
      dto({
        parameters: {
          promptSource: { text: "a lighthouse", presetIds: [1, "pack:noir"] },
        },
      }),
    );
    expect(job.params.prompt).toBe("a lighthouse");
    expect(job.params.presetIds).toEqual(["pack:noir"]);
  });
});
