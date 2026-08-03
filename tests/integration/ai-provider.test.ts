import { afterEach, describe, expect, it, vi } from "vitest";

import { mockProvider } from "@/services/ai/providers/mock";
import {
  findModel,
  isUsingMockProvider,
  listModels,
  listModelsForOperation,
  providerForModel,
} from "@/services/ai/registry";

/**
 * The provider abstraction.
 *
 * Two properties matter more than any individual adapter:
 *
 *   1. The mock is offered **alone or not at all**. If it ever appeared beside
 *      real models a user could pick it by accident and be handed a placeholder
 *      image they paid credits for.
 *   2. Every model resolves to a provider that owns it. A model in the catalogue
 *      with no adapter is a generation that debits and then fails.
 *
 * These tests run with no provider keys set, which is this environment's real
 * state — so they exercise the mock-fallback path exactly as deployed.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("registry fallback", () => {
  it("reports the mock provider when nothing real is configured", () => {
    expect(isUsingMockProvider()).toBe(true);
  });

  it("offers the mock's models and nothing else", () => {
    // The invariant: mock alone, never mixed.
    const models = listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.providerId === "mock")).toBe(true);
  });

  it("resolves every listed model to a provider that owns it", () => {
    for (const model of listModels()) {
      const provider = providerForModel(model.id);
      expect(provider, model.id).not.toBeNull();
      expect(provider?.id, model.id).toBe(model.providerId);
    }
  });

  it("returns null for an unknown model rather than guessing", () => {
    expect(findModel("no/such-model")).toBeNull();
    expect(providerForModel("no/such-model")).toBeNull();
  });
});

describe("capability filtering", () => {
  it("only returns models that declare the operation", () => {
    for (const operation of ["text-to-image", "upscale"] as const) {
      for (const model of listModelsForOperation(operation)) {
        expect(
          model.capabilities.operations,
          `${model.id} offered for ${operation}`,
        ).toContain(operation);
      }
    }
  });

  it("returns an empty list for an operation nothing supports", () => {
    // Audio has no adapter. The registry must return nothing rather than
    // offering an image model that would fail at submit.
    expect(listModelsForOperation("text-to-audio" as never)).toHaveLength(0);
  });
});

describe("the mock provider contract", () => {
  it("is always configured — it is the fallback", () => {
    expect(mockProvider.isConfigured()).toBe(true);
  });

  it("declares itself as a mock in its display name", () => {
    // The interface tells the user their output is not AI-generated. That
    // promise starts here.
    expect(mockProvider.displayName.toLowerCase()).toContain("mock");
  });

  it("lists at least one model per modality it claims", () => {
    const models = mockProvider.listModels();
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.capabilities.operations.length, model.id).toBeGreaterThan(0);
      expect(model.creditCost, model.id).toBeGreaterThan(0);
    }
  });

  it("returns a job id from submit", async () => {
    // `Math.random` is stubbed above the simulated-failure threshold so this
    // exercises the success path deterministically.
    vi.spyOn(Math, "random").mockReturnValue(0.99);

    const model = mockProvider.listModels()[0];
    const result = await mockProvider.submit({
      model,
      operation: "text-to-image",
      prompt: "a cat",
      outputs: 1,
    } as never);

    expect(result.providerJobId).toMatch(/^mock_/);
    vi.mocked(Math.random).mockRestore();
  });

  it("throws a retryable ProviderError on its simulated failure", async () => {
    // Below the failure threshold. The pipeline's refund path depends on this
    // being a structured, retryable error rather than a bare throw.
    vi.spyOn(Math, "random").mockReturnValue(0);

    const model = mockProvider.listModels()[0];
    await expect(
      mockProvider.submit({
        model,
        operation: "text-to-image",
        prompt: "a cat",
        outputs: 1,
      } as never),
    ).rejects.toMatchObject({ retryable: true });

    vi.mocked(Math.random).mockRestore();
  });
});
