import "server-only";

import {
  type ProviderFamily,
  describeProvider,
  fallbackCandidates,
} from "@/services/ai/catalogue";
import {
  isAvailable,
  recordFailure,
  recordSuccess,
} from "@/services/ai/health";
import {
  findModel,
  listModels,
  providerForModel,
} from "@/services/ai/registry";
import { nextAttempt } from "@/services/ai/retry";
import type {
  AIProvider,
  GenerationJob,
  GenerationRequest,
  ProviderError,
  ProviderModel,
} from "@/services/ai/types";
import { VIDEO_OPERATIONS } from "@/services/ai/types";

/**
 * The Provider Manager.
 *
 * ## What it is for
 *
 * `registry.ts` answers "which adapter owns this model". That was enough while
 * there were two providers and no failure handling. It is not enough now: a
 * request needs to know whether the provider is *healthy*, what to do when it
 * fails, and where to go instead.
 *
 * This is the only place those three decisions are made together, and it is the
 * only thing `services/generation.ts` needs to talk to.
 *
 * ## The order of operations, and why
 *
 *   1. **Resolve** the model to its provider.
 *   2. **Check health.** An open circuit means do not even try — fall back
 *      immediately rather than spending a timeout discovering what we know.
 *   3. **Submit.** On success, record it (which closes a half-open circuit).
 *   4. **On failure**, classify:
 *      - retryable → back off and try the *same* provider again;
 *      - exhausted or not retryable → try a *different* provider;
 *      - nothing left → surface the error so the pipeline can refund.
 *
 * Retry-then-fallback, in that order, is deliberate. A transient blip resolves
 * on the same provider with the model the user actually chose. Switching
 * vendors on the first hiccup would silently change what they get.
 *
 * ## Fallback changes the model, and that is a product decision
 *
 * There is no such thing as the same model on another vendor. Falling back
 * means running a *different* model, which will produce a different image. The
 * manager therefore:
 *
 *   - never falls back across families (a video request cannot land on an
 *     image-only vendor);
 *   - never falls back to the mock, which would hand someone a placeholder they
 *     paid for;
 *   - **reports what it did** in the result, so the interface can tell the user
 *     their generation ran somewhere else rather than quietly substituting.
 *
 * A fallback the user is not told about is not a resilience feature, it is a
 * substitution they did not agree to.
 */

export interface ResolvedProvider {
  provider: AIProvider;
  model: ProviderModel;
}

export interface SubmitOutcome {
  job: GenerationJob;
  /** The model that actually ran. Differs from the request on a fallback. */
  model: ProviderModel;
  /**
   * Milliseconds the accepted `submit` call took.
   *
   * Measured **here**, from outside the adapter, because `GenerationJob` has no
   * field for it and this sprint forbids changing the provider interface. That
   * turned out to be the better place anyway: timing from the manager measures
   * what the caller actually waited for, including anything the adapter does
   * before and after its HTTP call.
   *
   * Only the successful attempt is timed. A failed attempt's duration is not
   * latency, it is a timeout.
   */
  latencyMs: number;
  /** True when this is not the model the caller asked for. */
  fellBack: boolean;
  /** Every provider tried, in order. For the audit trail and for support. */
  attempts: readonly {
    providerId: string;
    modelId: string;
    error?: ProviderError;
  }[];
}

export class ProviderUnavailableError extends Error {
  readonly status = 503;
  readonly code = "provider_unavailable";

  constructor(
    message: string,
    readonly attempts: SubmitOutcome["attempts"],
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

function familyFor(request: GenerationRequest): ProviderFamily {
  return VIDEO_OPERATIONS.has(request.operation) ? "video" : "image";
}

/** Resolve a model id to the adapter that owns it, or null. */
export function resolve(modelId: string): ResolvedProvider | null {
  const model = findModel(modelId);
  if (!model) return null;

  const provider = providerForModel(modelId);
  if (!provider) return null;

  return { provider, model };
}

/**
 * The best equivalent model on another provider.
 *
 * "Equivalent" is defined narrowly: same family, declares the same operation,
 * provider is implemented and currently healthy. Ordered by the catalogue's
 * priority, so the choice is a stated preference rather than whatever the
 * registry happened to list first.
 */
export function findFallback(
  request: GenerationRequest,
  exclude: string,
): ResolvedProvider | null {
  const family = familyFor(request);

  for (const candidate of fallbackCandidates(family, exclude)) {
    if (!isAvailable(candidate.id)) continue;

    const model = listModels().find(
      (m) =>
        m.providerId === candidate.id &&
        m.capabilities.operations.includes(request.operation),
    );

    if (!model) continue;

    const provider = providerForModel(model.id);
    if (provider) return { provider, model };
  }

  return null;
}

function asProviderError(error: unknown): ProviderError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "retryable" in error
  ) {
    return error as ProviderError;
  }

  return {
    code: "unknown",
    retryable: true,
    message: "The provider failed in a way we did not recognise.",
    raw: error,
  };
}

export interface SubmitOptions {
  /** Off by default. Callers opt in, because fallback changes the output. */
  allowFallback?: boolean;
  /** Injected so tests do not actually wait out a backoff. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Submit, with retry against the chosen provider and optional fallback.
 *
 * Throws `ProviderUnavailableError` when every avenue is exhausted. The caller
 * — `services/generation.ts` — is responsible for the refund, because only it
 * knows whether credits were debited yet.
 */
export async function submitWithResilience(
  request: GenerationRequest,
  options: SubmitOptions = {},
): Promise<SubmitOutcome> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const attempts: SubmitOutcome["attempts"][number][] = [];

  const primary = resolve(request.modelId);
  if (!primary) {
    throw new ProviderUnavailableError(
      "That model is not available.",
      attempts,
    );
  }

  const tryProvider = async (
    target: ResolvedProvider,
    isFallback: boolean,
  ): Promise<SubmitOutcome | ProviderError> => {
    let failures = 0;

    for (;;) {
      try {
        const startedAt = Date.now();
        const job = await target.provider.submit({
          ...request,
          modelId: target.model.id,
        });
        const latencyMs = Date.now() - startedAt;

        recordSuccess(target.provider.id);
        attempts.push({
          providerId: target.provider.id,
          modelId: target.model.id,
        });

        return {
          job,
          model: target.model,
          fellBack: isFallback,
          attempts,
          latencyMs,
        };
      } catch (raw) {
        const error = asProviderError(raw);

        recordFailure(target.provider.id, error);
        attempts.push({
          providerId: target.provider.id,
          modelId: target.model.id,
          error,
        });

        const next = nextAttempt(error, failures, random);
        if (!next) return error;

        failures = next.attempt;
        await sleep(next.delayMs);
      }
    }
  };

  // The circuit is checked before the first attempt, not after a failure.
  // Spending a timeout to rediscover an outage we already recorded is the exact
  // cost the breaker exists to avoid.
  let lastError: ProviderError | null = null;

  if (isAvailable(primary.provider.id)) {
    const result = await tryProvider(primary, false);
    if ("job" in result) return result;
    lastError = result;
  } else {
    lastError = {
      code: "provider_unavailable",
      retryable: false,
      message: "That provider is temporarily unavailable.",
    };
    attempts.push({
      providerId: primary.provider.id,
      modelId: primary.model.id,
      error: lastError,
    });
  }

  if (options.allowFallback) {
    const fallback = findFallback(request, primary.provider.id);
    if (fallback) {
      const result = await tryProvider(fallback, true);
      if ("job" in result) return result;
      lastError = result;
    }
  }

  throw new ProviderUnavailableError(
    lastError?.message ?? "No provider could accept that request.",
    attempts,
  );
}

/**
 * Poll, recording health as a side effect.
 *
 * Polling is where a slow provider shows itself: submit can succeed and the job
 * then sit in `running` forever. A terminal failure here counts against the
 * breaker exactly as a failed submit does.
 */
export async function pollWithHealth(
  providerId: string,
  providerJobId: string,
): Promise<GenerationJob> {
  const descriptor = describeProvider(providerId);
  if (!descriptor) {
    throw new ProviderUnavailableError(`Unknown provider: ${providerId}`, []);
  }

  const model = listModels().find((m) => m.providerId === providerId);
  const provider = model ? providerForModel(model.id) : null;

  if (!provider) {
    throw new ProviderUnavailableError(
      `No adapter for provider: ${providerId}`,
      [],
    );
  }

  const job = await provider.poll(providerJobId);

  if (job.state === "succeeded") recordSuccess(providerId);
  else if (job.state === "failed" && job.error) {
    recordFailure(providerId, job.error);
  }

  return job;
}
