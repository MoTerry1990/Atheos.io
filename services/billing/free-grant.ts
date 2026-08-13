import "server-only";

import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { SIGNUP_GRANT } from "@/services/billing/catalogue";

/**
 * The Free tier's monthly allowance.
 *
 * ## The promise this keeps
 *
 * The pricing page has always said the Free plan is "100 credits monthly".
 * Until now the only thing that granted credits on a schedule was the Stripe
 * webhook, which fires for paid subscriptions and nothing else — so a free user
 * received 100 credits **once, at sign-up, forever**. The page was advertising a
 * recurring allowance the product did not deliver, and the person who noticed
 * would be someone who came back a month later to find nothing had reset.
 *
 * Paid tiers are unaffected: their grants arrive with the invoice, which is the
 * right trigger because it is the one that proves they paid.
 *
 * ## Rollover, exactly as stated
 *
 * `PRICING_NOTE` says unused credits roll over for one month. So the grant is
 * the full allowance, and the resulting balance is capped at **twice** it. One
 * idle month accumulates; two do not. Without the cap an account left alone for
 * a year would come back to 1,200 free credits, which is roughly $1.20 of
 * provider spend we never agreed to.
 *
 * ## Idempotency is per calendar month, not per 30 days
 *
 * `free-grant:{userId}:{YYYY-MM}` — a unique key, so the database refuses a
 * second grant for the same month no matter how many times the cron runs, how
 * many instances run it at once, or whether a previous run half-failed. A
 * rolling 30-day window would drift a day earlier each month and eventually
 * pay out thirteen times a year.
 */

/** How many months of allowance a balance may accumulate to. */
const ROLLOVER_MONTHS = 2;

export interface FreeGrantResult {
  /** Accounts that received credits. */
  granted: number;
  /** Accounts skipped because they were already at or above the cap. */
  skipped: number;
  /** Accounts whose grant for this period already existed. */
  alreadyGranted: number;
}

/** `2026-08`. UTC, so the boundary does not move with the server's timezone. */
export function grantPeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Top up every free account for the current month.
 *
 * Safe to call repeatedly — that is the point. The cron runs daily, so the
 * first run of a month grants and the other thirty are no-ops.
 */
export async function grantFreeMonthlyCredits(
  now: Date = new Date(),
): Promise<FreeGrantResult> {
  const period = grantPeriod(now);
  const cap = SIGNUP_GRANT * ROLLOVER_MONTHS;

  const result: FreeGrantResult = {
    granted: 0,
    skipped: 0,
    alreadyGranted: 0,
  };

  // Free means "no subscription row, or a subscription row on the free tier".
  // Checking the subscription rather than a column on the user keeps this in
  // agreement with what the billing screen shows.
  const users = await prisma.user.findMany({
    where: {
      OR: [{ subscription: null }, { subscription: { planTier: "STARTER" } }],
      creditBalance: { lt: cap },
    },
    select: { id: true, creditBalance: true },
  });

  for (const user of users) {
    // Clamped so the grant never carries a balance past the rollover cap.
    const amount = Math.min(SIGNUP_GRANT, cap - user.creditBalance);
    if (amount <= 0) {
      result.skipped += 1;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: a generation may have spent credits
        // between the query above and here, and `balanceAfter` must be the
        // balance that actually resulted or the ledger stops reconciling.
        const current = await tx.user.update({
          where: { id: user.id },
          data: { creditBalance: { increment: amount } },
          select: { creditBalance: true },
        });

        await tx.creditTransaction.create({
          data: {
            userId: user.id,
            amount,
            reason: "SUBSCRIPTION_GRANT",
            balanceAfter: current.creditBalance,
            idempotencyKey: `free-grant:${user.id}:${period}`,
          },
        });
      });

      result.granted += 1;
    } catch (error) {
      // The unique key did its job — this account already has this month's
      // grant. Not an error, and the transaction rolled the increment back
      // with it, so the balance is untouched.
      if (isUniqueViolation(error)) {
        result.alreadyGranted += 1;
        continue;
      }
      throw error;
    }
  }

  return result;
}
