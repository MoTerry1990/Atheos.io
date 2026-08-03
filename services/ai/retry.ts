import "server-only";

import type { ProviderError, ProviderErrorCode } from "@/services/ai/types";

/**
 * Retry policy.
 *
 * ## Retrying is not free, and this is where that is decided
 *
 * Every retry against a generation provider costs money — ours, on the vendor's
 * meter — and time the user is watching a spinner. So the policy is stated once
 * here rather than being an ad-hoc `catch` in the pipeline, and it is driven by
 * the **normalised error code**, not by the vendor's message.
 *
 * That is the payoff of `ProviderError`: eleven vendors describe a rate limit
 * eleven ways, and this file only has to know about one.
 *
 * ## The decision table
 *
 * | Code | Retry? | Why |
 * | --- | --- | --- |
 * | `rate_limited` | yes, slowly | The request is fine; we asked too fast. |
 * | `provider_unavailable` | yes | Their problem, likely transient. |
 * | `timeout` | yes | Ours or theirs; either way unknown, not wrong. |
 * | `unknown` | yes, once | Cheap to try; expensive to assume fatal. |
 * | `content_filtered` | **no** | The identical prompt will be filtered again. |
 * | `invalid_request` | **no** | The identical request is still invalid. |
 * | `unsupported_operation` | **no** | The model still cannot do it. |
 * | `insufficient_provider_credit` | **no** | Our account, not their capacity. Retrying spends nothing but delays the alert. |
 *
 * A non-retryable error should **refund the user immediately** rather than
 * being retried into a slower failure.
 */

export interface RetryPolicy {
  /** Attempts after the first. 0 means submit once and accept the outcome. */
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  // Three attempts total. Past that a provider is not having a blip, it is
  // having an outage — and the right response to an outage is the fallback
  // provider, not a fourth attempt at the same one.
  maxRetries: 2,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

/** Rate limits get their own, slower schedule. */
export const RATE_LIMIT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  // Backing off from a second is pointless against a per-minute quota.
  baseDelayMs: 5_000,
  maxDelayMs: 60_000,
};

const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set([
  "rate_limited",
  "provider_unavailable",
  "timeout",
  "unknown",
]);

/**
 * Whether this error justifies another attempt at the **same** provider.
 *
 * The adapter's own `retryable` flag wins when it says no. An adapter has
 * vendor-specific knowledge this table cannot — a 400 that is really a
 * transient validation quirk, say — and it is allowed to be more pessimistic
 * than the code alone would suggest. It is not allowed to be more optimistic:
 * that would let a vendor talk us into retrying a content filter forever.
 */
export function isRetryable(error: ProviderError): boolean {
  if (!error.retryable) return false;
  return RETRYABLE.has(error.code);
}

export function policyFor(error: ProviderError): RetryPolicy {
  return error.code === "rate_limited"
    ? RATE_LIMIT_RETRY_POLICY
    : DEFAULT_RETRY_POLICY;
}

/**
 * Delay before attempt `n`, with full jitter.
 *
 * `attempt` is 1-based: the delay *before* the first retry.
 *
 * ## Why full jitter rather than plain exponential
 *
 * When a provider returns 429 to everyone at once, plain exponential backoff
 * makes every client retry at the same instant — a thundering herd that
 * reproduces the overload that caused the 429. Full jitter spreads the retries
 * across the whole window and is the variant AWS measured as best for exactly
 * this case.
 *
 * The cost is that a delay can be very short. That is the point: some callers
 * getting through early is what drains the queue.
 *
 * `random` is injectable so the schedule can be asserted deterministically.
 */
export function retryDelayMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  if (attempt < 1) return 0;

  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);

  return Math.floor(random() * capped);
}

/**
 * Should the caller try again, and after how long?
 *
 * Returns null when the answer is no — which callers must treat as "refund and
 * surface the error", not as "try something else quietly".
 */
export function nextAttempt(
  error: ProviderError,
  attemptsSoFar: number,
  random: () => number = Math.random,
): { delayMs: number; attempt: number } | null {
  if (!isRetryable(error)) return null;

  const policy = policyFor(error);
  if (attemptsSoFar >= policy.maxRetries) return null;

  const attempt = attemptsSoFar + 1;
  return { attempt, delayMs: retryDelayMs(attempt, policy, random) };
}
