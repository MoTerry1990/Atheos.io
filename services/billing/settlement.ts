import "server-only";

import { prisma } from "@/lib/prisma";
import { emit } from "@/lib/events";

/**
 * The one place a generation is settled as permanently undelivered.
 *
 * ## The gap this closes
 *
 * `markFailed` set `status = 'FAILED'` and nothing else. No credit ever came
 * back. That was invisible for as long as the worker never ran, and the moment
 * it did run — Sprint 5C, first successful tick — it failed a job and left the
 * customer 90 credits short. The refund had to be applied by hand.
 *
 * A grep across the tree at that point found **no code path writing
 * `GENERATION_REFUND` at all**. The nine historical refunds in production came
 * from a path that no longer exists. So this is not a refactor of a working
 * mechanism; it is the mechanism.
 *
 * ## Provider success is not customer success
 *
 * The rule this file enforces: money comes back to the customer when Atheos
 * fails to deliver a durable asset, **whatever the provider did**. Replicate
 * succeeding and Atheos losing the output is still a delivery failure from the
 * only perspective that matters.
 *
 * The provider's expense is a separate fact and is never erased —
 * `providerJobId`, `creditsCost` and `costMicroUsd` stay exactly as they were,
 * so budget and spending controls still see what was really spent. Refunding
 * the customer and forgetting the cost would quietly understate spend, which is
 * the failure mode the whole financial-safety sprint existed to prevent.
 *
 * ## Two financial models, one at a time
 *
 * Generations created before the reservation model debited directly with
 * `spend:{id}`; current ones reserve with `reserve:{id}` and settle with
 * `capture:{id}` or `release:{id}`. Both still exist in production, so this
 * picks the correct reversal per generation and **never performs both**:
 *
 *   reservation, uncaptured   → `releaseReservation`, key `release:{id}`
 *   legacy direct spend       → refund,               key `refund:{id}`
 *   captured                  → nothing; the work was billable
 *   already reversed          → nothing
 *
 * Every key is deterministic and unique, so a duplicate webhook, a second
 * worker and a retried cron all collapse to one financial effect.
 */

/** Machine-readable permanent-failure reasons. Safe to store and to show. */
export const FAILURE_CODES = {
  PROVIDER_FAILED: "PROVIDER_FAILED",
  PROVIDER_CANCELED: "PROVIDER_CANCELED",
  SUBMISSION_FAILED: "SUBMISSION_FAILED",
  RETRIES_EXHAUSTED: "RETRIES_EXHAUSTED",
  EMPTY_OUTPUT: "EMPTY_OUTPUT",
  OUTPUT_EXPIRED_BEFORE_PERSISTENCE: "OUTPUT_EXPIRED_BEFORE_PERSISTENCE",
  DOWNLOAD_FAILED: "DOWNLOAD_FAILED",
  INVALID_CONTENT_TYPE: "INVALID_CONTENT_TYPE",
  OUTPUT_TOO_LARGE: "OUTPUT_TOO_LARGE",
  STORAGE_FAILED: "STORAGE_FAILED",
  INTERNAL_FINALIZATION_FAILED: "INTERNAL_FINALIZATION_FAILED",
} as const;

export type FailureCode = (typeof FAILURE_CODES)[keyof typeof FAILURE_CODES];

export type FinancialOutcome =
  | "released" // reservation returned
  | "refunded" // legacy spend returned
  | "retained" // captured: provider work was billable
  | "already" // a reversal already existed
  | "none"; // nothing was ever charged

export interface SettlementResult {
  /** False when the generation was already terminal — a no-op replay. */
  settled: boolean;
  financial: FinancialOutcome;
  balance: number | null;
  code: FailureCode;
}

/**
 * Settle a generation as permanently undelivered.
 *
 * Safe to call repeatedly and concurrently: the status transition is a
 * conditional `updateMany` and every ledger write is guarded by a unique
 * idempotency key.
 */
export async function settleFailedDelivery(input: {
  generationId: string;
  code: FailureCode;
  message: string;
  /** When set, only settles a job this worker still holds the lease on. */
  workerId?: string;
}): Promise<SettlementResult> {
  const generation = await prisma.generation.findUnique({
    where: { id: input.generationId },
    select: {
      id: true,
      userId: true,
      status: true,
      creditsCost: true,
      _count: { select: { assets: true } },
    },
  });

  if (!generation) {
    return {
      settled: false,
      financial: "none",
      balance: null,
      code: input.code,
    };
  }

  /**
   * A delivered asset ends the discussion.
   *
   * If the customer has something durable, this was not a delivery failure,
   * and refunding would hand back credits for work they can still use.
   */
  if (generation._count.assets > 0) {
    emit("credit.refund.refused", {
      generationId: generation.id,
      reason: "a durable asset exists",
    });
    return {
      settled: false,
      financial: "retained",
      balance: null,
      code: input.code,
    };
  }

  /**
   * Reversal and transition in **one** transaction.
   *
   * Previously these were two statements: the ledger moved, then the status
   * moved. A crash between them left a refunded customer whose generation
   * still read QUEUED, which the next tick would claim and settle again — and
   * only the idempotency key stopped that becoming a second refund. Relying on
   * the key to paper over a torn write is not the same as not tearing.
   *
   * Everything below commits together or not at all.
   */
  let outcome: {
    financial: { outcome: FinancialOutcome; balance: number | null };
    settled: boolean;
  };

  try {
    outcome = await prisma.$transaction(async (tx) => {
      const financial = await reverseChargeWithin(
        tx,
        generation.id,
        generation.userId,
      );

      /**
       * `updateMany` with a status filter rather than `update`: two workers
       * racing here means the second matches zero rows instead of overwriting a
       * terminal state and a `completedAt` that already happened.
       */
      const transition = await tx.generation.updateMany({
        where: {
          id: generation.id,
          status: { in: ["QUEUED", "RUNNING", "RETRYING"] },
          ...(input.workerId ? { lockedBy: input.workerId } : {}),
        },
        data: {
          status: "FAILED",
          error: `${input.code}: ${input.message}`.slice(0, 1000),
          completedAt: new Date(),
          // The lease is released here; nothing reclaims a terminal job.
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: null,
        },
      });

      return { financial, settled: transition.count === 1 };
    });
  } catch (error) {
    // Someone else reversed first; their transaction committed and ours rolled
    // back whole. That is the designed outcome of the race, not a failure.
    if (error instanceof AlreadyReversed) {
      return {
        settled: false,
        financial: "already",
        balance: null,
        code: input.code,
      };
    }
    throw error;
  }

  const financial = outcome.financial;
  const settled = outcome.settled;

  await writeLog(generation.id, settled ? "error" : "info", "delivery failed", {
    code: input.code,
    financial: financial.outcome,
    transitioned: settled,
  });

  return {
    settled,
    financial: financial.outcome,
    balance: financial.balance,
    code: input.code,
  };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Signals a lost idempotency race so the caller can report a clean no-op. */
class AlreadyReversed extends Error {}

/**
 * Return the customer's credits by whichever route this generation was charged.
 *
 * Takes the transaction client so the reversal and the status transition commit
 * together. It deliberately does **not** call `releaseReservation`: that helper
 * opens its own transaction, and nesting one inside this would either deadlock
 * or silently commit early. The keys and the precedence are identical.
 *
 * Reads the ledger rather than trusting a flag on the generation. The ledger is
 * the append-only record, and the unique keys on it are what actually prevent a
 * double reversal.
 */
async function reverseChargeWithin(
  tx: Tx,
  generationId: string,
  userId: string,
): Promise<{ outcome: FinancialOutcome; balance: number | null }> {
  const rows = await tx.creditTransaction.findMany({
    where: {
      idempotencyKey: {
        in: [
          `reserve:${generationId}`,
          `capture:${generationId}`,
          `release:${generationId}`,
          `spend:${generationId}`,
          `refund:${generationId}`,
        ],
      },
    },
    select: { idempotencyKey: true, amount: true },
  });

  const by = new Map(rows.map((row) => [row.idempotencyKey, row.amount]));

  // Already reversed by either route — nothing left to do.
  if (by.has(`release:${generationId}`) || by.has(`refund:${generationId}`)) {
    return { outcome: "already", balance: null };
  }

  // Captured means the provider work was billable and kept. Not ours to return.
  if (by.has(`capture:${generationId}`)) {
    return { outcome: "retained", balance: null };
  }

  const reserved = by.get(`reserve:${generationId}`);
  const spent = by.get(`spend:${generationId}`);
  const charged = reserved ?? spent;

  // Nothing was ever taken from this customer.
  if (charged === undefined) return { outcome: "none", balance: null };

  const amount = Math.abs(charged);
  if (amount <= 0) return { outcome: "none", balance: null };

  /**
   * `RELEASE` returns an unspent reservation; `REFUND` returns a debit that has
   * already left the balance. They are different events to the reporting
   * queries that read them, so the reason follows how the money was taken.
   */
  const reserving = reserved !== undefined;
  const key = reserving ? `release:${generationId}` : `refund:${generationId}`;
  const reason = reserving ? "GENERATION_RELEASE" : "GENERATION_REFUND";

  try {
    const user = await tx.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: amount } },
      select: { creditBalance: true },
    });

    await tx.creditTransaction.create({
      data: {
        userId,
        generationId,
        amount,
        balanceAfter: user.creditBalance,
        reason,
        idempotencyKey: key,
      },
    });

    emit("credit.refund", { generationId, amount });
    return {
      outcome: reserving ? "released" : "refunded",
      balance: user.creditBalance,
    };
  } catch (error) {
    /**
     * A unique-key collision means a concurrent caller reversed first. Throwing
     * rolls the whole transaction back, which is correct: the balance was not
     * incremented twice, and the loser of the race reports a clean no-op.
     */
    if (isUniqueViolation(error)) throw new AlreadyReversed();
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Lifecycle logging that cannot corrupt financial state.
 *
 * Swallows its own failure deliberately: a full log table must not roll back a
 * refund. The console line keeps it observable.
 *
 * Context is a closed set of scalars — no prompt, no output URL, no provider
 * response, no header. `generation_logs` is readable by support.
 */
export async function writeLog(
  generationId: string,
  level: "info" | "warn" | "error",
  message: string,
  context?: Record<string, string | number | boolean | null>,
): Promise<void> {
  try {
    await prisma.generationLog.create({
      data: {
        generationId,
        level,
        message: message.slice(0, 2000),
        ...(context ? { context } : {}),
      },
    });
  } catch (error) {
    console.error(`[settlement] log write failed for ${generationId}`, error);
  }
}
