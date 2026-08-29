import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyMigrations,
  createIsolatedSchema,
  managedTargetConfigured,
  SCHEMA_PREFIX,
  type IsolatedSchema,
} from "./managed-schema";

/**
 * A rehearsal of the connector idempotency migration, against real PostgreSQL.
 *
 * ## Why rehearse at all
 *
 * The table is what lets `confirm_generation` answer a retry with the original
 * generation instead of a refusal. Two of its four guarantees come from
 * database constraints rather than from application code, and a constraint you
 * have not watched fire is a constraint you are hoping for.
 *
 * So this applies the DDL to an isolated schema on the managed test database,
 * races two connections at it, and drops the schema again. Nothing here runs
 * against production: `createIsolatedSchema` refuses a target that is not the
 * managed test server, and asserting the schema prefix below is the second
 * check on that.
 *
 * ## Why the SQL is inline rather than a migration file
 *
 * Because the migration has not been approved. Committing it to
 * `prisma/migrations/` would make the next `migrate deploy` apply it to
 * production, which is a decision nobody has taken. The script here is the
 * exact output of `prisma migrate diff`, recorded in
 * `docs/MIGRATION-CONNECTOR-IDEMPOTENCY.md`, and it moves into a migration
 * file when the design is signed off.
 */

const DDL = `
CREATE TABLE "connector_idempotency" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "connector_idempotency_pkey" PRIMARY KEY ("userId","key")
);
CREATE INDEX "connector_idempotency_expiresAt_idx"
  ON "connector_idempotency"("expiresAt");
ALTER TABLE "connector_idempotency" ADD CONSTRAINT "connector_idempotency_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connector_idempotency" ADD CONSTRAINT "connector_idempotency_generationId_fkey"
  FOREIGN KEY ("generationId") REFERENCES "generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
`;

const configured = managedTargetConfigured();

describe.skipIf(!configured)("connector idempotency, rehearsed", () => {
  let db: IsolatedSchema;

  beforeAll(async () => {
    db = await createIsolatedSchema(8);
    await applyMigrations(db);

    // The isolation guarantee, asserted rather than assumed.
    expect(db.schema.startsWith(SCHEMA_PREFIX)).toBe(true);

    await db.pool.query(DDL);

    await db.pool.query(
      `INSERT INTO users (id, "clerkId", email, "creditBalance", "updatedAt")
       VALUES ('u_rehearse', 'clerk_rehearse', 'rehearse@example.test', 0, now())`,
    );
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it("creates the primary key, the index and both foreign keys", async () => {
    const constraints = await db.pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'connector_idempotency'::regclass
       ORDER BY conname`,
    );

    expect(constraints.rows.map((r) => r.conname)).toEqual([
      "connector_idempotency_generationId_fkey",
      "connector_idempotency_pkey",
      "connector_idempotency_userId_fkey",
    ]);

    const indexes = await db.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'connector_idempotency' ORDER BY indexname`,
    );

    expect(indexes.rows.map((r) => r.indexname)).toContain(
      "connector_idempotency_expiresAt_idx",
    );
  });

  const insert = (requestHash: string) =>
    db.pool
      .query(
        `INSERT INTO connector_idempotency ("key","userId","requestHash","expiresAt")
         VALUES ('race','u_rehearse',$1, now() + interval '1 hour')`,
        [requestHash],
      )
      .then(() => "accepted" as const)
      .catch((error: { code?: string }) => `refused:${error.code}` as const);

  it("lets exactly one of two concurrent confirmations through", async () => {
    /**
     * The guarantee that matters. Two agents retrying the same call at the
     * same instant must not produce two generations, and the composite primary
     * key is what enforces it — Postgres, not a check-then-write in
     * application code that a second process can interleave with.
     *
     * `23505` is unique_violation.
     */
    const [first, second] = await Promise.all([
      insert("same-request"),
      insert("same-request"),
    ]);

    const outcomes = [first, second].sort();
    expect(outcomes[0]).toBe("accepted");
    expect(outcomes[1]).toBe("refused:23505");

    const rows = await db.pool.query<{ n: string }>(
      `SELECT count(*) n FROM connector_idempotency WHERE "key" = 'race'`,
    );
    expect(Number(rows.rows[0]!.n)).toBe(1);
  });

  it("refuses the same key carrying a different request", async () => {
    /**
     * The case a column on `Generation` could not express. The row is already
     * there from the race above; a second attempt under the same key collides
     * whatever it carries, so the application layer can read the stored
     * `requestHash`, compare, and answer either with the original generation
     * or with `idempotency_conflict`.
     */
    expect(await insert("a-different-request")).toBe("refused:23505");
  });

  it("scopes keys per user, so two customers may both pick 'race'", async () => {
    await db.pool.query(
      `INSERT INTO users (id, "clerkId", email, "creditBalance", "updatedAt")
       VALUES ('u_other', 'clerk_other', 'other@example.test', 0, now())`,
    );

    const accepted = await db.pool
      .query(
        `INSERT INTO connector_idempotency ("key","userId","requestHash","expiresAt")
         VALUES ('race','u_other','theirs', now() + interval '1 hour')`,
      )
      .then(() => "accepted")
      .catch((error: { code?: string }) => `refused:${error.code}`);

    expect(accepted).toBe("accepted");
  });

  it("removes a user's records with the user", async () => {
    // `ON DELETE CASCADE`, verified rather than trusted: an orphan row keyed to
    // a deleted account is a retry record nobody can ever match.
    await db.pool.query(`DELETE FROM users WHERE id = 'u_other'`);

    const rows = await db.pool.query<{ n: string }>(
      `SELECT count(*) n FROM connector_idempotency WHERE "userId" = 'u_other'`,
    );
    expect(Number(rows.rows[0]!.n)).toBe(0);
  });
});
