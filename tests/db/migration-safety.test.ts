import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Booting PGlite and replaying every migration takes well over Vitest's 5s
 * default, and each test here builds its own database rather than sharing one
 * from a `beforeAll`.
 *
 * The other `tests/db` files each pass `60_000` to their setup hook. This file
 * had no equivalent and passed anyway, because in isolation the build finished
 * inside 5s — it only started failing once the suite grew enough for these to
 * run against real CPU contention. A timeout that holds only on an idle machine
 * is a timeout that fails for reasons unrelated to the code under test.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * The Sprint 4.1 migration, applied to a real PostgreSQL server.
 *
 * ## What database this is
 *
 * **PGlite** — PostgreSQL itself, compiled to WebAssembly and run in process.
 * It is not SQLite and it is not a mock: enum types, `ALTER TYPE`, `USING`
 * conversions, CHECK constraints and unique indexes all behave exactly as they
 * will on Supabase. The one thing it cannot do is hold two connections open at
 * once, which matters for the concurrency tests in
 * `credit-ledger.concurrency.test.ts` and not at all here — a migration runs
 * alone by definition.
 *
 * Docker is not available in this environment, so a containerised Postgres was
 * not used. That is stated plainly rather than implied, and PGlite is not being
 * dressed up as something it is not: it is a genuine PostgreSQL engine, and it
 * is a single-connection one.
 *
 * ## What is being proved
 *
 * The migration rotates `PlanTier` — `STUDIO` becomes `CREATOR` in the same
 * statement block where `AGENCY` becomes `STUDIO`. A rotation is the one shape
 * of rename that cannot be done value-by-value, and getting it wrong does not
 * throw: it silently puts every subscriber on the wrong plan.
 *
 * So the fixture deliberately seeds **a row on every old tier**, including the
 * `BASIC` tier the product retired, even though production is expected to hold
 * zero subscriptions. A migration that is only correct on an empty table is a
 * migration nobody has actually tested.
 */

const MIGRATIONS = resolve(import.meta.dirname, "../../prisma/migrations");
const SPRINT_4 = "20260814000000_financial_safety_and_plan_tiers";

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function sqlFor(name: string): string {
  return readFileSync(resolve(MIGRATIONS, name, "migration.sql"), "utf8");
}

let db: PGlite | undefined;

afterEach(async () => {
  await db?.close();
  db = undefined;
});

/** Every migration up to but excluding Sprint 4's — the pre-migration state. */
async function upToSprint4(): Promise<PGlite> {
  const fresh = new PGlite();

  for (const name of migrationNames()) {
    if (name === SPRINT_4) break;
    await fresh.exec(sqlFor(name));
  }

  return fresh;
}

async function applySprint4(target: PGlite) {
  await target.exec(sqlFor(SPRINT_4));
}

/** One subscription per legacy tier, so the whole rotation is exercised. */
async function seedLegacySubscriptions(target: PGlite) {
  const tiers = ["STARTER", "BASIC", "STUDIO", "SCALE", "AGENCY"];

  for (const [index, tier] of tiers.entries()) {
    await target.query(
      `INSERT INTO users ("id","clerkId","email","creditBalance","updatedAt")
       VALUES ($1, $2, $3, $4, now())`,
      [`u${index}`, `c${index}`, `u${index}@example.com`, 100 + index],
    );

    await target.query(
      `INSERT INTO subscriptions
         ("id","userId","stripeCustomerId","planTier","scheduledTier","status","updatedAt")
       VALUES ($1, $2, $3, $4::"PlanTier", $5::"PlanTier", 'ACTIVE', now())`,
      [
        `s${index}`,
        `u${index}`,
        `cus_${index}`,
        tier,
        // Half the rows also carry a pending downgrade, so the nullable second
        // enum column is converted under both a value and a NULL.
        index % 2 === 0 ? "STARTER" : null,
      ],
    );

    await target.query(
      `INSERT INTO credit_transactions
         ("id","userId","amount","reason","balanceAfter","idempotencyKey","createdAt")
       VALUES ($1, $2, 100, 'SIGNUP_GRANT', 100, $3, now())`,
      [`t${index}`, `u${index}`, `signup-grant:c${index}`],
    );
  }
}

async function tiers(target: PGlite) {
  const { rows } = await target.query<{
    id: string;
    planTier: string;
    scheduledTier: string | null;
  }>(
    `SELECT id, "planTier"::text, "scheduledTier"::text FROM subscriptions ORDER BY id`,
  );
  return rows;
}

describe("PlanTier rotation", () => {
  it("maps every legacy value to its canonical plan", async () => {
    db = await upToSprint4();
    await seedLegacySubscriptions(db);
    await applySprint4(db);

    expect(await tiers(db)).toEqual([
      { id: "s0", planTier: "FREE", scheduledTier: "FREE" },
      // BASIC was the retired $5 tier. It maps to FREE rather than erroring:
      // a row that should not exist must not block the migration, and must
      // not be silently deleted either.
      { id: "s1", planTier: "FREE", scheduledTier: null },
      { id: "s2", planTier: "CREATOR", scheduledTier: "FREE" },
      { id: "s3", planTier: "PRO", scheduledTier: null },
      { id: "s4", planTier: "STUDIO", scheduledTier: "FREE" },
    ]);
  });

  it("leaves the enum holding exactly the four canonical values", async () => {
    db = await upToSprint4();
    await applySprint4(db);

    const { rows } = await db.query<{ label: string }>(
      `SELECT e.enumlabel AS label
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'PlanTier'
        ORDER BY e.enumsortorder`,
    );

    // In sort order, not alphabetical: the rebuild is what keeps this ordered
    // by price. A rename-through-a-temporary-name would have scrambled it.
    expect(rows.map((row) => row.label)).toEqual([
      "FREE",
      "CREATOR",
      "PRO",
      "STUDIO",
    ]);
  });

  it("restores the column default as FREE", async () => {
    // Dropped before the conversion, because Postgres will not convert a
    // column whose default is still typed as the old enum. Forgetting to put
    // it back leaves new subscriptions with a NULL tier.
    db = await upToSprint4();
    await applySprint4(db);

    const { rows } = await db.query<{ def: string | null }>(
      `SELECT column_default AS def
         FROM information_schema.columns
        WHERE table_name = 'subscriptions' AND column_name = 'planTier'`,
    );

    expect(rows[0]?.def).toMatch(/FREE/);

    // And it is actually usable: an insert with no tier lands on Free.
    await db.query(
      `INSERT INTO users ("id","clerkId","email","updatedAt")
       VALUES ('ud','cd','d@example.com', now())`,
    );
    await db.query(
      `INSERT INTO subscriptions ("id","userId","stripeCustomerId","status","updatedAt")
       VALUES ('sd','ud','cus_d','ACTIVE', now())`,
    );

    const { rows: inserted } = await db.query<{ planTier: string }>(
      `SELECT "planTier"::text FROM subscriptions WHERE id = 'sd'`,
    );
    expect(inserted[0]?.planTier).toBe("FREE");
  });

  it("keeps the column NOT NULL and the scheduled one nullable", async () => {
    db = await upToSprint4();
    await applySprint4(db);

    const { rows } = await db.query<{
      column_name: string;
      is_nullable: string;
    }>(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'subscriptions'
          AND column_name IN ('planTier','scheduledTier')
        ORDER BY column_name`,
    );

    expect(rows).toEqual([
      { column_name: "planTier", is_nullable: "NO" },
      { column_name: "scheduledTier", is_nullable: "YES" },
    ]);
  });
});

describe("rerunning the whole migration", () => {
  it("is a no-op the second time", async () => {
    /**
     * The property that makes an interrupted apply recoverable.
     *
     * Every statement is guarded — `IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`,
     * `ON CONFLICT DO NOTHING`, and a `DO` block that returns early once
     * `CREATOR` exists. Without that early return the second run would try to
     * `CREATE TYPE "PlanTier_new"` again and fail halfway through, leaving the
     * type rebuilt but the default missing.
     */
    db = await upToSprint4();
    await seedLegacySubscriptions(db);

    await applySprint4(db);
    const first = await tiers(db);

    await applySprint4(db);
    const second = await tiers(db);

    expect(second).toEqual(first);
  });

  it("preserves every credit balance across both runs", async () => {
    db = await upToSprint4();
    await seedLegacySubscriptions(db);

    const before = await db.query<{ id: string; creditBalance: number }>(
      `SELECT id, "creditBalance" FROM users ORDER BY id`,
    );

    await applySprint4(db);
    await applySprint4(db);

    const after = await db.query<{ id: string; creditBalance: number }>(
      `SELECT id, "creditBalance" FROM users ORDER BY id`,
    );

    expect(after.rows).toEqual(before.rows);
    // 100..104 as seeded — nothing rescaled, nothing clamped.
    expect(after.rows.map((row) => row.creditBalance)).toEqual([
      100, 101, 102, 103, 104,
    ]);
  });

  it("cannot duplicate a one-time signup grant", async () => {
    // The migration does not grant credits. What this checks is that the
    // constraint which makes the Free grant one-time survives it — a rebuilt
    // enum and a rewritten table must not drop the unique index.
    db = await upToSprint4();
    await seedLegacySubscriptions(db);
    await applySprint4(db);

    await expect(
      db.query(
        `INSERT INTO credit_transactions
           ("id","userId","amount","reason","balanceAfter","idempotencyKey","createdAt")
         VALUES ('dupe','u0',100,'SIGNUP_GRANT',200,'signup-grant:c0', now())`,
      ),
    ).rejects.toThrow(/idempotencyKey|unique/i);

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM credit_transactions
        WHERE reason = 'SIGNUP_GRANT' AND "userId" = 'u0'`,
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("adds the non-negative constraint after writing off any overspend", async () => {
    db = await upToSprint4();

    // A balance the pre-Sprint-4 race could have produced. Expected count in
    // production: zero. Tested anyway, because the clamp is the one part of
    // this migration that changes data.
    await db.query(
      `INSERT INTO users ("id","clerkId","email","creditBalance","updatedAt")
       VALUES ('neg','cneg','neg@example.com', -80, now())`,
    );

    await applySprint4(db);

    const { rows } = await db.query<{ creditBalance: number }>(
      `SELECT "creditBalance" FROM users WHERE id = 'neg'`,
    );
    expect(rows[0]?.creditBalance).toBe(0);

    // Written off, not reversed — and recorded, so the balance still equals
    // the sum of the ledger.
    const { rows: ledger } = await db.query<{
      amount: number;
      reason: string;
    }>(
      `SELECT amount, reason::text FROM credit_transactions WHERE "userId" = 'neg'`,
    );
    expect(ledger).toEqual([{ amount: 80, reason: "MANUAL_ADJUSTMENT" }]);

    await expect(
      db.query(`UPDATE users SET "creditBalance" = -1 WHERE id = 'neg'`),
    ).rejects.toThrow(/users_credit_balance_non_negative/);
  });

  it("creates the spending and rate-limit tables exactly once", async () => {
    db = await upToSprint4();
    await applySprint4(db);
    await applySprint4(db);

    const { rows } = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE tablename IN ('budget_usage','rate_limit_buckets')
        ORDER BY tablename`,
    );

    expect(rows.map((row) => row.tablename)).toEqual([
      "budget_usage",
      "rate_limit_buckets",
    ]);
  });
});
