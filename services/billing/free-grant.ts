import "server-only";

import { prisma } from "@/lib/prisma";
import { SIGNUP_GRANT } from "@/services/billing/catalogue";

/**
 * The Free plan's credits: **once, at sign-up. Never again.**
 *
 * ## What changed, and why
 *
 * Sprint 26 built `grantFreeMonthlyCredits()` because the pricing page said
 * "100 credits monthly" and the product only ever granted them once. That fixed
 * a real mismatch — in the wrong direction.
 *
 * A renewable free allowance is a **perpetual liability**. Every account ever
 * created keeps drawing provider spend forever, whether or not anybody is still
 * using it, and the bill grows monotonically with signups rather than with
 * revenue. On a $500 monthly ceiling that is the one shape of cost that cannot
 * be managed: it is not correlated with anything that earns money.
 *
 * The audit rated it B6 / P1 and the founder's launch plan resolves it
 * explicitly — free credits are a one-time welcome grant. So the renewal is
 * gone, the pricing copy says "one-time", and this module now exists to *state
 * that no renewal happens* and to hold the abuse analysis, rather than to run a
 * job.
 *
 * ## Where the grant actually happens
 *
 * `services/users/provision.ts`, inside the transaction that creates the user,
 * with `idempotencyKey = signup-grant:{clerkId}`. That is the correct place and
 * it needs no help from here:
 *
 *   - It runs once because the key is unique in the database, not because the
 *     code checks first. A retried webhook, a race between the webhook and the
 *     first sign-in, and a double-clicked sign-up button all collide on the
 *     same key and the second one is refused by Postgres.
 *   - It is keyed on the Clerk id, which is stable for the life of the account,
 *     so deleting and restoring a user does not re-grant.
 *   - Existing users cannot receive a second grant, because their key already
 *     exists. No backfill, no exclusion list, no dated cutoff.
 *
 * ## The abuse limitation, stated plainly
 *
 * One grant per *account* is not one grant per *person*. A Clerk user id is
 * created by anybody with an email address, and disposable addresses are free
 * and unlimited. Nothing in this architecture prevents somebody from
 * registering fifty accounts and collecting fifty grants.
 *
 * What is actually in place, and what each is worth:
 *
 * | Signal                     | Status                     | What it buys                                            |
 * | -------------------------- | -------------------------- | ------------------------------------------------------- |
 * | Unique email               | Enforced by Clerk          | Stops the laziest duplication; defeated by `+` aliasing  |
 * | Clerk bot detection        | On                         | Stops naive automation                                   |
 * | Sign-up rate limit per IP  | **Added this sprint**      | 5/hour — turns an afternoon's farm into a month's        |
 * | Free concurrency cap of 1  | **Added this sprint**      | Caps the *burst* value of any single account             |
 * | No video on Free           | **Added this sprint**      | Caps the *unit* value: images only, ~$0.18 worst case    |
 * | Global spend breaker       | **Added this sprint**      | Caps the *aggregate*, which is the number that matters   |
 *
 * The last row is the honest answer. Perfect per-person identity is not
 * achievable without measures this product should not take — device
 * fingerprinting, phone verification, or requiring a card from somebody who has
 * not agreed to pay. So the design does not try to make each account
 * unprofitable to farm; it makes the total bounded, which is the property the
 * business actually needs. A thousand farmed accounts cannot exceed the $225
 * free-generation threshold, because at $225 free generation stops.
 *
 * Deliberately **not** implemented: IP-based grant denial (shared NAT means one
 * office or one university blocks everybody behind it), email-domain
 * blocklists (they go stale weekly and catch real users), and any form of
 * browser fingerprinting.
 *
 * Email verification before generating is the one cheap improvement left, and
 * it is recommended for Sprint 5 rather than smuggled in here.
 */

/** What a new account receives, once. Re-exported so callers need one import. */
export const FREE_SIGNUP_GRANT = SIGNUP_GRANT;

/**
 * `2026-08`. UTC, so the boundary does not move with the server's timezone.
 *
 * Kept because the ledger's historical `free-grant:{userId}:{YYYY-MM}` keys use
 * this format and `services/admin` reads them. It no longer drives a grant.
 */
export function grantPeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface FreeGrantAudit {
  /** Accounts that have received their one-time grant. */
  granted: number;
  /** Free accounts with no grant row — a provisioning failure, if non-zero. */
  missing: number;
  /**
   * Accounts holding more than one grant.
   *
   * Should always be zero. Non-zero means the unique index was bypassed, which
   * is worth knowing about immediately rather than discovering in an invoice.
   */
  duplicated: number;
}

/**
 * Count the one-time grants. Read-only — it grants nothing.
 *
 * Replaces `grantFreeMonthlyCredits()` on the daily worker. The job that used
 * to hand out money now checks that the invariant still holds, which is the
 * right thing for a scheduled task to do to a financial system.
 */
export async function auditFreeGrants(): Promise<FreeGrantAudit> {
  const grants = await prisma.creditTransaction.groupBy({
    by: ["userId"],
    where: { reason: "SIGNUP_GRANT" },
    _count: { _all: true },
  });

  const freeUsers = await prisma.user.count({
    where: {
      OR: [{ subscription: null }, { subscription: { planTier: "STARTER" } }],
    },
  });

  return {
    granted: grants.length,
    missing: Math.max(0, freeUsers - grants.length),
    duplicated: grants.filter((row) => row._count._all > 1).length,
  };
}
