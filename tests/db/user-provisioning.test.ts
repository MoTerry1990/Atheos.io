import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The constraints that make on-demand user provisioning safe.
 *
 * `services/users/provision.ts` is now called from two places — the Clerk
 * webhook and the sign-in path — and they can run concurrently for the same
 * person. Nothing in the application code coordinates them. The safety comes
 * entirely from two unique indexes:
 *
 *   - `users.clerkId`, so a concurrent upsert cannot make a second account.
 *   - `credit_transactions.idempotencyKey`, so a concurrent grant cannot pay
 *     out twice.
 *
 * That is a claim about the *schema*, so it is tested against real Postgres
 * rather than by reading the migration. If either index is ever dropped, this
 * fails loudly and the reason is written down here — a duplicate signup grant
 * is free credits for anyone who can sign in twice quickly.
 *
 * As with `worker-queue.test.ts`: Prisma cannot be pointed at PGlite, so this
 * verifies the constraints exist and behave, not that the application issues
 * exactly these statements.
 */

let db: PGlite;
const MIGRATIONS = resolve(import.meta.dirname, "../../prisma/migrations");

beforeAll(async () => {
  db = new PGlite();
  for (const name of readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()) {
    await db.exec(
      readFileSync(resolve(MIGRATIONS, name, "migration.sql"), "utf8"),
    );
  }
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`DELETE FROM credit_transactions; DELETE FROM users;`);
});

/** The upsert `provisionUser` issues, as Prisma would compile it. */
async function provision(clerkId: string, email: string, grant = 100) {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO users ("id","clerkId","email","creditBalance","updatedAt")
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT ("clerkId") DO UPDATE SET "email" = EXCLUDED."email"
     RETURNING "id"`,
    [`u-${clerkId}`, clerkId, email, grant],
  );
  return inserted.rows[0]!.id;
}

describe("user provisioning", () => {
  it("creates exactly one row when both callers race", async () => {
    // The webhook and the sign-in path, for the same person, interleaved.
    await Promise.all([
      provision("clerk_1", "a@example.com"),
      provision("clerk_1", "a@example.com"),
      provision("clerk_1", "a@example.com"),
    ]);

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE "clerkId" = 'clerk_1'`,
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("refuses a second signup grant for the same account", async () => {
    const userId = await provision("clerk_2", "b@example.com");

    const grant = () =>
      db.query(
        `INSERT INTO credit_transactions
           ("id","userId","amount","reason","balanceAfter","idempotencyKey","createdAt")
         VALUES (gen_random_uuid()::text, $1, 100, 'SIGNUP_GRANT', 100, $2, now())`,
        [userId, "signup-grant:clerk_2"],
      );

    await grant();
    // The second attempt must be rejected by the database, not by a prior read
    // — a `findUnique` check before the insert is not atomic under concurrency.
    await expect(grant()).rejects.toThrow(/unique|duplicate/i);

    const { rows } = await db.query<{ total: string }>(
      `SELECT coalesce(sum(amount),0)::text AS total FROM credit_transactions
       WHERE "userId" = $1 AND reason = 'SIGNUP_GRANT'`,
      [userId],
    );
    expect(rows[0]?.total).toBe("100");
  });

  it("keeps the balance when a profile edit re-upserts the row", async () => {
    const userId = await provision("clerk_3", "c@example.com");
    await db.query(`UPDATE users SET "creditBalance" = 40 WHERE id = $1`, [
      userId,
    ]);

    // A `user.updated` webhook arriving after the user has spent credits must
    // not reset them to the signup grant.
    await provision("clerk_3", "renamed@example.com");

    const { rows } = await db.query<{ balance: number; email: string }>(
      `SELECT "creditBalance" AS balance, email FROM users WHERE id = $1`,
      [userId],
    );
    expect(rows[0]?.balance).toBe(40);
    expect(rows[0]?.email).toBe("renamed@example.com");
  });
});
