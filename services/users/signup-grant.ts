import "server-only";

import { createHash } from "node:crypto";

import mailchecker from "mailchecker";

import { emit } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { SIGNUP_GRANT } from "@/services/billing/catalogue";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * The free welcome grant, and the three things that stop it being a faucet.
 *
 * ## What the grant used to be
 *
 * 100 credits, written inside `provisionUser`'s transaction, keyed
 * `signup-grant:{clerkId}`. That is idempotent per *account* — a retried
 * webhook, a race between the webhook and the first sign-in, and a
 * double-clicked button all collide on the unique index.
 *
 * It was never idempotent per *person*, and `free-grant.ts` said so plainly:
 * "One grant per account is not one grant per person." At 300 credits the gap
 * is worth three times more, so it is closed here.
 *
 * ## Three gates, in order of how cheap they are to defeat
 *
 * 1. **Verified email only.** An unverified address costs nothing to invent.
 *    Clerk will not mark it verified without the click, so the grant waits for
 *    one. This is the cheapest gate to add and the one that removes the
 *    highest-volume attack.
 *
 * 2. **No disposable domains.** `mailchecker` is a maintained list — last
 *    published within the month, against `disposable-email-domains` which has
 *    not moved since 2022. It is not exhaustive and cannot be; it removes the
 *    named services, not the concept.
 *
 * 3. **One grant per address, ever.** `SignupGrant` has no foreign key to
 *    `User`, so deleting the account does not delete the record.
 *    `credit_transactions` cascades, which is exactly why the ledger cannot be
 *    the record.
 *
 * None of these establishes identity. A determined person with a domain and a
 * catch-all can still farm grants, and the honest control for that remains the
 * global spend breaker — see `free-grant.ts`.
 *
 * ## The address is hashed, never stored
 *
 * A table of "every email that has ever signed up", surviving account deletion
 * by design, is a liability nobody asked for. The hash answers the only
 * question the table exists to answer.
 */

/**
 * Fold an address to the mailbox it actually reaches.
 *
 * ## Why normalise at all
 *
 * `user+1@gmail.com` and `user+2@gmail.com` are the same inbox. Treating them
 * as different addresses makes the "one grant per address" rule defeatable by
 * typing a plus sign, which is not a rule.
 *
 * ## Why the two cases differ
 *
 * **Sub-addressing (`+tag`) is stripped everywhere.** Gmail, Outlook, Fastmail,
 * Proton and essentially every provider deliver `user+anything@d` to `user@d`.
 * A provider that treats them as distinct mailboxes would see a repeat grant
 * refused, which is the safe direction to be wrong in.
 *
 * **Dots are collapsed only for Gmail.** Google ignores them; almost nobody
 * else does. Collapsing them generally would merge `j.smith@company.com` and
 * `jsmith@company.com` — two different people at the same firm — and deny the
 * second a grant they are entitled to.
 */
export function normaliseEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;

  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);

  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replaceAll(".", "");
  }

  return `${local}@${domain}`;
}

/** SHA-256 of the normalised address. The address itself is never persisted. */
export function emailHash(email: string): string {
  return createHash("sha256").update(normaliseEmail(email)).digest("hex");
}

/**
 * Whether an address may ever receive a grant.
 *
 * Deliberately **not** a general "is this email valid" check — the account
 * already exists by the time this runs, and refusing to grant is the only
 * consequence. `mailchecker.isValid` returns false for both a malformed address
 * and a known disposable domain, which is the behaviour wanted here: neither
 * deserves free credits.
 */
export function isGrantableAddress(email: string): boolean {
  return mailchecker.isValid(email.trim());
}

export type GrantOutcome =
  | { granted: true; credits: number }
  | {
      granted: false;
      reason:
        | "email_unverified"
        | "disposable_email"
        | "already_granted"
        | "already_granted_this_account";
    };

/**
 * Grant the welcome credits, or explain why not.
 *
 * Safe to call on every authenticated request. It is cheap when the grant has
 * already happened (one indexed lookup) and correct when called concurrently:
 * the two unique constraints, not the read, are what make it exactly-once.
 */
export async function grantSignupCreditsIfEligible(input: {
  userId: string;
  clerkId: string;
  email: string;
  emailVerified: boolean;
}): Promise<GrantOutcome> {
  if (!input.emailVerified) {
    // Not logged as abuse. Almost everyone lands here once, between signing up
    // and clicking the link, and logging it would bury the real signals.
    return { granted: false, reason: "email_unverified" };
  }

  if (!isGrantableAddress(input.email)) {
    emit("grant.blocked_disposable", {
      userId: input.userId,
      // The domain, never the address. Enough to see a pattern in an abuse
      // view; not enough to reconstruct who signed up.
      domain: input.email.split("@").pop() ?? "unknown",
    });
    return { granted: false, reason: "disposable_email" };
  }

  const hash = emailHash(input.email);

  try {
    return await prisma.$transaction(async (tx) => {
      /**
       * The address record first, and outside the user's data.
       *
       * Written before the money moves: if this insert collides, the address
       * has been granted before and the transaction rolls back having changed
       * nothing. A read-then-write would race two concurrent sign-ins into two
       * grants.
       */
      await tx.signupGrant.create({
        data: { emailHash: hash, creditsGranted: SIGNUP_GRANT },
      });

      const user = await tx.user.update({
        where: { id: input.userId },
        data: { creditBalance: { increment: SIGNUP_GRANT } },
        select: { creditBalance: true },
      });

      await tx.creditTransaction.create({
        data: {
          userId: input.userId,
          amount: SIGNUP_GRANT,
          reason: "SIGNUP_GRANT",
          balanceAfter: user.creditBalance,
          // Kept per-account as well as per-address. The address record stops
          // re-registration; this one stops a double grant to one account, and
          // it is the row an operator reads when auditing a single user.
          idempotencyKey: `signup-grant:${input.clerkId}`,
        },
      });

      emit("grant.signup", {
        userId: input.userId,
        credits: SIGNUP_GRANT,
        balanceAfter: user.creditBalance,
      });

      return { granted: true, credits: SIGNUP_GRANT };
    });
  } catch (error) {
    const code = (error as { code?: string }).code;

    // P2002 is a unique violation. Which constraint tripped tells us which
    // rule refused, and both are expected rather than exceptional.
    if (code === "P2002") {
      const target = String(
        (error as Prisma.PrismaClientKnownRequestError).meta?.target ?? "",
      );

      if (target.includes("idempotencyKey")) {
        return { granted: false, reason: "already_granted_this_account" };
      }

      emit("grant.blocked_repeat_email", { userId: input.userId });
      return { granted: false, reason: "already_granted" };
    }

    throw error;
  }
}
