import { ApiError, request, upload } from "@/lib/http";
import type { GenerationDTO } from "@/features/studio/lib/dto";
import type { CreativeBrief } from "@/services/ai/creative-brief";
import type { ImageBrief } from "@/services/ai/image-brief";
import type { ProviderModel } from "@/services/ai/types";

export { ApiError };

/**
 * The studio's client for the generation API.
 *
 * Thin on purpose. Its whole job is to turn HTTP into either a value or a
 * thrown `ApiError` with a message safe to show — so components never touch
 * `response.ok`, and error handling is written once instead of at every call
 * site.
 */

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
  durationSeconds?: number;
  cameraMotion?: string;
  parentId?: string;
  collectionId?: string;
  /**
   * Creative Director. When the feature is on, the server *requires* these and
   * overrides `prompt` with its own recompilation — so the prompt above becomes
   * a record of what the composer showed rather than what the provider gets.
   *
   * `confirmedBrief` is the planning response's brief, unmodified: the token
   * carries its hash, and any edit here is a rejected submission rather than a
   * silently different video.
   */
  /** Owned asset id for "animate this". Never a URL. */
  sourceAssetId?: string;
  planToken?: string;
  confirmedBrief?: CreativeBrief | ImageBrief;
  planConfirmed?: boolean;
  /** Distinguishes a deliberate re-run from a double-click on the same plan. */
  clientIdempotencyKey?: string;
}

export function submitGeneration(payload: SubmitPayload) {
  return request<{ generationId: string; usingMockProvider: boolean }>(
    "/api/generations",
    { method: "POST", body: JSON.stringify(payload) },
  );
}

/**
 * Upload a reference image and get back a URL the provider can fetch.
 *
 * Uses `upload()` rather than `request()`: that one sets a JSON content type,
 * and a multipart body must be allowed to set its own boundary. Sending
 * `FormData` with an explicit Content-Type is the classic way to make an upload
 * fail with a parse error on the server.
 */
export function uploadReference(
  file: File,
  signal?: AbortSignal,
): Promise<{ assetId: string; storageKey: string; url: string }> {
  const body = new FormData();
  body.append("file", file);

  return upload("/api/uploads", body, signal);
}

/**
 * Expand a short idea into a fuller prompt.
 *
 * Always resolves — the endpoint returns the original text with
 * `changed: false` when the model is unavailable, rather than an error status,
 * because a failed assist must not put an error banner over a prompt the user
 * can still submit.
 */
export function enhancePrompt(prompt: string, modality: "image" | "video") {
  return request<{ prompt: string; changed: boolean }>("/api/ai/enhance", {
    method: "POST",
    body: JSON.stringify({ prompt, modality }),
  });
}

export function pollGeneration(id: string) {
  return request<{ generation: GenerationDTO }>(`/api/generations/${id}`);
}

export function cancelGeneration(id: string) {
  return request<{ status: string }>(`/api/generations/${id}`, {
    method: "DELETE",
  });
}

export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  assetCount: number;
  updatedAt: number;
}

export function listCollections() {
  return request<{ collections: CollectionSummary[] }>("/api/collections");
}

export function createCollection(name: string) {
  return request<{ collection: CollectionSummary }>("/api/collections", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function saveToCollection(collectionId: string, assetIds: string[]) {
  return request<{ added: number; assetCount: number }>(
    `/api/collections/${collectionId}/assets`,
    { method: "POST", body: JSON.stringify({ assetIds }) },
  );
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
  // Fifteen minutes, up from five. A video model routinely runs for two or
  // three, and a queue backed up behind other work runs for longer; the old
  // ceiling would have given up on jobs that were still perfectly healthy and
  // told the user something untrue about them.
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
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
