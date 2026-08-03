import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POLICIES, checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * The limiter is the control standing between one signed-in user and our
 * provider bill. It is also a pure function of (key, time), which makes it
 * among the most testable code in the project — and it had no tests until now.
 *
 * Every test uses a unique key, because the store is module-level and shared
 * across the file by design.
 */

let seq = 0;
const key = () => `test-${Date.now()}-${seq++}`;

describe("checkRateLimit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("allows exactly `limit` requests and refuses the next", async () => {
    const k = key();
    const policy = POLICIES.generate;

    for (let i = 1; i <= policy.limit; i++) {
      const result = await checkRateLimit(policy, k);
      expect(result.ok, `request ${i} should pass`).toBe(true);
    }

    const overflow = await checkRateLimit(policy, k);
    expect(overflow.ok).toBe(false);
    expect(overflow.remaining).toBe(0);
  });

  it("counts down `remaining` accurately", async () => {
    const k = key();
    const first = await checkRateLimit(POLICIES.billing, k);
    expect(first.remaining).toBe(POLICIES.billing.limit - 1);

    const second = await checkRateLimit(POLICIES.billing, k);
    expect(second.remaining).toBe(POLICIES.billing.limit - 2);
  });

  it("never reports negative remaining once exhausted", async () => {
    const k = key();
    for (let i = 0; i < POLICIES.billing.limit + 5; i++) {
      await checkRateLimit(POLICIES.billing, k);
    }
    const result = await checkRateLimit(POLICIES.billing, k);
    expect(result.remaining).toBe(0);
  });

  it("resets after the window elapses", async () => {
    const k = key();
    const policy = POLICIES.sensitive;

    for (let i = 0; i < policy.limit; i++) await checkRateLimit(policy, k);
    expect((await checkRateLimit(policy, k)).ok).toBe(false);

    vi.advanceTimersByTime(policy.windowMs + 1);

    const afterReset = await checkRateLimit(policy, k);
    expect(afterReset.ok).toBe(true);
    expect(afterReset.remaining).toBe(policy.limit - 1);
  });

  it("does not reset one millisecond early", async () => {
    const k = key();
    const policy = POLICIES.sensitive;

    for (let i = 0; i < policy.limit; i++) await checkRateLimit(policy, k);
    vi.advanceTimersByTime(policy.windowMs - 10);

    expect((await checkRateLimit(policy, k)).ok).toBe(false);
  });

  it("keeps separate counters per key", async () => {
    const a = key();
    const b = key();

    for (let i = 0; i < POLICIES.billing.limit; i++) {
      await checkRateLimit(POLICIES.billing, a);
    }

    expect((await checkRateLimit(POLICIES.billing, a)).ok).toBe(false);
    expect((await checkRateLimit(POLICIES.billing, b)).ok).toBe(true);
  });

  it("keeps separate counters per policy for the same key", async () => {
    // The namespace prefix exists for this. Exhausting checkout must not lock
    // a user out of reading their own projects.
    const k = key();

    for (let i = 0; i < POLICIES.billing.limit; i++) {
      await checkRateLimit(POLICIES.billing, k);
    }

    expect((await checkRateLimit(POLICIES.billing, k)).ok).toBe(false);
    expect((await checkRateLimit(POLICIES.read, k)).ok).toBe(true);
  });
});

describe("policy configuration", () => {
  it("prices generation as the tightest non-webhook policy", () => {
    // Generation is the only endpoint that spends credits and provider quota.
    // If a future edit makes it more permissive than an ordinary mutation, that
    // is a mistake worth failing a build over.
    expect(POLICIES.generate.limit).toBeLessThan(POLICIES.mutation.limit);
    expect(POLICIES.generate.limit).toBeLessThan(POLICIES.read.limit);
  });

  it("gives every policy a positive limit and a real window", () => {
    for (const [name, policy] of Object.entries(POLICIES)) {
      expect(policy.limit, name).toBeGreaterThan(0);
      expect(policy.windowMs, name).toBeGreaterThanOrEqual(1000);
      expect(policy.name, name).toBe(
        name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
      );
    }
  });
});

describe("rateLimitHeaders", () => {
  it("omits Retry-After while the caller is still within the limit", () => {
    const headers = rateLimitHeaders({
      ok: true,
      limit: 10,
      remaining: 4,
      resetAt: Date.now() + 30_000,
    }) as Record<string, string>;

    expect(headers["RateLimit-Limit"]).toBe("10");
    expect(headers["RateLimit-Remaining"]).toBe("4");
    expect(headers["Retry-After"]).toBeUndefined();
  });

  it("adds Retry-After once refused", () => {
    const headers = rateLimitHeaders({
      ok: false,
      limit: 10,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    }) as Record<string, string>;

    expect(headers["Retry-After"]).toBeDefined();
    expect(Number(headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("never emits a zero or negative Retry-After", () => {
    // A `Retry-After: 0` invites an immediate retry, which is the opposite of
    // what a 429 is asking for. The floor is 1 second.
    const headers = rateLimitHeaders({
      ok: false,
      limit: 10,
      remaining: 0,
      resetAt: Date.now() - 5_000,
    }) as Record<string, string>;

    expect(Number(headers["Retry-After"])).toBeGreaterThanOrEqual(1);
  });
});
