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
