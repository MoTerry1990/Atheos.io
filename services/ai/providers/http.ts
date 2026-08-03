import "server-only";

import { checkRateLimit } from "@/lib/rate-limit";
import { providerError } from "@/services/ai/types";
import type { ProviderError, ProviderId } from "@/services/ai/types";

/**
 * The transport every provider adapter uses.
 *
 * ## Why this is shared rather than per-adapter
 *
 * Sprint 19 asks that every provider have timeout handling, error handling,
 * logging, rate limiting and usage tracking. Written per adapter that is eleven
 * copies of the same five concerns, and eleven chances to get the timeout wrong
 * in a way nobody notices until a serverless function is billed for 300 seconds
 * of waiting on a vendor that already gave up.
 *
 * Written once, an adapter only has to do the part that is genuinely
 * vendor-specific: build the request body, and map the vendor's error shape
 * onto a `ProviderErrorCode`.
 *
 * ## Timeouts are not optional and there is no default of "forever"
 *
 * `fetch` has no timeout. Without an `AbortSignal` a hung vendor connection
 * holds a function alive until the platform kills it — which on most platforms
 * is long after the user gave up and well after we have been billed. Every call
 * through here has a deadline.
 *
 * The deadline is on the **HTTP call**, not on the generation. A video model
 * legitimately takes minutes; that time is spent in `poll`, not holding a
 * request open. Submit and poll are both fast calls by design, which is what
 * makes a short timeout correct.
 *
 * ## Rate limiting is outbound here, which is the opposite of Sprint 15
 *
 * `lib/rate-limit.ts` protects *our* endpoints from callers. This protects
 * *vendors* from us — and protects us from the 429s and account suspensions
 * that follow. Same primitive, opposite direction, and the audit noted the
 * outbound half was missing.
 */

/** How long any single provider HTTP call may take. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Uploads are the exception: a reference image is real bytes over a slow link.
 * Still bounded — just further out.
 */
const UPLOAD_TIMEOUT_MS = 60_000;

export interface ProviderCallResult<T> {
  data: T;
  /** Round-trip milliseconds. Persisted as `Generation.latencyMs`. */
  latencyMs: number;
  /** Token usage, where the vendor reports it. Absent for image and video. */
  usage?: { promptTokens?: number; completionTokens?: number };
  status: number;
}

export interface ProviderCallOptions {
  providerId: ProviderId;
  /** Absolute URL. Adapters own their base path. */
  url: string;
  method?: "GET" | "POST" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /**
   * Maps a non-2xx response onto a normalised error.
   *
   * Required, not optional: the default mapping below is a fallback for shapes
   * the adapter did not anticipate, and an adapter that supplies nothing is an
   * adapter whose 400s all look like `unknown` to the retry policy.
   */
  mapError?: (status: number, body: unknown) => ProviderError | null;
  /** Pulls token usage out of a successful body, where the vendor reports it. */
  readUsage?: (body: unknown) => ProviderCallResult<unknown>["usage"];
}

/**
 * Status → normalised code, for shapes an adapter did not map.
 *
 * Deliberately conservative. A 4xx we do not recognise is `invalid_request`
 * and therefore **not retried** — retrying a request the vendor has already
 * rejected on its merits spends money to be told no again.
 */
function defaultErrorFor(status: number, body: unknown): ProviderError {
  const detail =
    typeof body === "object" && body !== null && "error" in body
      ? String((body as { error: unknown }).error).slice(0, 200)
      : "";

  if (status === 429) {
    return providerError(
      "rate_limited",
      "The provider is rate limiting us. Try again shortly.",
      { retryable: true, raw: body },
    );
  }

  if (status === 401 || status === 403) {
    // Our credentials, not the user's request. Never retried: a wrong key stays
    // wrong, and hammering an auth endpoint is how a key gets suspended.
    return providerError(
      "invalid_request",
      "The provider rejected our credentials.",
      { retryable: false, raw: body },
    );
  }

  if (status === 402) {
    return providerError(
      "insufficient_provider_credit",
      "The provider account is out of credit.",
      { retryable: false, raw: body },
    );
  }

  if (status >= 500) {
    return providerError(
      "provider_unavailable",
      "The provider is having trouble. Trying again may help.",
      { retryable: true, raw: body },
    );
  }

  return providerError(
    "invalid_request",
    detail || "The provider rejected that request.",
    { retryable: false, raw: body },
  );
}

/**
 * Outbound rate limit, per provider.
 *
 * Reuses the Sprint 15 limiter with a provider-scoped key. `sensitive` is
 * borrowed rather than a new policy being invented: 20/minute is a deliberately
 * conservative ceiling for a shared account, and a provider that can take more
 * should get its own policy with a number somebody has justified.
 */
async function reserveSlot(providerId: ProviderId): Promise<void> {
  const result = await checkRateLimit(
    { name: "sensitive", limit: 20, windowMs: 60_000 },
    `provider:${providerId}`,
  );

  if (!result.ok) {
    throw providerError(
      "rate_limited",
      "We are sending requests to this provider too quickly.",
      { retryable: true },
    );
  }
}

/**
 * One HTTP call to a provider, with everything the sprint requires attached.
 *
 * Throws a `ProviderError` — never a raw exception, never a `Response`. That is
 * the contract the retry policy and the circuit breaker consume, and it is why
 * neither of them has to know a vendor exists.
 */
export async function providerFetch<T = unknown>(
  options: ProviderCallOptions,
): Promise<ProviderCallResult<T>> {
  const {
    providerId,
    url,
    method = "POST",
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  await reserveSlot(providerId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
      // Never cache a provider call. A cached submit would return a stale job
      // id; a cached poll would report a finished job as still running.
      cache: "no-store",
    });
  } catch (cause) {
    const latencyMs = Date.now() - startedAt;

    // An abort here is our own deadline firing, not a user cancelling.
    const timedOut = cause instanceof Error && cause.name === "AbortError";

    logCall(providerId, method, url, timedOut ? 0 : -1, latencyMs);

    throw providerError(
      timedOut ? "timeout" : "provider_unavailable",
      timedOut
        ? "The provider did not respond in time."
        : "Could not reach the provider.",
      { retryable: true, raw: cause },
    );
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - startedAt;
  const payload = await response.json().catch(() => null);

  logCall(providerId, method, url, response.status, latencyMs);

  if (!response.ok) {
    throw (
      options.mapError?.(response.status, payload) ??
      defaultErrorFor(response.status, payload)
    );
  }

  return {
    data: payload as T,
    latencyMs,
    status: response.status,
    ...(options.readUsage ? { usage: options.readUsage(payload) } : {}),
  };
}

/** Longer deadline, for calls that move real bytes. */
export function uploadTimeout(): number {
  return UPLOAD_TIMEOUT_MS;
}

/**
 * One line per provider call.
 *
 * `console` because that is still the whole logging strategy — named as a gap
 * in every report since the audit. The shape is deliberately structured so that
 * swapping in a real logger is a change to this function and nothing else.
 *
 * The URL is logged **without its query string**: provider URLs carry job ids
 * and occasionally signed parameters, and a log line is the easiest place for
 * one of those to end up somewhere it should not.
 */
function logCall(
  providerId: ProviderId,
  method: string,
  url: string,
  status: number,
  latencyMs: number,
): void {
  const path = url.split("?")[0];
  const outcome = status >= 200 && status < 300 ? "ok" : "fail";

  console.info(
    `[ai] ${providerId} ${method} ${path} ${status || "timeout"} ${outcome} ${latencyMs}ms`,
  );
}
