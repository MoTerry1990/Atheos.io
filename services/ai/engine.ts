import "server-only";

import { estimateCost } from "@/services/ai/cost";
import { healthSnapshot, isAvailable } from "@/services/ai/health";
import {
  ProviderUnavailableError,
  pollWithHealth,
  resolve,
  submitWithResilience,
} from "@/services/ai/manager";
import { findModel, listModelsForOperation } from "@/services/ai/registry";
import type {
  GenerationJob,
  GenerationOperation,
  GenerationRequest,
  ProviderModel,
} from "@/services/ai/types";

/**
 * The engine's public surface.
 *
 * ## Why these functions live here and not on `AIProvider`
 *
 * Sprint 19 asks for `generateImage`, `generateVideo`, `generateAudio`,
 * `generateText`, `uploadAsset`, `getStatus`, `cancelGeneration` and
 * `estimateCost` — and, twice, that the provider interface not change.
 *
 * Those two requirements are only compatible one way round. Putting eight
 * methods on `AIProvider` would change the interface and force every adapter to
 * stub the six its vendor does not do — which is the exact "five-method
 * interface" mistake `types.ts` was written to avoid, and the reason operations
 * are a *field* on one request rather than separate methods.
 *
 * So the eight are here: an **engine-level facade**. `AIProvider` is untouched.
 * Each function is a named entry point that builds a `GenerationRequest` with
 * the right operation and hands it to the Provider Manager, which owns
 * selection, health, retry and fallback.
 *
 * That is also the architecture AI_ENGINE.md already described — users never
 * touch a provider, they talk to the engine — so this makes the documented
 * boundary real rather than implied.
 *
 * ## Everything returns the same shape
 *
 * `EngineResult` regardless of modality or provider. A caller switching from
 * image to video changes one function name and nothing else.
 */

export interface EngineResult {
  job: GenerationJob;
  /** The model that actually ran — differs from the request on a fallback. */
  model: ProviderModel;
  /** True when the manager failed over. Surface this to the user. */
  fellBack: boolean;
  /** What the caller originally asked for, when it differs. */
  requestedModelId: string;
  /** Every provider tried, with the error each returned. */
  attempts: readonly {
    providerId: string;
    modelId: string;
    error?: { code: string; message: string };
  }[];
  /** Provider cost in micro-USD. Null when the model has no cost basis. */
  costMicroUsd: number | null;
  creditsCharged: number;
}

export interface GenerateOptions {
  modelId?: string;
  negativePrompt?: string;
  aspectRatio?: string;
  seed?: number;
  outputs?: number;
  inputImageUrls?: readonly string[];
  inputStrength?: number;
  scale?: number;
  durationSeconds?: number;
  cameraMotion?: string;
  /** Off by default — falling back runs a different model. */
  allowFallback?: boolean;
}

export class UnsupportedOperationError extends Error {
  readonly status = 400;
  readonly code = "unsupported_operation";

  constructor(message: string) {
    super(message);
    this.name = "UnsupportedOperationError";
  }
}

/**
 * Pick a model for an operation when the caller did not name one.
 *
 * Cheapest first. A caller that did not express a preference should not be
 * charged as though they had asked for the most expensive option, and the
 * studio always names a model explicitly — so this path is for programmatic
 * callers, where "sensible and cheap" is the right default.
 */
function defaultModelFor(operation: GenerationOperation): ProviderModel {
  const candidates = listModelsForOperation(operation)
    .filter((model) => isAvailable(model.providerId))
    .sort((a, b) => a.creditCost - b.creditCost);

  const chosen = candidates[0];
  if (!chosen) {
    throw new UnsupportedOperationError(
      `No available provider supports ${operation}.`,
    );
  }

  return chosen;
}

async function run(
  operation: GenerationOperation,
  prompt: string,
  options: GenerateOptions,
): Promise<EngineResult> {
  const model = options.modelId
    ? (findModel(options.modelId) ??
      (() => {
        throw new UnsupportedOperationError("That model is not available.");
      })())
    : defaultModelFor(operation);

  if (!model.capabilities.operations.includes(operation)) {
    throw new UnsupportedOperationError(
      `${model.displayName} cannot perform ${operation}.`,
    );
  }

  const request: GenerationRequest = {
    operation,
    modelId: model.id,
    prompt,
    negativePrompt: options.negativePrompt,
    aspectRatio: options.aspectRatio,
    seed: options.seed,
    outputs: options.outputs,
    inputImageUrls: options.inputImageUrls,
    inputStrength: options.inputStrength,
    scale: options.scale,
    durationSeconds: options.durationSeconds,
    cameraMotion: options.cameraMotion,
  };

  const outcome = await submitWithResilience(request, {
    allowFallback: options.allowFallback,
  });

  const cost = estimateCost(outcome.model, options.outputs ?? 1, {
    durationSeconds: options.durationSeconds,
  });

  return {
    job: outcome.job,
    model: outcome.model,
    fellBack: outcome.fellBack,
    requestedModelId: model.id,
    attempts: outcome.attempts.map((attempt) => ({
      providerId: attempt.providerId,
      modelId: attempt.modelId,
      ...(attempt.error
        ? {
            error: {
              code: attempt.error.code,
              message: attempt.error.message,
            },
          }
        : {}),
    })),
    costMicroUsd: cost.costMicroUsd,
    creditsCharged: cost.credits,
  };
}

// ---------------------------------------------------------------- surface ---

/** Text to image, or image to image when `inputImageUrls` is supplied. */
export function generateImage(
  prompt: string,
  options: GenerateOptions = {},
): Promise<EngineResult> {
  const operation: GenerationOperation = options.inputImageUrls?.length
    ? "image-to-image"
    : "text-to-image";

  return run(operation, prompt, options);
}

/** Text to video, or image to video when a first frame is supplied. */
export function generateVideo(
  prompt: string,
  options: GenerateOptions = {},
): Promise<EngineResult> {
  const operation: GenerationOperation = options.inputImageUrls?.length
    ? "image-to-video"
    : "text-to-video";

  return run(operation, prompt, options);
}

/**
 * Audio generation.
 *
 * **Not implemented, and it fails loudly rather than silently.**
 *
 * `Modality.AUDIO` exists in the schema and two voice packs sit in the
 * marketplace marked unusable, but no adapter generates audio. Returning a
 * rejected promise with a clear code is the honest shape: a caller finds out at
 * the call site, and the moment an audio adapter registers, this becomes a
 * one-line delegation to `run` with no signature change.
 */
export function generateAudio(): Promise<EngineResult> {
  return Promise.reject(
    new UnsupportedOperationError(
      "Audio generation is not available yet — no provider implements it.",
    ),
  );
}

/**
 * Text and vision.
 *
 * Deliberately **not** routed through `run`. Text is not a generation in this
 * product's sense: it debits no credits, produces no asset, and has no job to
 * poll. Forcing it through the image pipeline would give it a `Generation` row,
 * a credit debit and a queue entry it has no business having.
 *
 * It stays unimplemented until there is a caller. Anthropic and Gemini are
 * catalogued as `multimodal` precisely so this can be added without touching
 * the generation path.
 */
export function generateText(): Promise<never> {
  return Promise.reject(
    new UnsupportedOperationError(
      "Text generation is not exposed — no feature consumes it yet.",
    ),
  );
}

/**
 * Make a user's file reachable by a provider.
 *
 * Providers fetch inputs by URL; none of them accept our bytes directly. So the
 * "upload" is to **our** storage, and the provider is handed the resulting URL.
 * That is not a workaround — it is why `GenerationRequest` takes
 * `inputImageUrls` rather than buffers.
 *
 * Implemented in `services/storage/assets.ts` and exposed here so the engine's
 * surface is complete. Kept as a re-export rather than a reimplementation: two
 * upload paths is two sets of size and type checks to keep in agreement, and
 * Sprint 15 hardened exactly one of them.
 */
export { storeUploadedAsset as uploadAsset } from "@/services/storage/assets";

/**
 * Poll a job.
 *
 * `providerId` as well as the job id because a job id is only unique within a
 * provider, and after a fallback the provider running the job is not the one
 * the caller asked for.
 */
export function getStatus(
  providerId: string,
  providerJobId: string,
): Promise<GenerationJob> {
  return pollWithHealth(providerId, providerJobId);
}

/**
 * Best-effort cancellation.
 *
 * Resolves rather than throwing when a provider does not support cancelling —
 * `cancel` is optional on `AIProvider` for that reason. A caller should not
 * need a special case for "this vendor cannot stop a job", and a user who
 * pressed cancel is served better by the job being abandoned locally than by an
 * error about vendor capabilities.
 */
export async function cancelGeneration(
  providerId: string,
  providerJobId: string,
): Promise<{ requested: boolean }> {
  const model = listModelsForOperation("text-to-image").find(
    (m) => m.providerId === providerId,
  );

  const target = model ? resolve(model.id) : null;
  if (!target?.provider.cancel) return { requested: false };

  try {
    await target.provider.cancel(providerJobId);
    return { requested: true };
  } catch (error) {
    // A failed cancellation is not a failed generation. Logged, not surfaced.
    console.warn(
      `[ai] cancel failed for ${providerId}/${providerJobId}`,
      error,
    );
    return { requested: false };
  }
}

/** What a request will cost us, and what we will charge, before running it. */
export function estimateGenerationCost(
  modelId: string,
  outputs = 1,
  durationSeconds?: number,
) {
  const model = findModel(modelId);
  if (!model) {
    throw new UnsupportedOperationError("That model is not available.");
  }

  return estimateCost(model, outputs, { durationSeconds });
}

/** Health of every provider the process has observed. For the admin page. */
export function providerHealth() {
  return healthSnapshot();
}

export { ProviderUnavailableError };
