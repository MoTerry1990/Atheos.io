import "server-only";

import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/prisma-errors";
import type { CreditReason } from "@/lib/generated/prisma/enums";

/**
 * Granting credits.
 *
 * Sprint 6 built the spend and refund halves of the ledger inside
 * `services/generation.ts`. This is the money half, and it is the one that has
 * to be exactly-once: a double-granted subscription renewal is inventory given
 * away, and a missed one is a customer who paid and got nothing.
 *
 * ## Idempotency is a database constraint, not a check
 *
 * `idempotencyKey` is unique. A second attempt is rejected by Postgres, not by
 * an `if` somebody forgets to write — which matters because the callers are
 * webhooks, and Stripe retries **by design**: it redelivers on any non-2xx, and
 * it can deliver the same event twice even on success.
 *
 * The key is derived from the Stripe object, so retries of the same event
 * collide and genuinely separate payments do not:
 *
 *   `invoice:{invoiceId}`   a subscription period's allowance
 *   `pack:{sessionId}`      a one-off credit pack
 *   `signup:{userId}`       the joining grant
 *
 * ## Balance and ledger move together
 *
 * Both writes are in one transaction. A balance without a ledger entry is a
 * number nobody can explain; a ledger entry without a balance is credits the
 * user cannot spend. Neither is recoverable without manual accounting.
 */

export interface GrantResult {
  granted: boolean;
  balance: number;
}

export async function grantCredits(input: {
  userId: string;
  amount: number;
  reason: CreditReason;
  idempotencyKey: string;
  stripeReference?: string;
  metadata?: Record<string, unknown>;
}): Promise<GrantResult> {
  if (input.amount <= 0) {
    throw new Error("grantCredits expects a positive amount");
  }

  try {
    const balance = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: input.userId },
        data: { creditBalance: { increment: input.amount } },
        select: { creditBalance: true },
      });

      await tx.creditTransaction.create({
        data: {
          userId: input.userId,
          amount: input.amount,
          reason: input.reason,
          balanceAfter: user.creditBalance,
          stripeReference: input.stripeReference,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata as never,
        },
      });

      return user.creditBalance;
    });

    return { granted: true, balance };
  } catch (error) {
    // P2002 on the idempotency key means this grant already happened. That is
    // success, not failure — returning an error would make the webhook retry
    // forever against a constraint that will never stop rejecting it.
    if (isUniqueViolation(error)) {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { creditBalance: true },
      });
      return { granted: false, balance: user?.creditBalance ?? 0 };
    }
    throw error;
  }
}

/**
 * The ledger, newest first. This is "Billing History" in the interface.
 *
 * Deliberately the **ledger**, not Stripe's invoices. An invoice says money
 * moved; this says what happened to the balance — including the grants,
 * refunds and spend that never touched a card. A user asking "why do I have
 * this many credits" is asking about this, not about receipts.
 */
export async function listCreditHistory(
  userId: string,
  options: { limit?: number; before?: Date } = {},
) {
  const rows = await prisma.creditTransaction.findMany({
    where: {
      userId,
      ...(options.before ? { createdAt: { lt: options.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(options.limit ?? 50, 200),
    select: {
      id: true,
      amount: true,
      reason: true,
      balanceAfter: true,
      stripeReference: true,
      createdAt: true,
      generation: {
        select: { id: true, model: true, operation: true, modality: true },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    amount: row.amount,
    reason: row.reason,
    balanceAfter: row.balanceAfter,
    stripeReference: row.stripeReference,
    createdAt: row.createdAt.getTime(),
    generation: row.generation,
  }));
}
