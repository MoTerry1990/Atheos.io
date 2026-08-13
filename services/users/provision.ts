import "server-only";

import { prisma } from "@/lib/prisma";
import { SIGNUP_GRANT } from "@/services/billing/catalogue";
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
}): Promise<UserModel> {
  // The ledger entry and the cached balance must commit together, or the
  // balance is a number nobody can explain. See docs/DECISIONS.md.
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { clerkId: input.clerkId },
      select: { id: true },
    });

    const user = await tx.user.upsert({
      where: { clerkId: input.clerkId },
      create: {
        clerkId: input.clerkId,
        email: input.email,
        name: input.name,
        imageUrl: input.imageUrl,
        creditBalance: SIGNUP_GRANT,
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

    // Only on first creation. An existing row whose grant row is missing is a
    // repair job for an operator, not something to silently top up — a
    // self-healing grant is a self-healing way to give away credits.
    if (!existing) {
      await tx.creditTransaction.create({
        data: {
          userId: user.id,
          amount: SIGNUP_GRANT,
          reason: "SIGNUP_GRANT",
          balanceAfter: user.creditBalance,
          idempotencyKey: `signup-grant:${input.clerkId}`,
        },
      });
    }

    return user;
  });
}
