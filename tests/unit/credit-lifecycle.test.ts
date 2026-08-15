import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reserve/capture/release control flow.
 *
 * `tests/db/credit-ledger.test.ts` proves the SQL against real Postgres. This
 * proves the decisions *around* it — which are where the money policy actually
 * lives:
 *
 *   - a duplicate call is success, not an error, because the callers retry
 *   - a release after a capture is refused, because we have been billed
 *   - a job at the concurrency cap never reaches the ledger at all
 *
 * All three are failure-path code, which is the least-exercised code in any
 * system and the most expensive to get wrong here.
 */

const prismaMock = {
  $transaction: vi.fn(),
  user: { findUnique: vi.fn() },
  creditTransaction: { create: vi.fn(), findUnique: vi.fn() },
  generation: { count: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

/** Prisma's P2002. `isUniqueViolation` matches on the code. */
class UniqueViolation extends Error {
  code = "P2002";
  constructor() {
    super("Unique constraint failed");
    this.name = "PrismaClientKnownRequestError";
  }
}

vi.mock("@/lib/prisma-errors", () => ({
  isUniqueViolation: (error: unknown) =>
    (error as { code?: string })?.code === "P2002",
}));

async function ledger() {
  return import("@/services/billing/ledger");
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ creditBalance: 100 });
  prismaMock.creditTransaction.findUnique.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: unknown) => unknown) =>
      typeof fn === "function" ? fn(txClient()) : fn,
  );
});

/** A transaction client whose raw query reports a successful debit. */
function txClient(rows: { creditBalance: number }[] = [{ creditBalance: 10 }]) {
  return {
    $queryRawUnsafe: vi.fn().mockResolvedValue(rows),
    user: { findUnique: vi.fn().mockResolvedValue({ creditBalance: 100 }) },
    creditTransaction: { create: vi.fn().mockResolvedValue({}) },
  };
}

describe("reserve", () => {
  it("succeeds when the balance covers the cost", async () => {
    const { reserveCredits } = await ledger();

    const result = await reserveCredits({
      userId: "u1",
      generationId: "g1",
      amount: 90,
    });

    expect(result.ok).toBe(true);
    expect(result.balance).toBe(10);
  });

  it("reports insufficient credit when the update matches no row", async () => {
    // Zero rows *is* the insufficient-credit signal. There is no separate
    // check, which is the whole point — a check and a write can disagree.
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) => fn(txClient([])),
    );

    const { reserveCredits } = await ledger();
    const result = await reserveCredits({
      userId: "u1",
      generationId: "g1",
      amount: 900,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient_credits");
    expect(result.balance).toBe(100);
  });

  it("treats a duplicate reservation as already done, not as an error", async () => {
    // The caller is often a retry. A retry that sees a failure retries again,
    // against a constraint that will never stop rejecting it.
    prismaMock.$transaction.mockRejectedValue(new UniqueViolation());

    const { reserveCredits } = await ledger();
    const result = await reserveCredits({
      userId: "u1",
      generationId: "g1",
      amount: 90,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("already_reserved");
  });

  it("refuses a negative amount outright", async () => {
    // A negative reservation is a credit grant wearing a disguise.
    const { reserveCredits } = await ledger();

    await expect(
      reserveCredits({ userId: "u1", generationId: "g1", amount: -50 }),
    ).rejects.toThrow(/non-negative/);
  });
});

describe("capture", () => {
  it("records the settlement once", async () => {
    const { captureReservation } = await ledger();

    expect(
      await captureReservation({
        userId: "u1",
        generationId: "g1",
        amount: 90,
        providerCostMicroUsd: 100_000,
      }),
    ).toBe(true);

    expect(prismaMock.creditTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 0,
          reason: "GENERATION_CAPTURE",
          idempotencyKey: "capture:g1",
        }),
      }),
    );
  });

  it("moves no credits", async () => {
    // A capture marks a reservation final. If it moved the balance, the
    // customer would be charged twice for one generation.
    const { captureReservation } = await ledger();

    await captureReservation({ userId: "u1", generationId: "g1", amount: 90 });

    const call = prismaMock.creditTransaction.create.mock.calls[0]![0] as {
      data: { amount: number };
    };
    expect(call.data.amount).toBe(0);
  });

  it("returns false on a second capture, so a poller can call it freely", async () => {
    prismaMock.creditTransaction.create.mockRejectedValue(
      new UniqueViolation(),
    );

    const { captureReservation } = await ledger();

    expect(
      await captureReservation({
        userId: "u1",
        generationId: "g1",
        amount: 90,
      }),
    ).toBe(false);
  });
});

describe("release", () => {
  it("returns credits when nothing has been captured", async () => {
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) =>
        fn(txClient([{ creditBalance: 100 }])),
    );

    const { releaseReservation } = await ledger();
    const result = await releaseReservation({
      userId: "u1",
      generationId: "g1",
      amount: 90,
      reason: "provider_rejected",
    });

    expect(result.released).toBe(true);
    expect(result.balance).toBe(100);
  });

  it("refuses to release after a capture", async () => {
    /**
     * The policy that stops the worst-behaved generations being the most
     * expensive ones.
     *
     * Replicate bills for GPU time whether or not the output was usable. An
     * automatic refund there means Atheos pays for the run *and* returns the
     * money — a guaranteed loss on every occurrence, worst on the models that
     * are failing most.
     */
    prismaMock.creditTransaction.findUnique.mockResolvedValue({ id: "t1" });

    const { releaseReservation } = await ledger();
    const result = await releaseReservation({
      userId: "u1",
      generationId: "g1",
      amount: 90,
      reason: "generation_failed",
    });

    expect(result.released).toBe(false);
    // The balance is reported unchanged, and no transaction was opened at all.
    expect(result.balance).toBe(100);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("pays out once when three tabs poll the same failed job", async () => {
    prismaMock.$transaction
      .mockImplementationOnce(async (fn: (tx: unknown) => unknown) =>
        fn(txClient([{ creditBalance: 100 }])),
      )
      .mockRejectedValue(new UniqueViolation());

    const { releaseReservation } = await ledger();
    const input = {
      userId: "u1",
      generationId: "g1",
      amount: 90,
      reason: "generation_failed",
    };

    const outcomes = [
      await releaseReservation(input),
      await releaseReservation(input),
      await releaseReservation(input),
    ];

    expect(outcomes.filter((result) => result.released)).toHaveLength(1);
  });

  it("does nothing for a zero-credit generation", async () => {
    const { releaseReservation } = await ledger();
    const result = await releaseReservation({
      userId: "u1",
      generationId: "g1",
      amount: 0,
      reason: "provider_rejected",
    });

    expect(result.released).toBe(false);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe("concurrency limits", () => {
  it("counts in-flight jobs from the generations table", async () => {
    // Counted rather than tracked in a column, because a counter has to be
    // decremented by every exit path including the ones that crash.
    prismaMock.generation.count.mockResolvedValue(3);

    const { activeJobCount } = await ledger();

    expect(await activeJobCount("u1")).toBe(3);
    expect(prismaMock.generation.count).toHaveBeenCalledWith({
      where: { userId: "u1", status: { in: ["QUEUED", "RUNNING"] } },
    });
  });
});

describe("plan-aware generation limits", () => {
  it("stops a free account at one job in flight", async () => {
    // The parallel-burst defence. A rate limit of twelve a minute permits
    // twelve *at once*, and twelve at once is what the audit rated Critical.
    prismaMock.generation.count.mockResolvedValue(1);

    const { checkGenerationLimits, limitMessage } =
      await import("@/services/limits/generation-limits");

    const verdict = await checkGenerationLimits({
      userId: "u1",
      tier: "FREE",
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("too_many_active_jobs");
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
    // The message says what to do, not what the policy is called.
    expect(limitMessage(verdict)).toMatch(/1 of 1/);
  });

  it("lets a paid account run several at once", async () => {
    prismaMock.generation.count.mockResolvedValue(2);

    const { checkGenerationLimits } =
      await import("@/services/limits/generation-limits");

    const verdict = await checkGenerationLimits({
      userId: "u2",
      tier: "PRO",
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.maxConcurrentJobs ?? verdict.plan.maxConcurrentJobs).toBe(5);
  });

  it("treats an unknown tier as the free plan", async () => {
    prismaMock.generation.count.mockResolvedValue(1);

    const { checkGenerationLimits } =
      await import("@/services/limits/generation-limits");

    const verdict = await checkGenerationLimits({ userId: "u3", tier: null });

    expect(verdict.allowed).toBe(false);
    expect(verdict.plan.tier).toBe("FREE");
  });
});
