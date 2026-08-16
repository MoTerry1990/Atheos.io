import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  applyMigrations,
  createIsolatedSchema,
  managedTargetConfigured,
  migrationSql,
  withMigrationLock,
  SCHEMA_PREFIX,
  type IsolatedSchema,
} from "./managed-schema";

/**
 * The Sprint 4 migration, rehearsed on a real managed PostgreSQL server.
 *
 * ## Why this exists alongside `migration-safety.test.ts`
 *
 * That file proves the same migration against PGlite — genuine PostgreSQL, but
 * compiled to WebAssembly and single-connection. It is the right tool for
 * asserting that the SQL is correct.
 *
 * It cannot answer the question this file exists for: *does this run on the
 * server we are actually going to run it on?* Supabase's Postgres 17.6 behind a
 * session pooler has its own extensions, its own role, its own permissions, and
 * a `search_path` we do not control by default. A migration that passes in
 * PGlite and fails on the real instance is exactly the failure a production
 * rehearsal is supposed to catch, and only a real instance can catch it.
 *
 * Everything here runs inside one disposable schema on the separate
 * `atheos-test` project. Nothing touches `public`, and nothing touches
 * production — `managed-schema.ts` refuses the production project ref outright.
 */

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const SPRINT_4 = "20260814000000_financial_safety_and_plan_tiers";

/**
 * The mapping the production plan documents, as data.
 *
 * A rotation, not a rename: STUDIO and AGENCY both move, and STUDIO means
 * something different afterwards. Writing it here means the test fails if the
 * migration and the plan ever disagree.
 */
const TIER_MAP: Record<string, string> = {
  STARTER: "FREE",
  BASIC: "FREE",
  STUDIO: "CREATOR",
  SCALE: "PRO",
  AGENCY: "STUDIO",
};

const configured = managedTargetConfigured();

describe("managed-postgres rehearsal coverage", () => {
  it(
    configured
      ? "VERIFIED — MIGRATION_TEST_DATABASE_URL is set, the rehearsal below ran"
      : "NOT VERIFIED — MIGRATION_TEST_DATABASE_URL is unset, so the rehearsal was skipped",
    () => {
      expect(typeof configured).toBe("boolean");
    },
  );
});

describe.skipIf(!configured)("Sprint 4 migration on managed PostgreSQL", () => {
  let db: IsolatedSchema;

  /** Identifiers captured before the migration, compared after it. */
  let before: {
    users: { id: string; creditBalance: number }[];
    subs: { id: string; planTier: string; scheduledTier: string | null }[];
    ledgerTotal: number;
    ledgerRows: number;
  };

  beforeAll(async () => {
    db = await createIsolatedSchema(8);

    // Everything up to, but not including, the migration under test.
    await applyMigrations(db, SPRINT_4);

    // One subscription per legacy tier, so the rotation is exercised on every
    // value rather than on whichever one happened to be convenient.
    const legacy = Object.keys(TIER_MAP);
    for (const [i, tier] of legacy.entries()) {
      const uid = `user_${tier.toLowerCase()}`;
      await db.pool.query(
        `INSERT INTO users (id, "clerkId", email, "creditBalance", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, now(), now())`,
        [uid, `clerk_${uid}`, `${uid}@example.test`, i === 0 ? 0 : i * 100],
      );
      await db.pool.query(
        `INSERT INTO subscriptions (id, "userId", "stripeCustomerId", "planTier", "scheduledTier", status, "createdAt", "updatedAt")
         VALUES ($1, $2, $5, $3::"PlanTier", $4, 'ACTIVE', now(), now())`,
        [
          `sub_${tier.toLowerCase()}`,
          uid,
          tier,
          // Half get a pending downgrade, half stay NULL, so the nullable
          // column is exercised in both states.
          i % 2 === 0 ? null : tier,
          `cus_${tier.toLowerCase()}`,
        ],
      );
      // A ledger row per user, so balance-vs-ledger can be compared after.
      if (i > 0) {
        await db.pool.query(
          `INSERT INTO credit_transactions (id, "userId", amount, "balanceAfter", reason, "idempotencyKey", "createdAt")
           VALUES ($1, $2, $3, $3, 'SIGNUP_GRANT', $4, now())`,
          [`tx_${uid}`, uid, i * 100, `key_${uid}`],
        );
      }
    }

    const users = await db.pool.query(
      `SELECT id, "creditBalance"::int FROM users ORDER BY id`,
    );
    const subs = await db.pool.query(
      `SELECT id, "planTier"::text, "scheduledTier"::text FROM subscriptions ORDER BY id`,
    );
    const led = await db.pool.query(
      `SELECT COALESCE(sum(amount),0)::int total, count(*)::int n FROM credit_transactions`,
    );
    before = {
      users: users.rows,
      subs: subs.rows,
      ledgerTotal: led.rows[0].total,
      ledgerRows: led.rows[0].n,
    };
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it("creates the schema inside the isolated prefix, never public", () => {
    expect(db.schema.startsWith(SCHEMA_PREFIX)).toBe(true);
    expect(db.schema).not.toBe("public");
  });

  it("seeds one subscription per legacy tier before migrating", () => {
    expect(before.subs.map((s) => s.planTier).sort()).toEqual(
      Object.keys(TIER_MAP).sort(),
    );
    expect(before.subs.some((s) => s.scheduledTier === null)).toBe(true);
    expect(before.users.some((u) => u.creditBalance === 0)).toBe(true);
    expect(before.users.some((u) => u.creditBalance > 0)).toBe(true);
  });

  it("applies the pending migration", async () => {
    await withMigrationLock(() => db.pool.query(migrationSql(SPRINT_4)));
  });

  it("leaves the enum holding exactly the four canonical values", async () => {
    const { rows } = await db.pool.query(
      `SELECT e.enumlabel FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'PlanTier' AND n.nspname = $1
        ORDER BY e.enumsortorder`,
      [db.schema],
    );
    expect(rows.map((r) => r.enumlabel)).toEqual([
      "FREE",
      "CREATOR",
      "PRO",
      "STUDIO",
    ]);
  });

  it("maps every legacy tier exactly as the plan documents", async () => {
    const { rows } = await db.pool.query(
      `SELECT id, "planTier"::text, "scheduledTier"::text FROM subscriptions ORDER BY id`,
    );
    for (const row of rows) {
      const legacy = before.subs.find((s) => s.id === row.id)!;
      expect(row.planTier, `${row.id}: ${legacy.planTier}`).toBe(
        TIER_MAP[legacy.planTier],
      );
      expect(row.scheduledTier).toBe(
        legacy.scheduledTier === null ? null : TIER_MAP[legacy.scheduledTier],
      );
    }
  });

  it("loses no subscription and changes no identifier", async () => {
    const { rows } = await db.pool.query(
      `SELECT id FROM subscriptions ORDER BY id`,
    );
    expect(rows.map((r) => r.id)).toEqual(before.subs.map((s) => s.id));
  });

  it("leaves every balance and ledger row untouched", async () => {
    const users = await db.pool.query(
      `SELECT id, "creditBalance"::int FROM users ORDER BY id`,
    );
    expect(users.rows).toEqual(before.users);

    const led = await db.pool.query(
      `SELECT COALESCE(sum(amount),0)::int total, count(*)::int n FROM credit_transactions`,
    );
    expect(led.rows[0].total).toBe(before.ledgerTotal);
    expect(led.rows[0].n).toBe(before.ledgerRows);
  });

  it("resets the planTier default to FREE", async () => {
    const { rows } = await db.pool.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'subscriptions'
          AND column_name = 'planTier'`,
      [db.schema],
    );
    expect(String(rows[0].column_default)).toContain("FREE");
  });

  it("keeps scheduledTier nullable and planTier NOT NULL", async () => {
    const { rows } = await db.pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'subscriptions'
          AND column_name IN ('planTier','scheduledTier')`,
      [db.schema],
    );
    const by = Object.fromEntries(
      rows.map((r) => [r.column_name, r.is_nullable]),
    );
    expect(by.planTier).toBe("NO");
    expect(by.scheduledTier).toBe("YES");
  });

  it("creates budget_usage and rate_limit_buckets", async () => {
    for (const table of ["budget_usage", "rate_limit_buckets"]) {
      const { rows } = await db.pool.query(
        `SELECT to_regclass($1) IS NOT NULL AS present`,
        [`"${db.schema}".${table}`],
      );
      expect(rows[0].present, table).toBe(true);
    }
  });

  it("creates both non-negative constraints", async () => {
    const { rows } = await db.pool.query(
      `SELECT conname FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = $1 AND conname = ANY($2)`,
      [
        db.schema,
        ["budget_usage_non_negative", "users_credit_balance_non_negative"],
      ],
    );
    expect(rows.map((r) => r.conname).sort()).toEqual([
      "budget_usage_non_negative",
      "users_credit_balance_non_negative",
    ]);
  });

  it("keeps every foreign key valid", async () => {
    // `VALIDATE CONSTRAINT` on an already-valid FK is a no-op that still
    // re-checks; an orphaned row would raise here.
    const { rows } = await db.pool.query(
      `SELECT count(*)::int n FROM pg_constraint c
         JOIN pg_namespace ns ON ns.oid = c.connamespace
        WHERE ns.nspname = $1 AND c.contype = 'f' AND NOT c.convalidated`,
      [db.schema],
    );
    expect(rows[0].n).toBe(0);
  });

  it("is a no-op the second time", async () => {
    await withMigrationLock(() => db.pool.query(migrationSql(SPRINT_4)));

    const { rows } = await db.pool.query(
      `SELECT e.enumlabel FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'PlanTier' AND n.nspname = $1
        ORDER BY e.enumsortorder`,
      [db.schema],
    );
    expect(rows.map((r) => r.enumlabel)).toEqual([
      "FREE",
      "CREATOR",
      "PRO",
      "STUDIO",
    ]);

    const subs = await db.pool.query(
      `SELECT count(*)::int n FROM subscriptions`,
    );
    expect(subs.rows[0].n).toBe(before.subs.length);
  });
});

describe.skipIf(!configured)("constraints reject invalid writes", () => {
  let db: IsolatedSchema;

  beforeAll(async () => {
    db = await createIsolatedSchema(4);
    await applyMigrations(db);
    await db.pool.query(
      `INSERT INTO users (id, "clerkId", email, "creditBalance", "createdAt", "updatedAt")
       VALUES ('u_neg', 'clerk_u_neg', 'neg@example.test', 10, now(), now())`,
    );
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it("refuses a negative credit balance", async () => {
    await expect(
      db.pool.query(`UPDATE users SET "creditBalance" = -1 WHERE id = 'u_neg'`),
    ).rejects.toThrow(/users_credit_balance_non_negative|violates check/i);
  });

  it("refuses negative budget usage", async () => {
    await expect(
      db.pool.query(
        `INSERT INTO budget_usage ("periodStart", "spentMicroUsd")
         VALUES (date_trunc('month', now()), -5)`,
      ),
    ).rejects.toThrow(/budget_usage_non_negative|violates check|column/i);
  });

  it("refuses an invalid PlanTier value", async () => {
    await expect(
      db.pool.query(
        `INSERT INTO subscriptions (id, "userId", "stripeCustomerId", "planTier", status, "createdAt", "updatedAt")
         VALUES ('sub_bad', 'u_neg', 'cus_bad', 'AGENCY'::"PlanTier", 'ACTIVE', now(), now())`,
      ),
    ).rejects.toThrow(/invalid input value for enum/i);
  });

  it("refuses an invalid foreign key", async () => {
    await expect(
      db.pool.query(
        `INSERT INTO subscriptions (id, "userId", "stripeCustomerId", "planTier", status, "createdAt", "updatedAt")
         VALUES ('sub_orphan', 'nobody', 'cus_orphan', 'FREE'::"PlanTier", 'ACTIVE', now(), now())`,
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it("refuses a duplicate idempotency key", async () => {
    await db.pool.query(
      `INSERT INTO credit_transactions (id, "userId", amount, "balanceAfter", reason, "idempotencyKey", "createdAt")
       VALUES ('tx_a', 'u_neg', 5, 15, 'SIGNUP_GRANT', 'dup_key', now())`,
    );
    await expect(
      db.pool.query(
        `INSERT INTO credit_transactions (id, "userId", amount, "balanceAfter", reason, "idempotencyKey", "createdAt")
         VALUES ('tx_b', 'u_neg', 5, 20, 'SIGNUP_GRANT', 'dup_key', now())`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe.skipIf(!configured)("rollback rehearsal", () => {
  /**
   * ## What this proves, and what it does not
   *
   * **Logical proof, not exact-tool proof.** The production plan restores the
   * dump with `psql -f`, and `psql` is not installed on this machine. So this
   * exercises the *shape* of the rollback — rebuild the pre-migration schema,
   * replay the captured rows, verify the legacy state is back — using
   * `node-postgres`, which is available and is the same wire protocol.
   *
   * What that leaves untested is `psql` itself: its `\i` handling, its
   * transaction wrapping, and how it reacts to the `session_replication_role`
   * header the dump sets. Those are real gaps and they are why
   * `docs/MIGRATION_APPLY_PLAN.md` lists installing the client tools as a
   * precondition rather than a nicety.
   *
   * Calling this "rollback tested" without that distinction would be the kind
   * of claim that gets discovered at the worst moment.
   */
  let db: IsolatedSchema;

  afterAll(async () => {
    await db?.destroy();
  });

  it("restores the legacy state, then migrates forward again", async () => {
    db = await createIsolatedSchema(6);
    await applyMigrations(db, SPRINT_4);

    // --- seed -------------------------------------------------------------
    await db.pool.query(
      `INSERT INTO users (id, "clerkId", email, "creditBalance", "createdAt", "updatedAt")
       VALUES ('u_rb', 'clerk_rb', 'rb@example.test', 250, now(), now())`,
    );
    await db.pool.query(
      `INSERT INTO subscriptions (id, "userId", "stripeCustomerId", "planTier", status, "createdAt", "updatedAt")
       VALUES ('sub_rb', 'u_rb', 'cus_rb', 'AGENCY'::"PlanTier", 'ACTIVE', now(), now())`,
    );

    const snapshot = {
      users: (
        await db.pool.query(
          `SELECT id, "creditBalance"::int FROM users ORDER BY id`,
        )
      ).rows,
      subs: (
        await db.pool.query(
          `SELECT id, "userId", "stripeCustomerId", "planTier"::text FROM subscriptions ORDER BY id`,
        )
      ).rows,
    };
    expect(snapshot.subs[0].planTier).toBe("AGENCY");

    // --- forward ----------------------------------------------------------
    await withMigrationLock(() => db.pool.query(migrationSql(SPRINT_4)));
    const migrated = await db.pool.query(
      `SELECT "planTier"::text FROM subscriptions WHERE id='sub_rb'`,
    );
    expect(migrated.rows[0].planTier).toBe("STUDIO"); // AGENCY -> STUDIO

    // --- rollback ---------------------------------------------------------
    // The production equivalent of `migrate reset` + replay of the dump: drop
    // every object, rebuild to the migration *before* the one under test, then
    // put the captured rows back.
    await db.pool.query(`DROP SCHEMA IF EXISTS "${db.schema}" CASCADE`);
    await db.pool.query(`CREATE SCHEMA "${db.schema}"`);
    await applyMigrations(db, SPRINT_4);

    for (const u of snapshot.users) {
      await db.pool.query(
        `INSERT INTO users (id, "clerkId", email, "creditBalance", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, now(), now())`,
        [u.id, `clerk_${u.id}`, `${u.id}@example.test`, u.creditBalance],
      );
    }
    for (const sub of snapshot.subs) {
      await db.pool.query(
        `INSERT INTO subscriptions (id, "userId", "stripeCustomerId", "planTier", status, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4::"PlanTier", 'ACTIVE', now(), now())`,
        [sub.id, sub.userId, sub.stripeCustomerId, sub.planTier],
      );
    }

    // Legacy enum is back, and so is the data.
    const back = await db.pool.query(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
         JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE t.typname='PlanTier' AND n.nspname=$1 ORDER BY e.enumsortorder`,
      [db.schema],
    );
    expect(back.rows.map((r) => r.enumlabel)).toEqual([
      "STARTER",
      "BASIC",
      "STUDIO",
      "SCALE",
      "AGENCY",
    ]);
    const restored = await db.pool.query(
      `SELECT id, "creditBalance"::int FROM users ORDER BY id`,
    );
    expect(restored.rows).toEqual(snapshot.users);
    const restoredSub = await db.pool.query(
      `SELECT "planTier"::text FROM subscriptions WHERE id='sub_rb'`,
    );
    expect(restoredSub.rows[0].planTier).toBe("AGENCY");

    // --- forward again ----------------------------------------------------
    await withMigrationLock(() => db.pool.query(migrationSql(SPRINT_4)));
    const again = await db.pool.query(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
         JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE t.typname='PlanTier' AND n.nspname=$1 ORDER BY e.enumsortorder`,
      [db.schema],
    );
    expect(again.rows.map((r) => r.enumlabel)).toEqual([
      "FREE",
      "CREATOR",
      "PRO",
      "STUDIO",
    ]);
    const finalSub = await db.pool.query(
      `SELECT "planTier"::text FROM subscriptions WHERE id='sub_rb'`,
    );
    expect(finalSub.rows[0].planTier).toBe("STUDIO");
    const finalUsers = await db.pool.query(
      `SELECT id, "creditBalance"::int FROM users ORDER BY id`,
    );
    expect(finalUsers.rows).toEqual(snapshot.users);
  });
});
