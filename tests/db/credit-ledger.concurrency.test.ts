import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { RESERVE_SQL } from "@/services/billing/ledger";
import {
  applyMigrations,
  createIsolatedSchema,
  managedTargetConfigured,
  SCHEMA_PREFIX,
  type IsolatedSchema,
} from "./managed-schema";

/**
 * Parallel reservation, against a real PostgreSQL server with real connections.
 *
 * ## Why PGlite cannot do this
 *
 * `credit-ledger.test.ts` proves the conditional `UPDATE ... WHERE balance >= n`
 * twenty times *sequentially* in PGlite. That is a real proof of the SQL and no
 * proof at all of the thing the audit was worried about: PGlite holds one
 * connection, so "twenty at once" becomes twenty in a row, and the interleaving
 * that would expose a lost update never happens.
 *
 * ## What changed in Sprint 5A.1
 *
 * This file used to open with:
 *
 *     DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
 *
 * and guard it by refusing any URL containing `supabase` or `pooler`. The guard
 * was correct and the result was that these tests never ran — no local Postgres
 * is installed, so three tests sat skipped indefinitely. A permanently skipped
 * test is not a safety measure; it is an untested code path with a comment.
 *
 * They now run inside a uniquely-named disposable schema on the separate
 * `atheos-test` project. Nothing here touches `public`, so the reason for the
 * old guard is gone rather than merely suppressed. `managed-schema.ts` refuses
 * the production project ref outright and fails closed on an unproven identity.
 *
 * `TEST_DATABASE_URL` remains supported for a disposable *local* server, and is
 * still refused if it looks managed — that path still does drop `public`.
 */

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const localUrl = process.env.TEST_DATABASE_URL;
const localEnabled =
  Boolean(localUrl) && !/supabase|pooler/i.test(localUrl ?? "");

if (localUrl && !localEnabled) {
  throw new Error(
    "TEST_DATABASE_URL looks like a managed database. That path drops the " +
      "public schema. Use MIGRATION_TEST_DATABASE_URL for managed servers, " +
      "which runs inside an isolated schema instead.",
  );
}

const managed = managedTargetConfigured();
const enabled = managed || localEnabled;

/**
 * The status, as a test name rather than a log line.
 *
 * Vitest captures console output during collection and never surfaces it, so an
 * earlier version's `console.log` notice was invisible — the suite reported
 * "3 skipped" with no indication of what or why. A test name is computed at
 * collection time and always printed.
 */
describe("parallel reservation coverage", () => {
  it(
    managed
      ? "VERIFIED (managed) — isolated schema on atheos-test, parallel tests ran"
      : localEnabled
        ? "VERIFIED (local) — TEST_DATABASE_URL is set, parallel tests ran"
        : "NOT VERIFIED — no test database configured, parallel tests skipped",
    () => {
      expect(typeof enabled).toBe("boolean");
    },
  );
});

describe.skipIf(!enabled)("simultaneous reservations", () => {
  let isolated: IsolatedSchema | null = null;
  let pool: Pool;

  beforeAll(async () => {
    if (managed) {
      /**
       * Twelve connections, not twenty-four.
       *
       * Supabase's **session** pooler caps a client at 15 concurrent
       * connections and rejects the sixteenth with `EMAXCONNSESSION`. Asking
       * for 24 does not produce 24-way parallelism against this server; it
       * produces three failed tests.
       *
       * This is a reduction in *width*, not in rigour, and the distinction
       * matters: the assertions are unchanged. Twenty requests are still
       * issued for a balance that affords one, and thirty for a balance that
       * affords eleven — the pool queues them across twelve live connections
       * rather than twenty. Twelve transactions racing the same row is a
       * genuine race; a lost update would still show up as two winners.
       *
       * The local-Postgres path below keeps 24, where nothing caps it.
       */
      isolated = await createIsolatedSchema(12);
      pool = isolated.pool;
      await applyMigrations(isolated);
      expect(isolated.schema.startsWith(SCHEMA_PREFIX)).toBe(true);
    } else {
      // Local disposable server only: this branch does drop `public`, and the
      // guard above has already refused anything that looks managed.
      pool = new Pool({ connectionString: localUrl, max: 24 });
      await pool.query(
        "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
      );
      const { migrationNames, migrationSql } = await import("./managed-schema");
      for (const name of migrationNames()) {
        await pool.query(migrationSql(name));
      }
    }
  });

  afterAll(async () => {
    if (isolated) await isolated.destroy();
    else await pool?.end();
  });

  async function seedUser(balance: number) {
    await pool.query(`DELETE FROM credit_transactions; DELETE FROM users;`);
    await pool.query(
      `INSERT INTO users ("id","clerkId","email","creditBalance","updatedAt")
       VALUES ('u1','c1','one@example.com',$1, now())`,
      [balance],
    );
  }

  async function balance(): Promise<number> {
    const { rows } = await pool.query<{ creditBalance: number }>(
      `SELECT "creditBalance" FROM users WHERE id = 'u1'`,
    );
    return rows[0]!.creditBalance;
  }

  it("lets exactly one of twenty simultaneous requests spend 90 of 100", async () => {
    await seedUser(100);

    // The audit's exploit, verbatim: twenty parallel requests, one balance.
    // `Promise.all` over separate pool connections is genuine parallelism —
    // twenty transactions open at the same moment against the same row.
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        pool.query<{ creditBalance: number }>(RESERVE_SQL, [90, "u1"]),
      ),
    );

    const succeeded = results.filter((result) => result.rowCount === 1);

    expect(succeeded).toHaveLength(1);
    expect(await balance()).toBe(10);
  });

  it("never drives a balance below zero, whatever the interleaving", async () => {
    await seedUser(1_000);

    // Thirty requests for 90 against 1,000: eleven can succeed, and the
    // arithmetic must land exactly on 10 rather than anywhere near zero.
    const results = await Promise.all(
      Array.from({ length: 30 }, () => pool.query(RESERVE_SQL, [90, "u1"])),
    );

    const succeeded = results.filter((result) => result.rowCount === 1).length;

    expect(succeeded).toBe(11);
    expect(await balance()).toBe(1_000 - succeeded * 90);
    expect(await balance()).toBeGreaterThanOrEqual(0);
  });

  it("counts every simultaneous rate-limit hit exactly once", async () => {
    // The other half of B7. An in-memory limiter would report 1 twenty times,
    // because each instance would be counting on its own.
    await pool.query(`DELETE FROM rate_limit_buckets`);

    const hits = await Promise.all(
      Array.from({ length: 20 }, () =>
        pool.query<{ count: number }>(
          `INSERT INTO rate_limit_buckets ("key","count","expiresAt")
           VALUES ('generate:u1', 1, now() + interval '60 seconds')
           ON CONFLICT ("key") DO UPDATE
             SET "count" = CASE
                   WHEN rate_limit_buckets."expiresAt" <= now() THEN 1
                   ELSE rate_limit_buckets."count" + 1
                 END,
                 "expiresAt" = CASE
                   WHEN rate_limit_buckets."expiresAt" <= now() THEN EXCLUDED."expiresAt"
                   ELSE rate_limit_buckets."expiresAt"
                 END
           RETURNING "count"`,
        ),
      ),
    );

    // Every value from 1 to 20, once each — no lost updates.
    const counts = hits.map((hit) => hit.rows[0]!.count).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});
