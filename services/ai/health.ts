import "server-only";

import type { ProviderError, ProviderId } from "@/services/ai/types";

/**
 * Provider health, as a circuit breaker.
 *
 * ## What this is actually for
 *
 * Not observability — we have none of that yet. This exists so that when a
 * provider goes down, we stop sending it work **before** a hundred users each
 * wait thirty seconds for their own timeout.
 *
 * Without it, a vendor outage looks like this: every request is submitted,
 * every one times out, every one is retried twice, every one eventually
 * refunds. The user waits minutes to be told nothing happened, and we pay for
 * three attempts each time. The breaker turns that into an immediate fallback.
 *
 * ## Three states, and the half-open one is the important one
 *
 *   **closed** — normal. Requests flow.
 *   **open** — too many recent failures. Requests are refused instantly and
 *     routed to a fallback.
 *   **half-open** — the cool-off has elapsed. Exactly **one** request is let
 *     through as a probe. If it succeeds the breaker closes; if it fails it
 *     opens again for another cool-off.
 *
 * Half-open matters because the alternative is a stampede: without it, the
 * moment the cool-off expires every queued request hits a provider that may
 * still be down, and knocks it over again.
 *
 * ## Only *provider* failures count
 *
 * A content filter or an invalid request is not evidence that the provider is
 * unwell — it is evidence that one request was bad. Counting those would open
 * the breaker on a vendor that is working perfectly, for a user who wrote a
 * prompt it refused. `recordFailure` filters on the error code for that reason.
 *
 * ## In-memory, per process
 *
 * The same limitation as the rate limiter, and the same honest note: on one
 * server this is correct; behind N instances each learns independently, so a
 * dead provider is discovered N times instead of once. `HealthStore` exists so
 * a shared implementation can replace this without touching a call site.
 */

export type CircuitState = "closed" | "open" | "half-open";

export interface ProviderHealth {
  providerId: ProviderId;
  state: CircuitState;
  consecutiveFailures: number;
  /** Epoch ms. Null when the breaker has never opened. */
  openedAt: number | null;
  lastFailureCode: string | null;
  /** Successes and failures since the process started. Diagnostic only. */
  totals: { success: number; failure: number };
}

export interface BreakerConfig {
  /** Consecutive provider-side failures before the breaker opens. */
  failureThreshold: number;
  /** How long to stay open before allowing a probe. */
  cooldownMs: number;
}

export const DEFAULT_BREAKER: BreakerConfig = {
  // Three, not one. A single failure is noise — providers drop the occasional
  // request — and opening on noise makes the fallback path the normal path,
  // which hides the real failure rate behind a provider nobody chose.
  failureThreshold: 3,
  cooldownMs: 60_000,
};

/**
 * Error codes that count as "the provider is unwell".
 *
 * `rate_limited` is deliberately included: being throttled means we cannot use
 * them right now, which for routing purposes is the same as being down. It is
 * deliberately *not* treated as an outage for alerting, which is a distinction
 * to make when alerting exists.
 */
const PROVIDER_FAULT: ReadonlySet<string> = new Set([
  "provider_unavailable",
  "timeout",
  "rate_limited",
  "insufficient_provider_credit",
]);

export interface HealthStore {
  get(providerId: ProviderId): ProviderHealth | undefined;
  set(health: ProviderHealth): void;
  all(): readonly ProviderHealth[];
}

class MemoryHealthStore implements HealthStore {
  private readonly entries = new Map<ProviderId, ProviderHealth>();

  get(providerId: ProviderId) {
    return this.entries.get(providerId);
  }
  set(health: ProviderHealth) {
    this.entries.set(health.providerId, health);
  }
  all() {
    return [...this.entries.values()];
  }
}

const globalForHealth = globalThis as unknown as {
  providerHealth: HealthStore | undefined;
};

const store: HealthStore =
  globalForHealth.providerHealth ?? new MemoryHealthStore();

if (process.env.NODE_ENV !== "production") {
  globalForHealth.providerHealth = store;
}

function fresh(providerId: ProviderId): ProviderHealth {
  return {
    providerId,
    state: "closed",
    consecutiveFailures: 0,
    openedAt: null,
    lastFailureCode: null,
    totals: { success: 0, failure: 0 },
  };
}

/**
 * Current health, resolving the open → half-open transition.
 *
 * The transition is computed on read rather than scheduled with a timer: a
 * `setTimeout` would keep a serverless function alive, and there is no
 * behavioural difference when nothing can observe the state except a caller.
 */
export function healthOf(
  providerId: ProviderId,
  config: BreakerConfig = DEFAULT_BREAKER,
  now: number = Date.now(),
): ProviderHealth {
  const current = store.get(providerId) ?? fresh(providerId);

  if (
    current.state === "open" &&
    current.openedAt !== null &&
    now - current.openedAt >= config.cooldownMs
  ) {
    const probing: ProviderHealth = { ...current, state: "half-open" };
    store.set(probing);
    return probing;
  }

  return current;
}

/** Whether a provider may be given work right now. */
export function isAvailable(
  providerId: ProviderId,
  config: BreakerConfig = DEFAULT_BREAKER,
  now: number = Date.now(),
): boolean {
  return healthOf(providerId, config, now).state !== "open";
}

export function recordSuccess(providerId: ProviderId): ProviderHealth {
  const current = healthOf(providerId);

  // A success closes the breaker outright rather than decrementing. Half-open
  // exists precisely to answer "is it back?", and a successful probe is that
  // answer — draining a counter would leave a recovered provider in fallback.
  const next: ProviderHealth = {
    ...current,
    state: "closed",
    consecutiveFailures: 0,
    openedAt: null,
    totals: { ...current.totals, success: current.totals.success + 1 },
  };

  store.set(next);
  return next;
}

export function recordFailure(
  providerId: ProviderId,
  error: Pick<ProviderError, "code">,
  config: BreakerConfig = DEFAULT_BREAKER,
  now: number = Date.now(),
): ProviderHealth {
  const current = healthOf(providerId, config, now);

  // Not the provider's fault: a bad prompt, an unsupported operation. Recorded
  // in the totals for visibility, but it does not move the breaker.
  if (!PROVIDER_FAULT.has(error.code)) {
    const next: ProviderHealth = {
      ...current,
      totals: { ...current.totals, failure: current.totals.failure + 1 },
    };
    store.set(next);
    return next;
  }

  const consecutiveFailures = current.consecutiveFailures + 1;

  // A failed probe re-opens immediately — one strike, not three. The provider
  // already failed the threshold once; making it earn three more failures to
  // be shut off again would send two more users into a known-bad provider.
  const shouldOpen =
    current.state === "half-open" ||
    consecutiveFailures >= config.failureThreshold;

  const next: ProviderHealth = {
    ...current,
    consecutiveFailures,
    state: shouldOpen ? "open" : "closed",
    openedAt: shouldOpen ? now : current.openedAt,
    lastFailureCode: error.code,
    totals: { ...current.totals, failure: current.totals.failure + 1 },
  };

  store.set(next);
  return next;
}

/** Everything the process has observed. For the admin status page. */
export function healthSnapshot(): readonly ProviderHealth[] {
  return store.all();
}

/** Test seam, and a manual reset for an operator who has fixed the vendor. */
export function resetHealth(providerId: ProviderId): void {
  store.set(fresh(providerId));
}
