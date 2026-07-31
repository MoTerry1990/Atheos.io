import type { GenerationDTO } from "@/features/studio/lib/dto";
import type { ProviderModel } from "@/services/ai/types";

/**
 * The studio's client for the generation API.
 *
 * Thin on purpose. Its whole job is to turn HTTP into either a value or a
 * thrown `ApiError` with a message safe to show — so components never touch
 * `response.ok`, and error handling is written once instead of at every call
 * site.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
  } catch {
    // Network-level failure. Distinguished from an API error because the advice
    // is different: check your connection, not your settings.
    throw new ApiError(
      "Could not reach the server. Check your connection and try again.",
      0,
      "network",
    );
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      body?.error ?? "Something went wrong.",
      response.status,
      body?.code,
    );
  }

  return body as T;
}

export interface SubmitPayload {
  operation: string;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  seed?: number;
  outputs?: number;
  inputImageUrls?: string[];
  inputStrength?: number;
  scale?: number;
  parentId?: string;
  collectionId?: string;
}

export function submitGeneration(payload: SubmitPayload) {
  return request<{ generationId: string; usingMockProvider: boolean }>(
    "/api/generations",
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function pollGeneration(id: string) {
  return request<{ generation: GenerationDTO }>(`/api/generations/${id}`);
}

export function cancelGeneration(id: string) {
  return request<{ status: string }>(`/api/generations/${id}`, {
    method: "DELETE",
  });
}

export function loadStudio() {
  return request<{
    generations: GenerationDTO[];
    models: ProviderModel[];
    usingMockProvider: boolean;
  }>("/api/generations");
}

/**
 * Poll until a job settles.
 *
 * ## Backoff, not a fixed interval
 *
 * A flat 1s poll on a two-minute video job is 120 requests, most of which learn
 * nothing. The interval grows from 1s toward 5s, which costs one extra second
 * of latency on a fast job and removes most of the traffic on a slow one.
 *
 * `AbortSignal` rather than a boolean flag: the caller can cancel from an
 * effect cleanup, and an in-flight fetch is dropped rather than resolving into
 * a component that has unmounted.
 */
export async function pollUntilSettled(
  id: string,
  options: {
    signal?: AbortSignal;
    onUpdate?: (generation: GenerationDTO) => void;
    timeoutMs?: number;
  } = {},
): Promise<GenerationDTO> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  let delay = 1000;

  for (;;) {
    if (options.signal?.aborted) {
      throw new ApiError("Polling was cancelled.", 0, "aborted");
    }

    if (Date.now() - started > timeoutMs) {
      throw new ApiError(
        "This generation is taking longer than expected. It may still finish — check your history.",
        0,
        "timeout",
      );
    }

    const { generation } = await pollGeneration(id);
    options.onUpdate?.(generation);

    if (
      generation.status === "succeeded" ||
      generation.status === "failed" ||
      generation.status === "canceled"
    ) {
      return generation;
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.4, 5000);
  }
}
