import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Free-tier daily caps, enforced server-side.
 *
 * ## Why server-side is the whole point
 *
 * A cap the client enforces is a cap that applies to people using the app as
 * intended. The one that matters runs where the credits are reserved, so a
 * forged request meets the same refusal a button press does — which is why this
 * lives in `checkGenerationLimits` alongside the concurrency check rather than
 * anywhere near the studio.
 */

const generationCount = vi.fn();
const generationFindFirst = vi.fn();
const activeJobCount = vi.fn();
const checkRateLimit = vi.fn();
const emit = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    generation: { count: generationCount, findFirst: generationFindFirst },
  },
}));
vi.mock("@/services/billing/ledger", () => ({
  activeJobCount: (...a: unknown[]) => activeJobCount(...a),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
}));
vi.mock("@/lib/events", () => ({ emit: (...a: unknown[]) => emit(...a) }));

const { checkGenerationLimits, limitMessage } =
  await import("@/services/limits/generation-limits");
const { planConfigFor } = await import("@/services/billing/plan-config");

beforeEach(() => {
  generationCount.mockReset().mockResolvedValue(0);
  generationFindFirst.mockReset().mockResolvedValue(null);
  activeJobCount.mockReset().mockResolvedValue(0);
  // Rate windows always pass; this file is about the daily cap alone.
  checkRateLimit.mockReset().mockResolvedValue({ ok: true, resetAt: 0 });
  emit.mockReset();
});

describe("the caps are declared where the plan is", () => {
  it("Free is ten images and two videos a day", () => {
    const free = planConfigFor("FREE");
    expect(free.dailyJobCaps).toEqual({ IMAGE: 10, VIDEO: 2 });
  });

  it("video is separately unreachable from Free, so the cap is belt and braces", () => {
    /**
     * Recorded rather than assumed. `eligibleModalities` refuses a clip before
     * the cap is ever consulted, so the VIDEO cap is defence in depth — it
     * matters only if video is ever enabled on Free, and it is declared now so
     * that change cannot silently arrive uncapped.
     */
    expect(planConfigFor("FREE").eligibleModalities).not.toContain("VIDEO");
  });

  it("leaves paid plans uncapped", () => {
    for (const tier of ["CREATOR", "PRO", "STUDIO"] as const) {
      expect(planConfigFor(tier).dailyJobCaps).toBeUndefined();
    }
  });
});

describe("enforcement at reservation", () => {
  it("allows the tenth image and refuses the eleventh", async () => {
    generationCount.mockResolvedValue(9);
    const ninth = await checkGenerationLimits({
      userId: "u",
      tier: "FREE",
      modality: "IMAGE",
    });
    expect(ninth.allowed).toBe(true);

    generationCount.mockResolvedValue(10);
    const eleventh = await checkGenerationLimits({
      userId: "u",
      tier: "FREE",
      modality: "IMAGE",
    });
    expect(eleventh.allowed).toBe(false);
    expect(eleventh.reason).toBe("daily_cap_reached");
    expect(eleventh.dailyUsed).toBe(10);
    expect(eleventh.dailyCap).toBe(10);
  });

  it("counts a rolling 24 hours, not since midnight", async () => {
    // Midnight would hand everybody a fresh allowance at the same instant and
    // make the cap trivially farmable just before it.
    generationCount.mockResolvedValue(0);
    await checkGenerationLimits({
      userId: "u",
      tier: "FREE",
      modality: "IMAGE",
    });

    const where = generationCount.mock.calls[0][0].where;
    const since = where.createdAt.gte as Date;
    const hoursAgo = (Date.now() - since.getTime()) / 3_600_000;
    expect(hoursAgo).toBeGreaterThan(23.9);
    expect(hoursAgo).toBeLessThan(24.1);
  });

  it("counts each modality separately", async () => {
    generationCount.mockResolvedValue(0);
    await checkGenerationLimits({
      userId: "u",
      tier: "FREE",
      modality: "IMAGE",
    });
    expect(generationCount.mock.calls[0][0].where.modality).toBe("IMAGE");
  });

  it("counts failed generations too", async () => {
    /**
     * No status filter. A failed generation still cost a provider call, and
     * excluding them would make failure the cheapest way past the cap.
     */
    generationCount.mockResolvedValue(0);
    await checkGenerationLimits({
      userId: "u",
      tier: "FREE",
      modality: "IMAGE",
    });
    expect(generationCount.mock.calls[0][0].where.status).toBeUndefined();
  });

  it("does not cap a paid plan", async () => {
    generationCount.mockResolvedValue(500);
    const verdict = await checkGenerationLimits({
      userId: "u",
      tier: "PRO",
      modality: "IMAGE",
    });
    expect(verdict.allowed).toBe(true);
    // And does not even ask the database.
    expect(generationCount).not.toHaveBeenCalled();
  });

  it("skips the cap when no modality is supplied", async () => {
    // Older callers keep working rather than being silently capped on a
    // modality nobody told the function about.
    generationCount.mockResolvedValue(999);
    const verdict = await checkGenerationLimits({ userId: "u", tier: "FREE" });
    expect(verdict.allowed).toBe(true);
  });

  it("refuses before consulting concurrency", async () => {
    // Somebody out of images for the day should be told that, not told to wait
    // for a slot that will never help.
    generationCount.mockResolvedValue(10);
    await checkGenerationLimits({
      userId: "u",
      tier: "FREE",
      modality: "IMAGE",
    });
    expect(activeJobCount).not.toHaveBeenCalled();
  });
});

describe("the refusal is logged and explained", () => {
  it("emits a cap-hit event for the abuse view", async () => {
    generationCount.mockResolvedValue(10);
    await checkGenerationLimits({
      userId: "u",
      tier: "FREE",
      modality: "IMAGE",
    });

    const [name, payload] = emit.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(name).toBe("limit.daily_cap_blocked");
    expect(payload).toMatchObject({
      tier: "FREE",
      modality: "IMAGE",
      usedToday: 10,
      cap: 10,
    });
  });

  it("tells the customer the number and when it resets", async () => {
    generationCount.mockResolvedValue(10);
    generationFindFirst.mockResolvedValue({
      // Oldest job in the window was 20 hours ago, so ~4 hours remain.
      createdAt: new Date(Date.now() - 20 * 3_600_000),
    });

    const verdict = await checkGenerationLimits({
      userId: "u",
      tier: "FREE",
      modality: "IMAGE",
    });
    const message = limitMessage(verdict);

    expect(message).toContain("10");
    expect(message).toMatch(/resets in about 4 hours/);
    // Says what to do, not what the internal policy is called.
    expect(message).not.toMatch(/policy|daily_cap_reached/);
  });

  it("never returns a retry hint below a minute", async () => {
    generationCount.mockResolvedValue(10);
    generationFindFirst.mockResolvedValue({ createdAt: new Date() });

    const verdict = await checkGenerationLimits({
      userId: "u",
      tier: "FREE",
      modality: "IMAGE",
    });
    expect(verdict.retryAfterSeconds).toBeGreaterThanOrEqual(60);
  });
});
