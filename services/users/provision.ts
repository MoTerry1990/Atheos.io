import "server-only";

import { prisma } from "@/lib/prisma";
import { grantSignupCreditsIfEligible } from "@/services/users/signup-grant";
// Prisma 7 names generated model types with a `Model` suffix.
import type { UserModel } from "@/lib/generated/prisma/models";

/**
 * Create the database row that mirrors a Clerk account, and grant its credits.
 *
 * ## Why this is not webhook-only
 *
 * It used to be. `lib/auth.ts` deliberately refused to create a row on demand,
 * on the reasoning that doing so "would race the webhook and risk two rows for
 * one person". That reasoning does not survive contact with the schema:
 *
 *   - `User.clerkId` is unique, so an upsert **cannot** produce two rows. The
 *     loser of the race takes the `update` branch.
 *   - The signup grant is keyed on `signup-grant:${clerkId}`, which is unique,
 *     so it **cannot** be applied twice no matter how many callers try.
 *
 * The constraints already made this safe. What the refusal actually bought was
 * a product that silently does nothing when the webhook is misconfigured — and
 * it *was* misconfigured, in production, for the whole of Sprint 25. Every
 * sign-up landed on a holding page with no row and no credits, and nothing in
 * the system said so.
 *
 * So the webhook is now an **optimisation**, not a dependency. It keeps the
 * mirror fresh on later profile edits and deletions, which nothing else can
 * observe. But a person who signs up while it is down still gets an account.
 *
 * ## The grant amount has exactly one source
 *
 * `SIGNUP_GRANT`, from the billing catalogue — the same constant the Free tier
 * on the pricing page is rendered from. The webhook previously carried its own
 * `SIGNUP_CREDIT_GRANT = 200` with a comment claiming it matched the pricing
 * page. It did not: the page advertised 100. Every sign-up was quietly given
 * double what was promised, which is the cheap direction to be wrong in and
 * still a number nobody could reconcile.
 */
export async function provisionUser(input: {
  clerkId: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  /**
   * Whether Clerk has confirmed the address.
   *
   * The account is created either way — somebody who has not clicked the link
   * still needs a row to sign in against. Only the **grant** waits.
   */
  emailVerified?: boolean;
}): Promise<UserModel> {
  /**
   * Creating the account is now the whole of this transaction.
   *
   * It used to also read the row first, to decide whether this was a first
   * creation and therefore whether to write the grant. The grant moved to
   * `grantSignupCreditsIfEligible`, which is exactly-once by unique constraint
   * rather than by a read — so the lookup went with it. A read-then-decide is
   * what a unique index is for.
   */
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { clerkId: input.clerkId },
      create: {
        clerkId: input.clerkId,
        email: input.email,
        name: input.name,
        imageUrl: input.imageUrl,
        /**
         * Zero, not `SIGNUP_GRANT`.
         *
         * The welcome credits are no longer part of creating an account. They
         * are granted by `grantSignupCreditsIfEligible` once the address is
         * verified, and only if it has never been granted before — see
         * `services/users/signup-grant.ts`. Seeding a balance here would hand
         * out the credits before either check ran.
         */
        creditBalance: 0,
      },
      // A profile edit in Clerk must not reset the balance, so `creditBalance`
      // is absent here. It is set once, on create, and moves only through the
      // ledger afterwards.
      update: {
        email: input.email,
        name: input.name,
        imageUrl: input.imageUrl,
      },
    });

    return user;
  });

  /**
   * The grant, outside the provisioning transaction and after it.
   *
   * Separate on purpose. It has its own transaction, its own idempotency and
   * two failure modes — unverified and already-granted — that are *normal*
   * rather than exceptional. Folding it back in here would mean a refused grant
   * rolled back the account creation, and somebody who has not yet clicked a
   * verification link could not sign in at all.
   */
  if (input.emailVerified) {
    await grantSignupCreditsIfEligible({
      userId: created.id,
      clerkId: input.clerkId,
      email: input.email,
      emailVerified: true,
    });

    // Re-read: the grant moved the balance, and the caller uses this row.
    return (
      (await prisma.user.findUnique({ where: { id: created.id } })) ?? created
    );
  }

  return created;
}
