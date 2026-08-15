import { Pool } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RESERVE_SQL } from "@/services/billing/ledger";

/**
 * The credit race, under **genuine** concurrency.
 *
 * ## Why this file is separate, and why it can skip
 *
 * `credit-ledger.test.ts` proves the conditional update's semantics against
 * real Postgres via PGlite. What it cannot prove is behaviour under two
 * connections at once, because PGlite has one.
 *
 * The audit's exploit is specifically simultaneous — twenty requests arriving
 * together, not twenty in sequence — so a claim of "concurrency safe" backed
 * only by sequential tests would be overstating what was checked. Sprint 4's
 * brief says exactly that: do not claim concurrency safety on the strength of
 * mocks.
 *
 * So this test needs a real server. It runs when `TEST_DATABASE_URL` points at
 * a **disposable** database and skips otherwise, printing which of the two
 * happened. A silent skip would be the worst outcome available: a green suite
 * that never ran the test the whole sprint was about.
 *
 * ## Running it
 *
 *     docker run --rm -e POSTGRES_PASSWORD=x -p 5433:5432 postgres:16
 *     TEST_DATABASE_URL=postgres://postgres:x@localhost:5433/postgres \
 *       npx vitest run tests/db/credit-ledger.concurrency.test.ts
 *
 * It DROPs and recreates the public schema on start, so it must never be
 * pointed at anything that matters. The guard below refuses a URL containing
 * `supabase`, which is the one mistake worth making impossible rather than
 * merely documenting.
 */

const url = process.env.TEST_DATABASE_URL;
const enabled = Boolean(url) && !/supabase|pooler/i.test(url ?? "");

if (url && !enabled) {
  throw new Error(
    "TEST_DATABASE_URL looks like a managed/production database. This test drops the public schema; point it at a disposable server.",
  );
}

/**
 * The status, as a test name rather than as a log line.
 *
 * A first version printed the mode with `console.log`. Vitest captures console
 * output during collection and does not surface it, so the notice never
 * appeared — the suite reported "3 skipped" with no indication of what had been
 * skipped or why, which is precisely the silent skip this was written to avoid.
 *
 * A test name is computed at collection time and always printed. So the run
 * itself says, in the reporter output, whether parallel reservation was
 * verified.
 */
describe("parallel reservation coverage", () => {
  it(
    enabled
      ? "VERIFIED — TEST_DATABASE_URL is set, the parallel tests below ran"
      : "NOT VERIFIED — TEST_DATABASE_URL is unset, so the parallel tests were skipped; only the sequential proof in credit-ledger.test.ts ran",
    () => {
      expect(typeof enabled).toBe("boolean");
    },
  );
});

const MIGRATIONS = resolve(import.meta.dirname, "../../prisma/migrations");

describe.skipIf(!enabled)("simultaneous reservations", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 24 });

    await pool.query(
      "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
    );

    for (const name of readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()) {
      await pool.query(
        readFileSync(resolve(MIGRATIONS, name, "migration.sql"), "utf8"),
      );
    }
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
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
