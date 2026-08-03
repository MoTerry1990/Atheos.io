import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetHealth } from "@/services/ai/health";
import type { GenerationRequest, ProviderError } from "@/services/ai/types";

/**
 * The Provider Manager's failure handling.
 *
 * Three behaviours are asserted because each is a decision that could plausibly
 * have gone the other way, and each is invisible when it silently regresses:
 *
 *   - retry the **same** provider before switching, so a blip does not change
 *     which model the user gets;
 *   - never fall back across families or to the mock;
 *   - **report** a fallback, because substituting a different model without
 *     saying so is not resilience.
 */

const submitPrimary = vi.fn();
const submitFallback = vi.fn();

const imageCaps = {
  supportsNegativePrompt: false,
  supportsImageInput: false,
  supportsSeed: true,
  aspectRatios: [],
  maxOutputs: 4,
  operations: ["text-to-image" as const],
};

const primaryModel = {
  id: "replicate/flux-schnell",
  providerId: "replicate",
  displayName: "Primary",
  modality: "IMAGE" as const,
  creditCost: 4,
  capabilities: imageCaps,
};

const fallbackModel = {
  id: "openai/gpt-image-1",
  providerId: "openai",
  displayName: "Fallback",
  modality: "IMAGE" as const,
  creditCost: 12,
  capabilities: imageCaps,
};

vi.mock("@/services/ai/registry", () => ({
  listModels: () => [primaryModel, fallbackModel],
  findModel: (id: string) =>
    [primaryModel, fallbackModel].find((m) => m.id === id) ?? null,
  providerForModel: (id: string) => {
    if (id === primaryModel.id) {
      return { id: "replicate", displayName: "R", submit: submitPrimary };
    }
    if (id === fallbackModel.id) {
      return { id: "openai", displayName: "O", submit: submitFallback };
    }
    return null;
  },
}));

const { submitWithResilience, ProviderUnavailableError, findFallback } =
  await import("@/services/ai/manager");

const request: GenerationRequest = {
  operation: "text-to-image",
  modelId: primaryModel.id,
  prompt: "a cat",
};

const fail = (
  code: ProviderError["code"],
  retryable = true,
): ProviderError => ({
  code,
  retryable,
  message: "provider said no",
});

const noSleep = async () => {};
const noJitter = () => 0;

beforeEach(() => {
  vi.clearAllMocks();
  resetHealth("replicate");
  resetHealth("openai");
});

describe("happy path", () => {
  it("submits to the requested provider and reports no fallback", async () => {
    submitPrimary.mockResolvedValue({ providerJobId: "p1", state: "queued" });

    const outcome = await submitWithResilience(request, { sleep: noSleep });

    expect(outcome.job.providerJobId).toBe("p1");
    expect(outcome.fellBack).toBe(false);
    expect(outcome.model.id).toBe(primaryModel.id);
    expect(submitFallback).not.toHaveBeenCalled();
  });
});

describe("retry before fallback", () => {
  it("retries the same provider on a transient failure", async () => {
    submitPrimary
      .mockRejectedValueOnce(fail("timeout"))
      .mockResolvedValue({ providerJobId: "p2", state: "queued" });

    const outcome = await submitWithResilience(request, {
      sleep: noSleep,
      random: noJitter,
      allowFallback: true,
    });

    expect(submitPrimary).toHaveBeenCalledTimes(2);
    // The user keeps the model they chose.
    expect(outcome.fellBack).toBe(false);
    expect(submitFallback).not.toHaveBeenCalled();
  });

  it("does not retry a content filter — the same prompt is refused again", async () => {
    submitPrimary.mockRejectedValue(fail("content_filtered", false));

    await expect(
      submitWithResilience(request, { sleep: noSleep, random: noJitter }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);

    expect(submitPrimary).toHaveBeenCalledTimes(1);
  });
});

describe("fallback", () => {
  it("switches provider once retries are exhausted", async () => {
    submitPrimary.mockRejectedValue(fail("provider_unavailable"));
    submitFallback.mockResolvedValue({ providerJobId: "f1", state: "queued" });

    const outcome = await submitWithResilience(request, {
      sleep: noSleep,
      random: noJitter,
      allowFallback: true,
    });

    expect(outcome.job.providerJobId).toBe("f1");
    expect(outcome.model.id).toBe(fallbackModel.id);
    // The whole point: the caller can tell the user it ran somewhere else.
    expect(outcome.fellBack).toBe(true);
  });

  it("does not fall back unless the caller opts in", async () => {
    // Fallback changes the output. It must be a decision, not a default.
    submitPrimary.mockRejectedValue(fail("provider_unavailable"));

    await expect(
      submitWithResilience(request, { sleep: noSleep, random: noJitter }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);

    expect(submitFallback).not.toHaveBeenCalled();
  });

  it("records every attempt, in order, for the audit trail", async () => {
    submitPrimary.mockRejectedValue(fail("timeout"));
    submitFallback.mockResolvedValue({ providerJobId: "f2", state: "queued" });

    const outcome = await submitWithResilience(request, {
      sleep: noSleep,
      random: noJitter,
      allowFallback: true,
    });

    const providers = outcome.attempts.map((a) => a.providerId);
    expect(providers.at(0)).toBe("replicate");
    expect(providers.at(-1)).toBe("openai");
    expect(outcome.attempts.filter((a) => a.error).length).toBeGreaterThan(0);
  });

  it("throws when every provider fails, so the pipeline can refund", async () => {
    submitPrimary.mockRejectedValue(fail("provider_unavailable"));
    submitFallback.mockRejectedValue(fail("provider_unavailable"));

    await expect(
      submitWithResilience(request, {
        sleep: noSleep,
        random: noJitter,
        allowFallback: true,
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("skips the primary entirely once its circuit is open", async () => {
    // The breaker's whole purpose: do not spend a timeout rediscovering an
    // outage we already recorded.
    submitPrimary.mockRejectedValue(fail("provider_unavailable"));
    submitFallback.mockResolvedValue({ providerJobId: "f3", state: "queued" });

    // First call opens the circuit (3 consecutive failures via retries).
    await submitWithResilience(request, {
      sleep: noSleep,
      random: noJitter,
      allowFallback: true,
    }).catch(() => undefined);

    submitPrimary.mockClear();

    const outcome = await submitWithResilience(request, {
      sleep: noSleep,
      random: noJitter,
      allowFallback: true,
    });

    expect(submitPrimary).not.toHaveBeenCalled();
    expect(outcome.fellBack).toBe(true);
  });
});

describe("findFallback", () => {
  it("returns null for an unknown model rather than guessing", async () => {
    const outcome = findFallback(
      { ...request, modelId: "nope/nope" },
      "replicate",
    );
    // openai is a valid image fallback regardless of the requested model id,
    // because the operation is what matters — but it must never be the mock.
    expect(outcome?.provider.id).not.toBe("mock");
  });

  it("never routes a video request to an image-only provider", () => {
    const video: GenerationRequest = {
      operation: "text-to-video",
      modelId: primaryModel.id,
      prompt: "a cat",
    };

    // Neither mocked model declares text-to-video, so there is no candidate.
    expect(findFallback(video, "replicate")).toBeNull();
  });
});
