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
 * ## The DDL is no longer inline
 *
 * It used to be, because the migration had not been approved and committing it
 * to `prisma/migrations/` would have made the next `migrate deploy` apply it.
 * It is approved now and lives in
 * `20260901000000_connector_quote_and_idempotency`, so `applyMigrations` below
 * builds the tables the same way production will — which is a stronger
 * rehearsal than a copy of the script kept in step by hand.
 *
 * What stays here is the part a migration file cannot show: the constraints
 * actually firing under concurrency.
 */

const configured = managedTargetConfigured();

describe.skipIf(!configured)("connector idempotency, rehearsed", () => {
  let db: IsolatedSchema;

  beforeAll(async () => {
    db = await createIsolatedSchema(8);
    await applyMigrations(db);

    // The isolation guarantee, asserted rather than assumed.
    expect(db.schema.startsWith(SCHEMA_PREFIX)).toBe(true);

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

  describe("a quote is consumable exactly once", () => {
    /**
     * The token is not stored — only a hash of its `jti`.
     *
     * A signed token in the database is a credential at rest: anyone who reads
     * the table can replay a confirmation. The hash is enough to answer "has
     * this been used", which is the only question the table exists for.
     */
    const HASH = "a".repeat(64);

    beforeAll(async () => {
      await db.pool.query(
        `INSERT INTO connector_quote
           ("jtiHash","userId","requestHash","publicModelId","quotedCredits",
            "capabilityVersion","compilerVersion","expiresAt")
         VALUES ($1,'u_rehearse','req-1','motion-1',90,1,1, now() + interval '10 minutes')`,
        [HASH],
      );
    });

    /** Consume atomically: only an unconsumed row is claimed. */
    const consume = () =>
      db.pool
        .query(
          `UPDATE connector_quote SET "consumedAt" = now()
           WHERE "jtiHash" = $1 AND "consumedAt" IS NULL
           RETURNING "jtiHash"`,
          [HASH],
        )
        .then((r) => (r.rowCount === 1 ? "claimed" : "already-used"));

    it("lets exactly one of two concurrent confirmations claim it", async () => {
      /**
       * `UPDATE ... WHERE consumedAt IS NULL` rather than read-then-write: the
       * check and the write are one statement, so a second transaction cannot
       * interleave between them and claim the same quote.
       */
      const [first, second] = await Promise.all([consume(), consume()]);

      expect([first, second].sort()).toEqual(["already-used", "claimed"]);
    });

    it("refuses a second attempt after the first has settled", async () => {
      expect(await consume()).toBe("already-used");
    });

    it("stores no token, prompt or provider id", async () => {
      // Asserted over the whole row: whatever columns exist, none may hold a
      // credential, a customer's words, or who runs the model.
      const row = await db.pool.query(
        `SELECT * FROM connector_quote WHERE "jtiHash" = $1`,
        [HASH],
      );

      const serialised = JSON.stringify(row.rows[0]).toLowerCase();
      expect(serialised).not.toMatch(/replicate|bytedance|google\/|prediction/);
      expect(serialised).not.toContain("sports car");

      /**
       * The hash, never the token it came from.
       *
       * A signed token looks like `<base64url>.<signature>`. Asserted by shape
       * rather than by "contains no dot", which the first version did and which
       * fails on every ISO timestamp in the row.
       */
      expect(row.rows[0]!.jtiHash).toMatch(/^[0-9a-f]{64}$/);
      expect(serialised).not.toMatch(/[a-z0-9_-]{20,}\.[a-z0-9_-]{20,}/);
    });

    it("keeps one user's quotes away from another", async () => {
      const other = await db.pool.query(
        `SELECT count(*)::int n FROM connector_quote WHERE "userId" = 'u_other'`,
      );
      expect(other.rows[0]!.n).toBe(0);
    });
  });
});
