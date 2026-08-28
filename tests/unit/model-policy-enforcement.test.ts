import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A blocked model costs nothing.
 *
 * ## Why the assertion is "nothing was called" rather than "the balance is unchanged"
 *
 * A refusal *after* a reservation also leaves the balance unchanged — eventually,
 * once the release lands. That is a worse design wearing the same result: it
 * writes two ledger rows for a request that never ran, and it depends on the
 * release path working to stay correct. Refusing before anything is quoted means
 * there is no row to reverse.
 *
 * So these mock every module that can move money or reach a provider and assert
 * none of them was reached at all. The check has to be the *first* thing
 * `submitGeneration` does, and that is the only property worth pinning.
 */

const requireApiUser = vi.fn();
const reserveWithin = vi.fn();
const captureReservation = vi.fn();
const estimateCost = vi.fn();
const gateGeneration = vi.fn();
const checkGenerationLimits = vi.fn();
const findModel = vi.fn();
const providerForModel = vi.fn();
const providerSubmit = vi.fn();
const isAdmin = vi.fn();

vi.mock("@/services/admin/auth", () => ({
  isAdmin: () => isAdmin(),
}));

vi.mock("@/lib/auth", () => ({
  requireApiUser: () => requireApiUser(),
}));
vi.mock("@/services/billing/ledger", () => ({
  reserveWithin: (...a: unknown[]) => reserveWithin(...a),
  captureReservation: (...a: unknown[]) => captureReservation(...a),
  releaseReservation: vi.fn(),
}));
vi.mock("@/services/ai/cost", () => ({
  estimateCost: (...a: unknown[]) => estimateCost(...a),
}));
vi.mock("@/services/billing/spending", () => ({
  gateGeneration: (...a: unknown[]) => gateGeneration(...a),
  blockMessage: () => "blocked",
  recordSpend: vi.fn(),
}));
vi.mock("@/services/limits/generation-limits", () => ({
  checkGenerationLimits: (...a: unknown[]) => checkGenerationLimits(...a),
  limitMessage: () => "limited",
}));
/**
 * Storage is checked before anything is priced, which is right — there is no
 * point generating what cannot be saved — and it fires first in a test
 * environment with no bucket. Mocked as configured so these assertions reach
 * the check they are actually about.
 */
vi.mock("@/services/storage/assets", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  isStorageConfigured: () => true,
}));

vi.mock("@/services/ai/registry", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  findModel: (...a: unknown[]) => findModel(...a),
  providerForModel: (...a: unknown[]) => providerForModel(...a),
}));

const { submitGeneration, GenerationError } =
  await import("@/services/generation");

const request = (modelId: string) => ({
  operation: "text-to-audio" as const,
  modelId,
  prompt: "slow cinematic strings",
});

beforeEach(() => {
  vi.clearAllMocks();
  requireApiUser.mockResolvedValue({ id: "user_1", creditBalance: 10_000 });
  // An ordinary customer unless a test says otherwise.
  isAdmin.mockResolvedValue(false);
  // A resolvable adapter. `providerForModel` is a lookup, not a network call —
  // what must never happen is `submit`.
  providerForModel.mockReturnValue({ id: "test", submit: providerSubmit });
});

describe("a model the licence registry refuses", () => {
  it("is rejected with the generic message", async () => {
    await expect(submitGeneration(request("replicate/music"))).rejects.toThrow(
      GenerationError,
    );

    await expect(
      submitGeneration(request("replicate/music")),
    ).rejects.toMatchObject({
      status: 400,
      code: "model_unavailable",
      message: "That model is not available.",
    });
  });

  it("never reaches the quote", async () => {
    await submitGeneration(request("replicate/music")).catch(() => {});
    expect(estimateCost).not.toHaveBeenCalled();
  });

  it("never reserves credits", async () => {
    // The claim that matters commercially. No ledger row, so nothing to refund.
    await submitGeneration(request("replicate/music")).catch(() => {});
    expect(reserveWithin).not.toHaveBeenCalled();
    expect(captureReservation).not.toHaveBeenCalled();
  });

  it("never creates a generation row or calls a provider", async () => {
    await submitGeneration(request("replicate/music")).catch(() => {});
    expect(providerForModel).not.toHaveBeenCalled();
  });

  it("does not consult the spending breaker or rate limits first", async () => {
    /**
     * Ordering, stated as a fact rather than a hope. If the licence check sat
     * after these, a blocked model would burn a customer's hourly generation
     * allowance on a request that was never going to run.
     */
    await submitGeneration(request("replicate/music")).catch(() => {});
    expect(gateGeneration).not.toHaveBeenCalled();
    expect(checkGenerationLimits).not.toHaveBeenCalled();
  });
});

describe("a model the owner may evaluate", () => {
  for (const modelId of [
    "replicate/video-pro",
    "replicate/veo-3.1-fast",
    "replicate/veo-3.1",
  ]) {
    it(`refuses ${modelId} for a customer, without spending`, async () => {
      await expect(submitGeneration(request(modelId))).rejects.toMatchObject({
        code: "model_unavailable",
      });
      expect(reserveWithin).not.toHaveBeenCalled();
    });

    it(`lets the owner evaluate ${modelId}`, async () => {
      /**
       * Past the licence gate and into ordinary validation, which fails here
       * only because `findModel` is mocked away. `unknown_model` rather than
       * `model_unavailable` is the whole assertion.
       */
      isAdmin.mockResolvedValue(true);
      findModel.mockReturnValue(undefined);

      await expect(submitGeneration(request(modelId))).rejects.toMatchObject({
        code: "unknown_model",
      });
    });
  }
});

describe("owner status is not a skeleton key", () => {
  it("still refuses Score for the owner", () => {
    /**
     * The failure mode this whole caller-aware design invites: an admin check
     * that widens everything instead of the one status it was added for.
     * Owner evaluation exists for models with ambiguous terms; MusicGen's are
     * not ambiguous.
     */
    isAdmin.mockResolvedValue(true);

    return expect(
      submitGeneration(request("replicate/music")),
    ).rejects.toMatchObject({ code: "model_unavailable" });
  });

  it("reserves nothing when it refuses the owner", async () => {
    isAdmin.mockResolvedValue(true);
    await submitGeneration(request("replicate/music")).catch(() => {});

    expect(reserveWithin).not.toHaveBeenCalled();
    expect(estimateCost).not.toHaveBeenCalled();
  });
});

describe("a model with no policy at all", () => {
  it("fails closed rather than running, even for the owner", async () => {
    isAdmin.mockResolvedValue(true);

    /**
     * The realistic way this gets bypassed: somebody adds a model to the
     * registry and forgets the policy entry. Unknown must mean no.
     */
    await expect(
      submitGeneration(request("replicate/something-new")),
    ).rejects.toMatchObject({ code: "model_unavailable" });

    expect(reserveWithin).not.toHaveBeenCalled();
  });
});

describe("an allowed model is not affected", () => {
  it("gets past the licence check and on to the usual validation", async () => {
    /**
     * Without this the suite would pass just as well if the gate refused
     * everything, which is a safe product nobody can use.
     */
    findModel.mockReturnValue(undefined);

    await expect(
      submitGeneration(request("replicate/sfx")),
    ).rejects.not.toMatchObject({ code: "model_unavailable" });
  });

  it("lets Motion 1 through, now its licence chain is documented", async () => {
    /**
     * The verdict this sprint changed. Motion 1's endpoint publishes no
     * licence, but the build it serves inherits Apache-2.0 from Wan 2.2 and
     * both vendors say so — so it is allowed on evidence rather than left
     * pending on an absence of it.
     *
     * It still fails here, because `findModel` is mocked away. The code is
     * what matters: `unknown_model` means it got past the licence gate and
     * died in ordinary validation.
     */
    findModel.mockReturnValue(undefined);

    await expect(
      submitGeneration(request("replicate/video-gen")),
    ).rejects.toMatchObject({ code: "unknown_model" });
  });
});

describe("an impossible clip length costs nothing", () => {
  /**
   * Motion 1 renders 5 or 7.5 seconds. Asking for ten used to snap to 7.5 and
   * bill 7.5, having advertised ten — so the caller paid for a clip they did
   * not ask for and were never told.
   *
   * The refusal has to land before the quote, because everything downstream of
   * the quote either spends money or writes a row. These assert the ordering
   * the same way the licence gate is asserted: by proving the money modules
   * were never reached at all.
   */
  const videoRequest = (durationSeconds: number) => ({
    operation: "text-to-video" as const,
    modelId: "replicate/video-gen",
    prompt: "a sports car on a coastal road",
    durationSeconds,
  });

  const motionOne = {
    id: "replicate/video-gen",
    modality: "VIDEO",
    creditCost: 90,
    capabilities: {
      operations: ["text-to-video"],
      durations: [5, 7.5],
      maxOutputs: 1,
      aspectRatios: ["16:9"],
    },
  };

  it("refuses ten seconds with a setting-specific code", async () => {
    findModel.mockReturnValue(motionOne);

    await expect(submitGeneration(videoRequest(10))).rejects.toMatchObject({
      status: 400,
      code: "model_setting_unavailable",
    });
  });

  it("names the lengths that are actually available", async () => {
    // So an integrator can correct their code rather than guess.
    findModel.mockReturnValue(motionOne);

    await expect(submitGeneration(videoRequest(10))).rejects.toThrow(/5, 7\.5/);
  });

  it("reserves no credits", async () => {
    findModel.mockReturnValue(motionOne);
    await submitGeneration(videoRequest(10)).catch(() => {});

    expect(reserveWithin).not.toHaveBeenCalled();
    expect(captureReservation).not.toHaveBeenCalled();
  });

  it("never reaches the quote", async () => {
    findModel.mockReturnValue(motionOne);
    await submitGeneration(videoRequest(10)).catch(() => {});

    expect(estimateCost).not.toHaveBeenCalled();
  });

  it("never submits to a provider", async () => {
    /**
     * `providerForModel` is a lookup and runs before this check, so asserting
     * it was not called would be asserting the wrong thing. What must never
     * happen is the submission itself.
     */
    findModel.mockReturnValue(motionOne);
    await submitGeneration(videoRequest(10)).catch(() => {});

    expect(providerSubmit).not.toHaveBeenCalled();
  });

  it("accepts the lengths the model does render", async () => {
    /**
     * Without this the suite would pass just as well if every duration were
     * refused, which is a safe API nobody can use. Both get past the length
     * check and fail later, on the mocked-away plumbing.
     */
    findModel.mockReturnValue(motionOne);

    for (const seconds of [5, 7.5]) {
      await expect(
        submitGeneration(videoRequest(seconds)),
      ).rejects.not.toMatchObject({ code: "model_setting_unavailable" });
    }
  });
});

describe("an impossible output count costs nothing", () => {
  /**
   * `Math.min(Math.max(1, requested), maxOutputs)` was the same defect as the
   * duration snap wearing different arithmetic. A caller asking a one-output
   * model for four received one and was billed for one; `0` and `-3` became
   * `1`; and `2.5` passed straight through as a fractional count that then
   * priced a fractional job.
   */
  const imageRequest = (outputs?: number) => ({
    operation: "text-to-image" as const,
    modelId: "replicate/flux-schnell",
    prompt: "a lighthouse at dusk",
    ...(outputs === undefined ? {} : { outputs }),
  });

  const fourUp = {
    id: "replicate/flux-schnell",
    modality: "IMAGE",
    creditCost: 4,
    capabilities: {
      operations: ["text-to-image"],
      maxOutputs: 4,
      aspectRatios: ["1:1"],
    },
  };

  const singleOnly = {
    ...fourUp,
    capabilities: { ...fourUp.capabilities, maxOutputs: 1 },
  };

  it("accepts a count the model supports", async () => {
    findModel.mockReturnValue(fourUp);

    for (const outputs of [1, 2, 4]) {
      await expect(
        submitGeneration(imageRequest(outputs)),
      ).rejects.not.toMatchObject({ code: "model_setting_unavailable" });
    }
  });

  it("refuses more than the model can produce", async () => {
    findModel.mockReturnValue(fourUp);

    await expect(submitGeneration(imageRequest(5))).rejects.toMatchObject({
      status: 400,
      code: "model_setting_unavailable",
    });
  });

  it("refuses a fractional count", async () => {
    // Used to pass through and price a fraction of a job.
    findModel.mockReturnValue(fourUp);

    await expect(submitGeneration(imageRequest(2.5))).rejects.toMatchObject({
      code: "model_setting_unavailable",
    });
  });

  it("refuses zero and negative counts", async () => {
    findModel.mockReturnValue(fourUp);

    for (const outputs of [0, -3]) {
      await expect(
        submitGeneration(imageRequest(outputs)),
      ).rejects.toMatchObject({ code: "model_setting_unavailable" });
    }
  });

  it("names the range without naming a provider", async () => {
    findModel.mockReturnValue(fourUp);

    await expect(submitGeneration(imageRequest(9))).rejects.toThrow(
      /between 1 and 4/,
    );
    await expect(submitGeneration(imageRequest(9))).rejects.not.toThrow(
      /replicate|flux/i,
    );
  });

  it("says so plainly when a model produces one output only", async () => {
    findModel.mockReturnValue(singleOnly);

    await expect(submitGeneration(imageRequest(2))).rejects.toThrow(
      /single output/i,
    );
  });

  it("defaults to one when none is given", async () => {
    // The documented default, and the cheapest valid count.
    findModel.mockReturnValue(fourUp);

    await expect(
      submitGeneration(imageRequest(undefined)),
    ).rejects.not.toMatchObject({ code: "model_setting_unavailable" });
  });

  it("moves no credits and submits nothing for an invalid count", async () => {
    findModel.mockReturnValue(fourUp);
    await submitGeneration(imageRequest(9)).catch(() => {});

    expect(estimateCost).not.toHaveBeenCalled();
    expect(reserveWithin).not.toHaveBeenCalled();
    expect(captureReservation).not.toHaveBeenCalled();
    expect(providerSubmit).not.toHaveBeenCalled();
  });
});
