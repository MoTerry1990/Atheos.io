import "server-only";

/**
 * Rate limiting.
 *
 * ## Why this exists
 *
 * Before Sprint 15 there was none, anywhere. Every endpoint that costs money —
 * generation, uploads, checkout — could be called in a loop by one signed-in
 * account until their credits, our provider quota and our storage bill were
 * gone. `PROJECT_AUDIT.md` rated it the single most severe finding, and it was
 * the only Critical one with no mitigating control at all.
 *
 * ## A fixed window, not a token bucket
 *
 * A counter per (key, window) is three lines and needs one number in memory.
 * Token buckets are better at absorbing bursts, but the thing being defended
 * here is not burstiness — it is a loop. For a loop, both algorithms say no at
 * the same moment, and the simpler one has fewer ways to be wrong.
 *
 * The known cost is the boundary effect: a caller can spend a full window's
 * allowance at 0:59 and another at 1:01. Every limit below is therefore set to
 * roughly half of what the endpoint could actually survive, so twice the limit
 * is still safe.
 *
 * ## In-memory, and honest about it
 *
 * There is no Redis in this project. `MemoryStore` is per-process, which means:
 *
 *   - On one long-lived server it is correct.
 *   - On N instances behind a load balancer each holds its own count, so the
 *     effective limit is N x the configured one.
 *   - On serverless, a cold start begins at zero.
 *
 * That is a real weakness and it is written down rather than hidden. It is also
 * still enormously better than nothing: the attack it stops — one client
 * hammering one endpoint — is stopped on whichever instance receives the
 * traffic, and a caller cannot choose their instance.
 *
 * `RateLimitStore` exists so that swapping in Redis is one implementation and
 * one line in `createLimiter`, with no call site changing. That is the intended
 * production fix and it is named in `SECURITY_REPORT.md`.
 */

export interface RateLimitResult {
  ok: boolean;
  /** Requests allowed per window. */
  limit: number;
  /** Requests left in the current window. Never negative. */
  remaining: number;
  /** Epoch milliseconds at which the window rolls over. */
  resetAt: number;
}

export interface RateLimitStore {
  hit(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetAt: number }>;
}

interface Entry {
  count: number;
  resetAt: number;
}

/**
 * Process-local store.
 *
 * The map is swept lazily rather than on a timer: a `setInterval` would keep a
 * serverless function alive and pin the process. Sweeping on write is enough
 * because a key nobody touches again costs one stale entry until the next
 * sweep, and the sweep is O(size) at most once per `SWEEP_INTERVAL_MS`.
 */
class MemoryStore implements RateLimitStore {
  private readonly entries = new Map<string, Entry>();
  private lastSweep = 0;

  private static readonly SWEEP_INTERVAL_MS = 60_000;

  /**
   * Hard ceiling on tracked keys.
   *
   * Without it, the limiter is itself a memory-exhaustion vector: an attacker
   * varying their key (a spoofed forwarded-for, a fresh session) allocates an
   * entry per request. At the cap the oldest entries are dropped, which fails
   * *open* for those keys — the alternative, failing closed, would let the same
   * attacker lock out real users by flooding the map.
   */
  private static readonly MAX_KEYS = 50_000;

  async hit(key: string, windowMs: number) {
    const now = Date.now();
    this.sweep(now);

    const existing = this.entries.get(key);

    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.entries.set(key, fresh);
      return fresh;
    }

    existing.count += 1;
    return existing;
  }

  private sweep(now: number) {
    if (now - this.lastSweep < MemoryStore.SWEEP_INTERVAL_MS) {
      if (this.entries.size <= MemoryStore.MAX_KEYS) return;
    }
    this.lastSweep = now;

    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }

    // Still over after dropping expired entries: shed oldest-inserted first.
    // Map iteration order is insertion order, which is a good enough proxy.
    if (this.entries.size > MemoryStore.MAX_KEYS) {
      const excess = this.entries.size - MemoryStore.MAX_KEYS;
      let dropped = 0;
      for (const key of this.entries.keys()) {
        this.entries.delete(key);
        if (++dropped >= excess) break;
      }
    }
  }
}

/**
 * Shared across every limiter, and cached on `globalThis` for the same reason
 * the Prisma client is: Next.js re-evaluates modules on hot reload, and a fresh
 * map per reload would reset every counter while developing.
 */
const globalForRateLimit = globalThis as unknown as {
  rateLimitStore: RateLimitStore | undefined;
};

const store: RateLimitStore =
  globalForRateLimit.rateLimitStore ?? new MemoryStore();

if (process.env.NODE_ENV !== "production") {
  globalForRateLimit.rateLimitStore = store;
}

export interface LimitPolicy {
  /** Requests permitted per window. */
  limit: number;
  windowMs: number;
  /** Namespace, so two policies never share a counter for the same caller. */
  name: string;
}

/**
 * The policies, in one place so they can be reviewed as a set rather than
 * discovered one route at a time.
 *
 * Numbers are deliberately generous for humans and useless for scripts. The
 * question asked for each was "what would a fast, frustrated real user do?",
 * then roughly doubled.
 */
export const POLICIES = {
  /**
   * Generation. The expensive one: every call spends credits and provider
   * quota. Twelve a minute is faster than anyone can meaningfully evaluate
   * results, and a loop hits it in seconds.
   */
  generate: { name: "generate", limit: 12, windowMs: 60_000 },

  /** Uploads. Bandwidth and storage, both paid by us. */
  upload: { name: "upload", limit: 20, windowMs: 60_000 },

  /**
   * Checkout and billing mutations. Each creates an object in Stripe's account,
   * and Stripe rate-limits us in turn — being throttled by our payment
   * processor during someone's checkout is the worst possible time.
   */
  billing: { name: "billing", limit: 10, windowMs: 60_000 },

  /**
   * Anything that writes on behalf of a signed-in user: projects, folders,
   * comments, follows, publishing, marketplace installs.
   */
  mutation: { name: "mutation", limit: 60, windowMs: 60_000 },

  /**
   * Authenticated reads. High, because the studio polls and a projects page
   * fans out. This is a backstop against a runaway client, not a real defence.
   */
  read: { name: "read", limit: 300, windowMs: 60_000 },

  /**
   * Anonymous reads of public surfaces — the community gallery, profiles,
   * the marketplace catalogue. Keyed by IP, so it is shared by everyone behind
   * one NAT; kept high enough that an office does not trip it.
   */
  publicRead: { name: "public-read", limit: 120, windowMs: 60_000 },

  /**
   * Unauthenticated or identity-adjacent endpoints where the threat is
   * guessing rather than cost: webhook receivers before signature verification,
   * and handle availability checks (which enumerate who exists).
   *
   * Deliberately the tightest policy here.
   */
  sensitive: { name: "sensitive", limit: 20, windowMs: 60_000 },

  /**
   * Admin. Not because admins are a threat, but because a stolen admin session
   * should not be able to enumerate the whole user table at machine speed, and
   * every admin read is a disclosure that gets written to the audit log.
   */
  admin: { name: "admin", limit: 100, windowMs: 60_000 },
} as const satisfies Record<string, LimitPolicy>;

export type PolicyName = keyof typeof POLICIES;

/**
 * Check and consume one unit against a policy.
 *
 * `identifier` should be a user id where one exists and an IP otherwise — see
 * `callerKey` in `lib/request-identity.ts` for why that order matters.
 */
export async function checkRateLimit(
  policy: LimitPolicy,
  identifier: string,
): Promise<RateLimitResult> {
  const { count, resetAt } = await store.hit(
    `${policy.name}:${identifier}`,
    policy.windowMs,
  );

  return {
    ok: count <= policy.limit,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - count),
    resetAt,
  };
}

/** Standard headers so a well-behaved client can back off on its own. */
export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  const seconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));

  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(seconds),
    ...(result.ok ? {} : { "Retry-After": String(seconds) }),
  };
}
