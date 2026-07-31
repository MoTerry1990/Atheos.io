import "server-only";

import { mockProvider } from "@/services/ai/providers/mock";
import { openaiProvider } from "@/services/ai/providers/openai";
import { replicateProvider } from "@/services/ai/providers/replicate";
import type {
  AIProvider,
  GenerationOperation,
  ProviderModel,
} from "@/services/ai/types";

/**
 * The provider registry.
 *
 * The one place that knows which vendors exist. Everything else asks for a
 * model or an operation and receives an adapter — which is what makes "add a
 * provider" a matter of writing one file and adding one line here.
 *
 * ## Selection is driven by configuration, not by code
 *
 * A provider is offered only when `isConfigured()` is true, which means when
 * its credentials are present. Adding a `REPLICATE_API_TOKEN` to an
 * environment makes Replicate's models appear with no deploy and no flag.
 *
 * ## The mock is a fallback, never a peer
 *
 * When no real provider is configured, the mock is offered so the studio,
 * the pipeline, the ledger and the error paths can all still be exercised.
 * The moment a real provider is configured, the mock disappears entirely —
 * it must never sit alongside real models where a user could pick it by
 * accident.
 *
 * `isUsingMockProvider()` exists so the interface can say so out loud.
 */

/** Real providers, in preference order. */
const REAL_PROVIDERS: AIProvider[] = [replicateProvider, openaiProvider];

function configuredProviders(): AIProvider[] {
  const configured = REAL_PROVIDERS.filter((provider) =>
    provider.isConfigured(),
  );
  return configured.length > 0 ? configured : [mockProvider];
}

/** True when nothing real is configured and the mock is standing in. */
export function isUsingMockProvider(): boolean {
  return !REAL_PROVIDERS.some((provider) => provider.isConfigured());
}

/** Every model available right now, across configured providers. */
export function listModels(): ProviderModel[] {
  return configuredProviders().flatMap((provider) => provider.listModels());
}

/** Models that can perform a given operation. */
export function listModelsForOperation(
  operation: GenerationOperation,
): ProviderModel[] {
  return listModels().filter((model) =>
    model.capabilities.operations.includes(operation),
  );
}

export function findModel(modelId: string): ProviderModel | null {
  return listModels().find((model) => model.id === modelId) ?? null;
}

/**
 * The adapter that owns a model.
 *
 * Returns null rather than throwing so callers can produce a domain error with
 * their own context — a route wants a 400, the pipeline wants to refund.
 */
export function providerForModel(modelId: string): AIProvider | null {
  const model = findModel(modelId);
  if (!model) return null;
  return (
    configuredProviders().find(
      (provider) => provider.id === model.providerId,
    ) ?? null
  );
}

export function providerById(providerId: string): AIProvider | null {
  return (
    configuredProviders().find((provider) => provider.id === providerId) ?? null
  );
}

/** Credits a request will cost. Priced by us, per output. */
export function priceFor(modelId: string, outputs: number): number {
  const model = findModel(modelId);
  if (!model) return 0;
  // Upscale and background removal always produce one image regardless of what
  // was asked for, so charging per requested output would overcharge.
  return model.creditCost * Math.max(1, outputs);
}
