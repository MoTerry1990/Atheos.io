import "server-only";

import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { AdminError, audit, requireAdmin } from "@/services/admin/auth";
import { planDefinitionFor } from "@/services/billing/catalogue";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Users, credits and support.
 *
 * ## Two rules, both about restraint
 *
 * **Adjusting credits goes through the ledger.** Never a bare `UPDATE` on
 * `creditBalance`. The append-only ledger is the whole reason the balance can
 * be explained (§ 5), and an admin tool that bypasses it would produce exactly
 * the unexplainable number the design exists to prevent. Every adjustment
 * carries an idempotency key and a stated reason.
 *
 * **Opening an account is a disclosure, and it is logged.** The support view
 * shows somebody's email, their generations and their payment history. An audit
 * trail that only records writes cannot answer "who looked at this account",
 * which is the question a privacy complaint actually asks.
 *
 * ## What this deliberately cannot do
 *
 * No password reset, no impersonation, no email change, no account deletion.
 * Identity is Clerk's (§ 2), and an admin tool that could act *as* somebody
 * would make every audit entry ambiguous about who was really there.
 */

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  handle: string | null;
  role: Role;
  creditBalance: number;
  createdAt: number;
  generationCount: number;
  planName: string | null;
  subscriptionStatus: string | null;
}

/**
 * Search users.
 *
 * By email, name or handle. Case-insensitive `contains`, which is a sequential
 * scan — correct while this is an internal tool over a table that fits in
 * memory, and the fix when it is not is an index rather than a redesign.
 */
export async function listUsers(
  options: { search?: string; limit?: number; cursor?: string } = {},
): Promise<{ users: AdminUserRow[]; nextCursor: string | null }> {
  await requireAdmin();

  const query = options.search?.trim();
  const take = Math.min(options.limit ?? 25, 100);

  const rows = await prisma.user.findMany({
    where: query
      ? {
          OR: [
            { email: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
            { handle: { contains: query, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    take: take + 1,
    select: {
      id: true,
      email: true,
      name: true,
      handle: true,
      role: true,
      creditBalance: true,
      createdAt: true,
      _count: { select: { generations: true } },
      subscription: { select: { planTier: true, status: true } },
    },
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return {
    users: page.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      handle: row.handle,
      role: row.role,
      creditBalance: row.creditBalance,
      createdAt: row.createdAt.getTime(),
      generationCount: row._count.generations,
      planName: row.subscription
        ? planDefinitionFor(row.subscription.planTier).name
        : null,
      subscriptionStatus: row.subscription?.status ?? null,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export interface AdminUserDetail extends AdminUserRow {
  clerkId: string;
  stripeCustomerId: string | null;
  recentGenerations: {
    id: string;
    model: string;
    status: string;
    creditsCost: number;
    createdAt: number;
  }[];
  recentCredits: {
    id: string;
    amount: number;
    reason: string;
    balanceAfter: number;
    createdAt: number;
  }[];
  subscription: {
    tier: string;
    status: string;
    interval: string;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
  } | null;
}

/**
 * One account, as support needs it.
 *
 * **This read is audited.** It exposes an email, a payment history and every
 * generation — a disclosure, not a lookup, and the log is what makes it
 * reviewable afterwards.
 *
 * Deliberately capped at twenty of each. Support answers "what happened
 * recently"; a full export is a different, deliberate act that should look
 * different in the audit trail.
 */
export async function getUserDetail(userId: string): Promise<AdminUserDetail> {
  const actor = await requireAdmin();

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      clerkId: true,
      email: true,
      name: true,
      handle: true,
      role: true,
      creditBalance: true,
      createdAt: true,
      stripeCustomerId: true,
      _count: { select: { generations: true } },
      subscription: {
        select: {
          planTier: true,
          status: true,
          interval: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
        },
      },
      generations: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          model: true,
          status: true,
          creditsCost: true,
          createdAt: true,
        },
      },
      creditTransactions: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          amount: true,
          reason: true,
          balanceAfter: true,
          createdAt: true,
        },
      },
    },
  });

  if (!row) throw new AdminError("User not found.", 404, "not_found");

  await audit(actor, {
    action: "support.view",
    subjectType: "user",
    subjectId: row.id,
    detail: { email: row.email },
  });

  return {
    id: row.id,
    clerkId: row.clerkId,
    email: row.email,
    name: row.name,
    handle: row.handle,
    role: row.role,
    creditBalance: row.creditBalance,
    createdAt: row.createdAt.getTime(),
    stripeCustomerId: row.stripeCustomerId,
    generationCount: row._count.generations,
    planName: row.subscription
      ? planDefinitionFor(row.subscription.planTier).name
      : null,
    subscriptionStatus: row.subscription?.status ?? null,
    recentGenerations: row.generations.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.getTime(),
    })),
    recentCredits: row.creditTransactions.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.getTime(),
    })),
    subscription: row.subscription
      ? {
          tier: row.subscription.planTier,
          status: row.subscription.status,
          interval: row.subscription.interval,
          currentPeriodEnd:
            row.subscription.currentPeriodEnd?.getTime() ?? null,
          cancelAtPeriodEnd: row.subscription.cancelAtPeriodEnd,
        }
      : null,
  };
}

/**
 * Adjust a credit balance.
 *
 * Positive or negative, always through the ledger, always with a reason.
 *
 * ## The reason is required, and it is not decoration
 *
 * An adjustment nobody can review is indistinguishable from theft, in either
 * direction. Requiring the sentence at the moment of the action is the only
 * time it will actually be written.
 *
 * ## The idempotency key is caller-supplied
 *
 * A support agent double-submitting a 5,000-credit goodwill grant is the exact
 * failure this must not have. The client generates a key per intent; the unique
 * constraint rejects the second attempt rather than application logic somebody
 * forgets to write.
 *
 * ## A balance is never allowed below zero
 *
 * A negative balance is a state nothing else in the product can represent — the
 * studio would show it, the billing page would render it, and no code path
 * knows how to recover from it.
 */
export async function adjustCredits(input: {
  userId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
}): Promise<{ balance: number; applied: boolean }> {
  const actor = await requireAdmin();

  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw new AdminError(
      "An adjustment must be a non-zero whole number.",
      400,
      "invalid_amount",
    );
  }
  // Bounded. Not because a larger correction is never right, but because a
  // typo of six zeros should not be one keystroke away from happening.
  if (Math.abs(input.amount) > 1_000_000) {
    throw new AdminError(
      "Adjustments above 1,000,000 credits need a database migration and a second pair of eyes.",
      400,
      "amount_too_large",
    );
  }
  if (!input.reason.trim()) {
    throw new AdminError(
      "State a reason. An adjustment nobody can review is one nobody can defend.",
      400,
      "reason_required",
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, creditBalance: true },
  });
  if (!target) throw new AdminError("User not found.", 404, "not_found");

  if (target.creditBalance + input.amount < 0) {
    throw new AdminError(
      `That would leave a negative balance. They hold ${target.creditBalance}.`,
      400,
      "would_go_negative",
    );
  }

  try {
    const balance = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: target.id },
        data: { creditBalance: { increment: input.amount } },
        select: { creditBalance: true },
      });

      await tx.creditTransaction.create({
        data: {
          userId: target.id,
          amount: input.amount,
          reason: "MANUAL_ADJUSTMENT",
          balanceAfter: updated.creditBalance,
          idempotencyKey: `admin:${input.idempotencyKey}`,
          metadata: {
            adjustedBy: actor.user.email,
            reason: input.reason.trim(),
          } as never,
        },
      });

      // Same transaction as the money. An adjustment that commits without its
      // audit row is one nobody can answer for.
      await audit(
        actor,
        {
          action: "credits.adjust",
          subjectType: "user",
          subjectId: target.id,
          detail: {
            amount: input.amount,
            balanceBefore: target.creditBalance,
            balanceAfter: updated.creditBalance,
            email: target.email,
          },
          reason: input.reason.trim(),
        },
        tx,
      );

      return updated.creditBalance;
    });

    return { balance, applied: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Already applied. Success, not an error — a retry that reports failure
      // invites a second, genuinely duplicate, adjustment.
      const current = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { creditBalance: true },
      });
      return { balance: current?.creditBalance ?? 0, applied: false };
    }
    throw error;
  }
}

/**
 * Grant or revoke admin.
 *
 * Cannot be used on yourself, in either direction. Self-promotion would make
 * the column a way around the environment allowlist; self-demotion is how an
 * organisation locks itself out.
 *
 * Somebody in `ADMIN_USER_IDS` keeps access regardless of this column — that is
 * the recovery path, and it is why the check in `auth.ts` is an `or`.
 */
export async function setRole(input: {
  userId: string;
  role: Role;
  reason: string;
}): Promise<{ role: Role }> {
  const actor = await requireAdmin();

  if (input.userId === actor.user.id) {
    throw new AdminError(
      "You cannot change your own role. Ask another admin, or use ADMIN_USER_IDS.",
      400,
      "self_role_change",
    );
  }
  if (!input.reason.trim()) {
    throw new AdminError("State a reason.", 400, "reason_required");
  }

  const target = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, role: true },
  });
  if (!target) throw new AdminError("User not found.", 404, "not_found");

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { role: input.role },
    });

    await audit(
      actor,
      {
        action: "user.role",
        subjectType: "user",
        subjectId: target.id,
        detail: { from: target.role, to: input.role, email: target.email },
        reason: input.reason.trim(),
      },
      tx,
    );
  });

  return { role: input.role };
}
