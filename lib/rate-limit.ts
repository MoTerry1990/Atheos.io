import "server-only";

import { emit } from "@/lib/events";
import { prisma } from "@/lib/prisma";

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
 * ## Postgres, not memory — B7
 *
 * Until Sprint 4 the only store was `MemoryStore`, a `Map` in the lambda's
 * heap. On Vercel that is not a weak limiter, it is **not a limiter**:
 *
 *   - Every concurrent instance holds its own count, so the effective limit is
 *     `configured x instances`.
 *   - Instances multiply with load, so the limit loosens exactly when it
 *     matters.
 *   - A cold start begins at zero, and an attacker generating traffic causes
 *     cold starts.
 *
 * The audit rated it ineffective and it was. `PostgresStore` replaces it. The
 * count lives in one row that every instance contends for, incremented by a
 * single atomic upsert, so twelve requests are twelve wherever they land.
 *
 * ## Why not Redis
 *
 * Redis is the textbook answer. It is also a second paid dependency on a
 * budget whose absolute ceiling is $500 a month, and the thing being defended
 * here *is* that budget. Postgres is already provisioned, already
 * transactional, and one upsert per request is far inside what Supabase serves
 * at this scale.
 *
 * The trade is real and it is written up in `docs/OPERATIONS.md`: the limiter
 * adds a round trip to every guarded request, and if request volume ever makes
 * that the bottleneck, Upstash Redis (~$0–10/month at this size) is the
 * documented upgrade — one `RateLimitStore` implementation, no call site
 * changed.
 *
 * ## Failing safe means different things on different endpoints
 *
 * If the store cannot be reached, a limiter has to choose. Failing open lets an
 * attack through; failing closed turns a database hiccup into an outage.
 *
 * The answer depends on what the endpoint costs. A read that fails open costs
 * nothing anybody will notice. A **generation** that fails open spends real
 * money at machine speed, so `failMode: "closed"` is set on every policy that
 * can reach a provider or a payment processor. That choice is per-policy and
 * visible in the table below rather than being one global default that is wrong
 * for half the routes.
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
 * The shared counter, in Postgres.
 *
 * ## One statement, no read-then-write
 *
 * The whole increment is an upsert with a conditional reset. Reading the row
 * and then updating it would reintroduce the same race the credit ledger was
 * just rescued from — two instances reading 11, both writing 12, and the
 * twelfth request through the door being the twenty-second.
 *
 * `ON CONFLICT DO UPDATE` takes a row lock, so the `CASE` below evaluates
 * against whatever the previous writer committed. The window resets in place
 * rather than by creating a new row per window, which keeps the table at one
 * row per caller per policy instead of one per caller per minute.
 */
class PostgresStore implements RateLimitStore {
  async hit(key: string, windowMs: number) {
    const expires = new Date(Date.now() + windowMs);

    const rows = await prisma.$queryRaw<{ count: number; expiresAt: Date }[]>`
      INSERT INTO rate_limit_buckets ("key", "count", "expiresAt")
      VALUES (${key}, 1, ${expires})
      ON CONFLICT ("key") DO UPDATE
        SET "count" = CASE
              WHEN rate_limit_buckets."expiresAt" <= now() THEN 1
              ELSE rate_limit_buckets."count" + 1
            END,
            "expiresAt" = CASE
              WHEN rate_limit_buckets."expiresAt" <= now() THEN EXCLUDED."expiresAt"
              ELSE rate_limit_buckets."expiresAt"
            END
      RETURNING "count", "expiresAt"
    `;

    const row = rows[0];
    if (!row) throw new Error("rate limit upsert returned no row");

    return { count: row.count, resetAt: row.expiresAt.getTime() };
  }
}

/**
 * Cached on `globalThis` for the same reason the Prisma client is: Next.js
 * re-evaluates modules on hot reload, and a fresh map per reload would reset
 * every counter while developing.
 */
const globalForRateLimit = globalThis as unknown as {
  rateLimitStore: RateLimitStore | undefined;
  rateLimitFallback: RateLimitStore | undefined;
};

/**
 * Tests get the memory store.
 *
 * Not because memory is good enough there, but because the alternative is every
 * unit test needing a live database to assert on something unrelated. The
 * database-backed behaviour has its own test in `tests/db/`, against real
 * Postgres, which is the only place it can be checked truthfully.
 */
const store: RateLimitStore =
  globalForRateLimit.rateLimitStore ??
  (process.env.NODE_ENV === "test" ? new MemoryStore() : new PostgresStore());

/**
 * Used only when Postgres is unreachable, and only for policies that fail open.
 *
 * A degraded limiter that still counts within one instance is better than no
 * limiter at all — it is exactly the pre-Sprint-4 behaviour, which was
 * inadequate as a design and is perfectly reasonable as an emergency floor.
 */
const fallback: RateLimitStore =
  globalForRateLimit.rateLimitFallback ?? new MemoryStore();

if (process.env.NODE_ENV !== "production") {
  globalForRateLimit.rateLimitStore = store;
  globalForRateLimit.rateLimitFallback = fallback;
}

/** Drop windows that ended long ago. Called by the daily worker. */
export async function sweepRateLimitBuckets(): Promise<number> {
  const { count } = await prisma.rateLimitBucket.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 60 * 60_000) } },
  });
  return count;
}

export interface LimitPolicy {
  /** Requests permitted per window. */
  limit: number;
  windowMs: number;
  /** Namespace, so two policies never share a counter for the same caller. */
  name: string;
  /**
   * What to do when the store cannot be reached.
   *
   * `"closed"` on anything that spends money — a limiter that gives up during a
   * database incident is the limiter an attacker was waiting for. `"open"` on
   * reads, where the cost of a false block outweighs the cost of a missed one.
   *
   * Defaults to `"open"` when omitted, matching the pre-Sprint-4 behaviour, so
   * a policy added without thinking about it degrades the way the old one did
   * rather than taking a route down.
   */
  failMode?: "open" | "closed";
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
  generate: {
    name: "generate",
    limit: 12,
    windowMs: 60_000,
    failMode: "closed",
  },

  /**
   * Prompt enhancement. Free to the user, so the limit is the only thing
   * standing between us and somebody using the studio as a free LLM. Twenty a
   * minute is far more than a person editing one prompt at a time needs, and
   * far less than a script wants.
   */
  enhance: {
    name: "enhance",
    limit: 20,
    windowMs: 60_000,
    failMode: "closed",
  },

  /** Uploads. Bandwidth and storage, both paid by us. */
  upload: { name: "upload", limit: 20, windowMs: 60_000 },

  /**
   * Checkout and billing mutations. Each creates an object in Stripe's account,
   * and Stripe rate-limits us in turn — being throttled by our payment
   * processor during someone's checkout is the worst possible time.
   */
  billing: {
    name: "billing",
    limit: 10,
    windowMs: 60_000,
    failMode: "closed",
  },

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
  sensitive: {
    name: "sensitive",
    limit: 20,
    windowMs: 60_000,
    failMode: "closed",
  },

  /**
   * Sign-up. Keyed by IP, because there is no user id yet — that is the whole
   * point of the endpoint.
   *
   * The audit's § 9 lists "unlimited free credits per email" as Critical with
   * no protection at all. This does not solve it — see the limitations note in
   * `services/billing/free-grant.ts` — but it turns a scripted farm of a
   * thousand accounts into a scripted farm of five an hour per address, which
   * is the difference between an afternoon and a month.
   */
  signup: {
    name: "signup",
    limit: 5,
    windowMs: 60 * 60_000,
    failMode: "closed",
  },

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
  const key = `${policy.name}:${identifier}`;

  try {
    const { count, resetAt } = await store.hit(key, policy.windowMs);

    const result = {
      ok: count <= policy.limit,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - count),
      resetAt,
    };

    if (!result.ok) {
      // The identifier is a user id or an IP. Neither is a secret, and without
      // one the log cannot answer "who was blocked".
      emit("limit.rate_blocked", { policy: policy.name, identifier, count });
    }

    return result;
  } catch (error) {
    emit("limit.store_unavailable", {
      policy: policy.name,
      failMode: policy.failMode ?? "open",
      error: error instanceof Error ? error.name : "unknown",
    });

    if (policy.failMode === "closed") {
      // Refuse. `resetAt` is short so a recovered database recovers the route
      // within seconds rather than leaving callers backing off for a minute.
      return {
        ok: false,
        limit: policy.limit,
        remaining: 0,
        resetAt: Date.now() + 5_000,
      };
    }

    // Degrade to per-instance counting rather than to nothing at all.
    const { count, resetAt } = await fallback.hit(key, policy.windowMs);

    return {
      ok: count <= policy.limit,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - count),
      resetAt,
    };
  }
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
