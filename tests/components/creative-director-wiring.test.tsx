import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLACEHOLDER_MODEL } from "@/features/studio/data/models";
import { planCreation } from "@/features/studio/lib/creative-plan";
import type { StudioModel } from "@/features/studio/types";
import type { CreativePlanResponse } from "@/features/studio/lib/creative-plan";
import { useCreativeDirector } from "@/features/studio/lib/use-creative-director";
import { planFromPrompt } from "@/services/ai/intent-planner";
import { useStudioStore } from "@/store/studio-store";

vi.mock("@/features/studio/lib/creative-plan", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/studio/lib/creative-plan")
  >("@/features/studio/lib/creative-plan");
  return { ...actual, planCreation: vi.fn() };
});

vi.mock("@/lib/toast", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
  },
}));

/**
 * The wiring itself.
 *
 * ## What went wrong for four sprints
 *
 * The studio built a shot plan, displayed it, and submitted
 * `assemblePrompt(params, installedStyles)` instead. Every piece had tests. The
 * *connection* between them did not, because it lived in the middle of a
 * nine-hundred-line component that nothing could mount.
 *
 * So these assert the connection, and nothing else: that pressing Generate
 * plans rather than submits, that confirming submits the token the server
 * issued, and that a planning failure does not quietly fall back to the path
 * the plan was supposed to replace.
 */

const planned = vi.mocked(planCreation);

function response(
  overrides: Partial<CreativePlanResponse> = {},
): CreativePlanResponse {
  return {
    brief: planFromPrompt({
      prompt: "an 8 second commercial of a red car",
      referenceImageCount: 0,
    }),
    assumptions: [],
    clarifications: [],
    conflicts: [],
    caveats: [],
    alternatives: [],
    recommendedModelId: "replicate/veo-3.1",
    blockingRequirements: [],
    quote: { credits: 960, estimatedSeconds: 180 },
    finalPromptPreview: {
      modelId: "replicate/veo-3.1",
      compilerVersion: 1,
      prompt: "SHOT 1 …",
      negativePrompt: "",
      omitted: [],
    },
    confirmationRequired: true,
    planToken: "signed.token",
    expiresAtMs: 1_700_000_900_000,
    ttlSeconds: 900,
    ...overrides,
  };
}

/**
 * The catalogue, seeded.
 *
 * The store starts empty and is filled from `/api/generations` — hard-coding a
 * model id in the store would break whenever a provider's line-up changed. So
 * the test supplies one, the way the bootstrap does.
 */
const VIDEO_MODEL: StudioModel = {
  ...PLACEHOLDER_MODEL,
  id: "replicate/veo-3.1",
  displayName: "Cinematic",
  modality: "VIDEO",
  capabilities: {
    ...PLACEHOLDER_MODEL.capabilities,
    aspectRatios: ["16:9", "9:16", "1:1"],
    operations: ["text-to-video"],
  },
};

const IMAGE_MODEL: StudioModel = {
  ...PLACEHOLDER_MODEL,
  id: "replicate/flux-schnell",
  displayName: "Fast image",
  modality: "IMAGE",
};

function seedCatalogue() {
  act(() => {
    useStudioStore.getState().setModels([VIDEO_MODEL, IMAGE_MODEL], false);
  });
}

function selectVideoModel() {
  seedCatalogue();
  act(() => {
    const state = useStudioStore.getState();
    state.setModel(VIDEO_MODEL.id);
    state.setParam("prompt", "an 8 second commercial of a red car");
  });
  return VIDEO_MODEL;
}

function selectImageModel() {
  seedCatalogue();
  act(() => {
    const state = useStudioStore.getState();
    state.setModel(IMAGE_MODEL.id);
    state.setParam("prompt", "a red car");
  });
  return IMAGE_MODEL;
}

beforeEach(() => {
  planned.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Generate plans; it does not submit", () => {
  it("asks the server what it understood before spending anything", async () => {
    const generate = vi.fn().mockResolvedValue("gen_1");
    planned.mockResolvedValue(response());

    const { result } = renderHook(() => useCreativeDirector(generate));
    selectVideoModel();

    await act(async () => {
      await result.current.start();
    });

    expect(planned).toHaveBeenCalledOnce();
    // The submission has NOT happened. This is the assertion that would have
    // failed for the entire life of the bug.
    expect(generate).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.plan).not.toBeNull());
  });

  it("sends the prompt and the controls the composer is showing", async () => {
    const generate = vi.fn().mockResolvedValue("gen_1");
    planned.mockResolvedValue(response());

    const { result } = renderHook(() => useCreativeDirector(generate));
    const model = selectVideoModel();
    act(() => {
      useStudioStore.getState().setParam("durationSeconds", 8);
    });

    await act(async () => {
      await result.current.start();
    });

    expect(planned).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "an 8 second commercial of a red car",
        modelId: model.id,
        durationSeconds: 8,
      }),
    );
  });

  it("plans an image too, and says which modality it is planning", async () => {
    /**
     * This used to assert the opposite — that images skipped planning, because
     * a still has no shots or sound to confirm. The dragon benchmark showed why
     * that was wrong: the thing worth confirming about an image is its shape
     * and size, and a 1024x1024 square was produced from a prompt whose
     * cinematic framing nobody was ever shown.
     */
    const generate = vi.fn().mockResolvedValue("gen_1");
    planned.mockResolvedValue(response());
    const { result } = renderHook(() => useCreativeDirector(generate));
    selectImageModel();

    await act(async () => {
      await result.current.start();
    });

    expect(planned).toHaveBeenCalledWith(
      expect.objectContaining({ modality: "image" }),
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it("sends no duration when planning a still", async () => {
    // A `durationSeconds` in an image brief is a value nobody chose sitting
    // inside the hash the plan token signs.
    const generate = vi.fn().mockResolvedValue("gen_1");
    planned.mockResolvedValue(response());
    const { result } = renderHook(() => useCreativeDirector(generate));
    selectImageModel();

    await act(async () => {
      await result.current.start();
    });

    expect(planned.mock.calls[0][0]).not.toHaveProperty("durationSeconds");
  });

  it("sends a duration when planning a clip", async () => {
    const generate = vi.fn().mockResolvedValue("gen_1");
    planned.mockResolvedValue(response());
    const { result } = renderHook(() => useCreativeDirector(generate));
    selectVideoModel();

    await act(async () => {
      await result.current.start();
    });

    expect(planned).toHaveBeenCalledWith(
      expect.objectContaining({ modality: "video" }),
    );
    expect(planned.mock.calls[0][0]).toHaveProperty("durationSeconds");
  });
});

describe("confirming submits the server's token", () => {
  it("passes the token and the untouched brief to the submission", async () => {
    /**
     * The whole sprint, in one assertion. `submitGeneration` receives the
     * signed token and the brief the server planned — and the server overrides
     * the prompt from them.
     */
    const generate = vi.fn().mockResolvedValue("gen_1");
    const plan = response();
    planned.mockResolvedValue(plan);

    const { result } = renderHook(() => useCreativeDirector(generate));
    selectVideoModel();

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.confirm();
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        planToken: "signed.token",
        confirmedBrief: plan.brief,
      }),
    );
    // Byte-identical, not merely equal: the token carries its hash.
    expect(generate.mock.calls[0][0].confirmedBrief).toBe(plan.brief);
  });

  it("uses one idempotency key per plan, so a double-click is one video", async () => {
    const generate = vi.fn().mockResolvedValue(null); // submission failed
    planned.mockResolvedValue(response());

    const { result } = renderHook(() => useCreativeDirector(generate));
    selectVideoModel();

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.confirm();
      await result.current.confirm();
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0][0].clientIdempotencyKey).toBe(
      generate.mock.calls[1][0].clientIdempotencyKey,
    );
  });

  it("keeps the panel open when the submission failed", async () => {
    // Closing it would leave the user with no plan, no video and no retry.
    const generate = vi.fn().mockResolvedValue(null);
    planned.mockResolvedValue(response());

    const { result } = renderHook(() => useCreativeDirector(generate));
    selectVideoModel();

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.confirm();
    });

    expect(result.current.plan).not.toBeNull();
  });

  it("closes it when the submission happened", async () => {
    const generate = vi.fn().mockResolvedValue("gen_1");
    planned.mockResolvedValue(response());

    const { result } = renderHook(() => useCreativeDirector(generate));
    selectVideoModel();

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.confirm();
    });

    await waitFor(() => expect(result.current.plan).toBeNull());
  });

  it("refuses to submit a plan the server would not sign", async () => {
    const generate = vi.fn().mockResolvedValue("gen_1");
    planned.mockResolvedValue(response({ planToken: null, quote: null }));

    const { result } = renderHook(() => useCreativeDirector(generate));
    selectVideoModel();

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.confirm();
    });

    expect(generate).not.toHaveBeenCalled();
  });
});

describe("answers and model changes re-plan on the server", () => {
  it("carries an answer into the next plan", async () => {
    const generate = vi.fn().mockResolvedValue("gen_1");
    planned.mockResolvedValue(response());

    const { result } = renderHook(() => useCreativeDirector(generate));
    selectVideoModel();

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.answer("shotCount", 1);
    });

    expect(planned).toHaveBeenLastCalledWith(
      expect.objectContaining({ answers: { shotCount: 1 } }),
    );
  });

  it("re-prices on the server when the model changes", async () => {
    /**
     * Not recomputed in the browser. A client-side price is how the button came
     * to say "90 credits" for a four-shot plan that 90 credits could not buy.
     */
    const generate = vi.fn().mockResolvedValue("gen_1");
    planned.mockResolvedValue(response());

    const { result } = renderHook(() => useCreativeDirector(generate));
    selectVideoModel();

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.chooseModel("replicate/seedance-2.5");
    });

    expect(planned).toHaveBeenLastCalledWith(
      expect.objectContaining({ modelId: "replicate/seedance-2.5" }),
    );
  });
});

describe("the disabled and failing paths", () => {
  it("submits directly when the Director is off", async () => {
    // 404 → planCreation resolves null. This is what ships today.
    const generate = vi.fn().mockResolvedValue("gen_1");
    planned.mockResolvedValue(null);

    const { result } = renderHook(() => useCreativeDirector(generate));
    selectVideoModel();

    await act(async () => {
      await result.current.start();
    });

    expect(generate).toHaveBeenCalledWith();
    expect(result.current.plan).toBeNull();
  });

  it("does NOT fall back to a direct submission when planning fails", async () => {
    /**
     * The tempting fallback, and the wrong one: it would send the
     * browser-assembled prompt — the exact bypass the feature closes — at the
     * moment the user is least able to notice, because they asked for a video
     * and would get one.
     */
    const generate = vi.fn().mockResolvedValue("gen_1");
    planned.mockRejectedValue(new Error("planner exploded"));

    const { result } = renderHook(() => useCreativeDirector(generate));
    selectVideoModel();

    await act(async () => {
      await result.current.start();
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result.current.plan).toBeNull();
  });
});
