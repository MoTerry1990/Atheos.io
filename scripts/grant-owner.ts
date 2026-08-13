/**
 * Promote an account to owner and top up its balance.
 *
 * One-off, run by hand against production:
 *
 *   npx tsx scripts/grant-owner.ts mauro16071990@gmail.com
 *
 * ## Why this is a script and not a migration
 *
 * It touches one row in one install. A migration would re-run this on every
 * deployment of the codebase, including somebody else's, which is the wrong
 * shape for "make Mauro an admin".
 *
 * ## The tier is not written here
 *
 * Only `role` is. Entitlement for an owner is derived in `getEntitlement`, so
 * there is no Subscription row to forge and nothing for a later Stripe webhook
 * to collide with. Credits *are* written, because credits are a ledger and a
 * balance nobody granted is a balance nobody can account for.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const AGENCY_CREDITS = 20_000;

async function main() {
  const email = process.argv[2];
  if (!email) {
    throw new Error("usage: tsx scripts/grant-owner.ts <email>");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, role: true, creditBalance: true },
    });
    if (!user) throw new Error(`no user with email ${email}`);

    if (user.role !== "ADMIN") {
      await prisma.user.update({
        where: { id: user.id },
        data: { role: "ADMIN" },
      });
    }

    // Idempotent by construction: re-running tops up to the allowance rather
    // than adding another 20,000 every time somebody runs the script twice.
    const shortfall = AGENCY_CREDITS - user.creditBalance;
    let balance = user.creditBalance;

    if (shortfall > 0) {
      balance = await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: user.id },
          data: { creditBalance: { increment: shortfall } },
          select: { creditBalance: true },
        });

        await tx.creditTransaction.create({
          data: {
            userId: user.id,
            amount: shortfall,
            reason: "MANUAL_ADJUSTMENT",
            balanceAfter: updated.creditBalance,
            idempotencyKey: `owner-grant:${user.id}:${AGENCY_CREDITS}`,
            metadata: {
              note: "Owner account topped up to the Agency allowance",
            },
          },
        });

        return updated.creditBalance;
      });
    }

    console.log(
      JSON.stringify(
        { email: user.email, role: "ADMIN", tier: "AGENCY (derived)", balance },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
