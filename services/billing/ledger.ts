import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { emit } from "@/lib/events";

/**
 * The credit ledger: reserve, capture, release.
 *
 * ## The bug this replaces
 *
 * `services/generation.ts` used to read the balance, compare it to the price,
 * and then decrement — with the read outside the transaction that did the
 * decrement:
 *
 *   const user = await requireApiUser();            // balance read here
 *   if (user.creditBalance < cost) throw ...        // checked here
 *   await prisma.$transaction(...)                  // decremented here
 *
 * Two requests arriving together both read 100, both pass a check against 100,
 * and both subtract 90. The balance ends at −80, the ledger stays internally
 * consistent because `balanceAfter` is computed from each update's own return
 * value, and two video generations have been submitted to a provider that will
 * invoice us for both.
 *
 * The audit rated it exploitable rather than theoretical: 20 parallel requests
 * against one 100-credit free account start 20 video generations worth
 * $2–$4 of provider spend, and API keys plus `/api/mcp` make it scriptable
 * without a browser. Repeated across throwaway accounts it reaches the $500
 * ceiling in an afternoon.
 *
 * ## The fix is a conditional update, not a bigger transaction
 *
 * Wrapping the read in the transaction is not enough — Postgres' default READ
 * COMMITTED isolation lets both transactions read the same row before either
 * writes. `SELECT ... FOR UPDATE` would work, and so would SERIALIZABLE, and
 * both make the caller responsible for retrying.
 *
 * A single conditional statement needs neither:
 *
 *   UPDATE users SET "creditBalance" = "creditBalance" - $1
 *   WHERE id = $2 AND "creditBalance" >= $1
 *
 * Postgres takes a row lock for the duration of the UPDATE, so the second
 * request re-evaluates `creditBalance >= $1` against the value the first one
 * wrote. It affects **zero rows**, and zero rows is how insufficient credit is
 * detected. There is no window between the check and the write because they are
 * the same statement.
 *
 * A `CHECK (creditBalance >= 0)` constraint backs it up. Belt and braces on
 * purpose: the conditional update is the mechanism, and the constraint is what
 * catches the next piece of code that forgets to use it.
 *
 * ## Why reserving debits the balance immediately
 *
 * The alternative — a separate `reservedCredits` column — keeps the headline
 * balance flattering while a job is in flight. It also means two numbers that
 * can disagree, and a crash between provider submission and settlement leaves
 * credits stranded in a column nobody reads.
 *
 * Debiting on reserve keeps `balance = SUM(amount)` true at every instant,
 * which is the property that makes the ledger auditable at all. The user sees
 * the cost the moment they spend it, which is also the honest thing to show.
 *
 * ## Idempotency is a unique index
 *
 *   `reserve:{generationId}`   at most one debit per generation
 *   `capture:{generationId}`   at most one settlement
 *   `release:{generationId}`   at most one refund
 *
 * Not an `if` somebody remembers to write. The callers are webhooks, pollers
 * and three browser tabs open on the same job, all of which retry by design.
 */

export interface ReserveResult {
  ok: boolean;
  /** Balance after the reservation, or the current balance when it failed. */
  balance: number;
  /** Set when `ok` is false. */
  reason?: "insufficient_credits" | "already_reserved";
}

/**
 * The conditional debit, as one statement.
 *
 * Exported so `tests/db/credit-ledger.test.ts` can run **this exact string**
 * against real Postgres rather than a copy of it. `tests/db/worker-queue.test.ts`
 * notes that duplicating SQL into a test proves the query is correct without
 * proving the application sends that query; exporting it closes that gap for
 * the one query where the gap costs money.
 *
 * `$1` appears twice deliberately — the amount subtracted and the amount
 * required are necessarily the same number, and passing them separately would
 * allow a caller to check one and deduct another.
 */
export const RESERVE_SQL = `
  UPDATE users
     SET "creditBalance" = "creditBalance" - $1,
         "updatedAt" = now()
   WHERE id = $2
     AND "creditBalance" >= $1
  RETURNING "creditBalance"
`;

/** The mirror image, for releases. No condition — adding back always succeeds. */
export const RELEASE_SQL = `
  UPDATE users
     SET "creditBalance" = "creditBalance" + $1,
         "updatedAt" = now()
   WHERE id = $2
  RETURNING "creditBalance"
`;

export interface ReserveInput {
  userId: string;
  generationId: string;
  amount: number;
  /** Recorded on the ledger row. Never contains prompts or user content. */
  metadata?: Record<string, unknown>;
}

/**
 * The reservation itself, on a caller-supplied client.
 *
 * Split out so `services/generation.ts` can create the generation row and
 * reserve its credits in **one** transaction. Two transactions would leave a
 * window where a generation exists that nobody has paid for — and the failure
 * that lands in that window is a provider submission for an unpaid job.
 *
 * Unique-key collisions are **not** caught here. Inside a transaction Postgres
 * aborts the whole thing on a constraint violation, so catching it would leave
 * the caller holding a dead transaction that fails on its next statement. The
 * wrapper below handles that case, where it can be handled honestly.
 */
export async function reserveWithin(
  tx: Prisma.TransactionClient,
  input: ReserveInput,
): Promise<ReserveResult> {
  if (input.amount < 0) {
    throw new Error("reserveCredits expects a non-negative amount");
  }

  const rows = await tx.$queryRawUnsafe<{ creditBalance: number }[]>(
    RESERVE_SQL,
    input.amount,
    input.userId,
  );

  // Zero rows means the WHERE clause failed. The row exists — the caller is
  // authenticated — so the only unmet condition is the balance.
  if (rows.length === 0) {
    const current = await tx.user.findUnique({
      where: { id: input.userId },
      select: { creditBalance: true },
    });

    emit("credit.reserve.insufficient", {
      userId: input.userId,
      generationId: input.generationId,
      required: input.amount,
      balance: current?.creditBalance ?? 0,
    });

    return {
      ok: false,
      balance: current?.creditBalance ?? 0,
      reason: "insufficient_credits",
    };
  }

  const balance = rows[0]!.creditBalance;

  await tx.creditTransaction.create({
    data: {
      userId: input.userId,
      amount: -input.amount,
      reason: "GENERATION_RESERVATION",
      balanceAfter: balance,
      generationId: input.generationId,
      // A zero-credit generation still gets a ledger row, so every generation
      // has one and reconciliation never special-cases the free ones.
      idempotencyKey: `reserve:${input.generationId}`,
      metadata: input.metadata as never,
    },
  });

  emit("credit.reserve", {
    userId: input.userId,
    generationId: input.generationId,
    credits: input.amount,
    balanceAfter: balance,
  });

  return { ok: true, balance };
}

/**
 * Take credits for a generation that has not been submitted yet.
 *
 * Returns `ok: false` rather than throwing, because "not enough credits" is an
 * ordinary answer to an ordinary request — a 402 the caller renders — and not
 * an exceptional condition.
 */
export async function reserveCredits(
  input: ReserveInput,
): Promise<ReserveResult> {
  try {
    return await prisma.$transaction((tx) => reserveWithin(tx, input));
  } catch (error) {
    /**
     * The idempotency key already exists — this generation is already paid for.
     *
     * The transaction rolled back with the exception, so the second debit did
     * not stick. Reporting this as `already_reserved` rather than as an error
     * matters because the caller is often a retry, and a retry that sees a
     * failure will retry again.
     */
    if (isUniqueViolation(error)) {
      const current = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { creditBalance: true },
      });

      return {
        ok: false,
        balance: current?.creditBalance ?? 0,
        reason: "already_reserved",
      };
    }
    throw error;
  }
}

/**
 * Mark a reservation final. The balance does not move.
 *
 * ## Why this exists at all, given it changes no number
 *
 * It records the moment the money stopped being refundable — the point where
 * the provider has accepted work we will be invoiced for. Without it, "should
 * this failure be refunded?" is answered by inspecting job status, which is a
 * different system's opinion about a financial question.
 *
 * Written as a ledger row rather than a column on the reservation because the
 * ledger is append-only. Updating the reservation row to say "captured" would
 * destroy the record of what it looked like before, which is the one thing an
 * append-only ledger exists to prevent.
 *
 * Returns false when it has already happened. Safe to call from a poller.
 */
export async function captureReservation(input: {
  userId: string;
  generationId: string;
  amount: number;
  /** Micro-USD we expect to be invoiced. Recorded for spend reconciliation. */
  providerCostMicroUsd?: number | null;
}): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { creditBalance: true },
    });

    await prisma.creditTransaction.create({
      data: {
        userId: input.userId,
        amount: 0,
        reason: "GENERATION_CAPTURE",
        balanceAfter: user?.creditBalance ?? 0,
        generationId: input.generationId,
        idempotencyKey: `capture:${input.generationId}`,
        metadata: {
          reservedCredits: input.amount,
          providerCostMicroUsd: input.providerCostMicroUsd ?? null,
        } as never,
      },
    });

    emit("credit.capture", {
      userId: input.userId,
      generationId: input.generationId,
      credits: input.amount,
    });

    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/**
 * Give reserved credits back.
 *
 * ## Only when the provider has not been engaged
 *
 * A submission rejected by validation, a model that turned out to be disabled,
 * a network error before the request was accepted — nothing has been billed and
 * the customer must not pay.
 *
 * A job that fails *after* the provider accepted it is a different situation.
 * Replicate bills for GPU time whether or not the output was usable, so an
 * automatic refund there means Atheos pays for the run and returns the money
 * too. Those are recorded for review instead — see `needsManualReview` on the
 * capture path in `services/generation.ts`. That is a policy decision and it is
 * written down rather than implied by an absence.
 *
 * Refusing to release after a capture is enforced here rather than trusted to
 * the caller, because the caller is the failure handler and failure handlers
 * are the least-tested code in any system.
 */
export async function releaseReservation(input: {
  userId: string;
  generationId: string;
  amount: number;
  reason: string;
}): Promise<{ released: boolean; balance: number }> {
  if (input.amount <= 0) {
    const current = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { creditBalance: true },
    });
    return { released: false, balance: current?.creditBalance ?? 0 };
  }

  // Captured means billable. Not ours to give back.
  const captured = await prisma.creditTransaction.findUnique({
    where: { idempotencyKey: `capture:${input.generationId}` },
    select: { id: true },
  });

  if (captured) {
    emit("credit.release.refused", {
      generationId: input.generationId,
      reason: "already captured — provider work was billable",
    });

    const current = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { creditBalance: true },
    });
    return { released: false, balance: current?.creditBalance ?? 0 };
  }

  try {
    const balance = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ creditBalance: number }[]>(
        RELEASE_SQL,
        input.amount,
        input.userId,
      );

      const next = rows[0]?.creditBalance ?? 0;

      await tx.creditTransaction.create({
        data: {
          userId: input.userId,
          amount: input.amount,
          reason: "GENERATION_RELEASE",
          balanceAfter: next,
          generationId: input.generationId,
          idempotencyKey: `release:${input.generationId}`,
          metadata: { reason: input.reason } as never,
        },
      });

      return next;
    });

    emit("credit.release", {
      userId: input.userId,
      generationId: input.generationId,
      credits: input.amount,
      reason: input.reason,
    });

    return { released: true, balance };
  } catch (error) {
    // Already released. The generation is settled; report the live balance.
    if (isUniqueViolation(error)) {
      const current = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { creditBalance: true },
      });
      return { released: false, balance: current?.creditBalance ?? 0 };
    }
    throw error;
  }
}

/**
 * How many generations this user currently has in flight.
 *
 * Counted from the generations table rather than from a counter column, because
 * a counter has to be decremented by every exit path including the ones that
 * crash. A `COUNT(*)` over an indexed status is cheap and cannot drift.
 */
export async function activeJobCount(userId: string): Promise<number> {
  return prisma.generation.count({
    where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
  });
}
