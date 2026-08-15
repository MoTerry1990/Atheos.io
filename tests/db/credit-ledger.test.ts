import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { RELEASE_SQL, RESERVE_SQL } from "@/services/billing/ledger";

/**
 * The credit ledger, against real Postgres.
 *
 * ## What is being proved
 *
 * `REVENUE_READINESS_AUDIT.md` § 7 (B2): the old code read a balance, compared
 * it, and then decremented, with the read outside the transaction that wrote.
 * Two requests arriving together both saw 100, both passed a check against 100,
 * and both subtracted 90 — a −80 balance and two provider bills.
 *
 * The replacement is one conditional statement. Its correctness is entirely a
 * property of how Postgres evaluates `WHERE creditBalance >= $1` under a row
 * lock, which no mock can demonstrate and no amount of reading can settle.
 *
 * ## The SQL here is imported, not copied
 *
 * `RESERVE_SQL` comes from the module the application actually uses.
 * `tests/db/worker-queue.test.ts` notes that pasting a query into a test proves
 * the query is correct without proving the application sends it. On the one
 * query that decides whether money moves, that gap was not worth keeping.
 *
 * ## What this file honestly cannot prove
 *
 * **PGlite is a single connection.** It runs a genuine Postgres, so the
 * conditional update, the CHECK constraint and the unique indexes all behave
 * exactly as they will in production — but two transactions cannot be open at
 * once, so literally simultaneous requests are not exercised here.
 *
 * What *is* exercised is the property that makes simultaneity safe: the update
 * re-reads the balance as part of its own WHERE clause, so a second attempt
 * against a drained balance affects zero rows. Under real concurrency the row
 * lock is what forces that re-read; here the sequencing does. The statement
 * being verified is identical.
 *
 * A truly parallel test needs a real server and lives in
 * `credit-ledger.concurrency.test.ts`, which reports plainly whether it ran.
 */

let db: PGlite;
const MIGRATIONS = resolve(import.meta.dirname, "../../prisma/migrations");

beforeAll(async () => {
  db = new PGlite();

  for (const name of readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    await db.exec(
      readFileSync(resolve(MIGRATIONS, name, "migration.sql"), "utf8"),
    );
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(`
    DELETE FROM credit_transactions;
    DELETE FROM generations;
    DELETE FROM users;
    INSERT INTO users ("id","clerkId","email","creditBalance","updatedAt")
    VALUES ('u1','c1','one@example.com', 100, now());
  `);
});

/** Seed a generation so the ledger's foreign key has something to point at. */
async function seedGeneration(id: string) {
  await db.query(
    `INSERT INTO generations
       ("id","userId","provider","model","modality","prompt","status","creditsCost")
     VALUES ($1,'u1','replicate','replicate/video-gen','VIDEO','a cat','QUEUED',90)`,
    [id],
  );
}

/** The application's reservation statement, run verbatim. */
async function reserve(amount: number) {
  const result = await db.query<{ creditBalance: number }>(RESERVE_SQL, [
    amount,
    "u1",
  ]);
  return result.rows;
}

async function balance() {
  const result = await db.query<{ creditBalance: number }>(
    `SELECT "creditBalance" FROM users WHERE id = 'u1'`,
  );
  return result.rows[0]!.creditBalance;
}

describe("atomic reservation", () => {
  it("debits when the balance covers the cost", async () => {
    const rows = await reserve(90);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.creditBalance).toBe(10);
    expect(await balance()).toBe(10);
  });

  it("affects zero rows when the balance does not cover the cost", async () => {
    // The whole mechanism. Not an error, not an exception — an UPDATE that
    // matched nothing, which is what the service reads as "insufficient".
    const rows = await reserve(101);

    expect(rows).toHaveLength(0);
    expect(await balance()).toBe(100);
  });

  it("lets exactly one of many attempts spend the same credits", async () => {
    /**
     * The audit's attack, at rest: twenty requests, one 100-credit balance,
     * ninety credits each.
     *
     * Under the old read-then-write this granted twenty generations and left
     * the balance at −1,700. Here the first attempt takes the balance to 10 and
     * the remaining nineteen fail their own WHERE clause.
     */
    const outcomes = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      outcomes.push((await reserve(90)).length);
    }

    expect(outcomes.filter((rows) => rows === 1)).toHaveLength(1);
    expect(outcomes.filter((rows) => rows === 0)).toHaveLength(19);
    expect(await balance()).toBe(10);
  });

  it("spends a balance down to exactly zero and no further", async () => {
    expect(await reserve(100)).toHaveLength(1);
    expect(await balance()).toBe(0);

    // One credit more, on an empty account.
    expect(await reserve(1)).toHaveLength(0);
    expect(await balance()).toBe(0);
  });
});

describe("the non-negative constraint", () => {
  it("refuses a direct write that would go below zero", async () => {
    // The backstop behind the conditional update. This is what catches the
    // *next* piece of code that decrements without a guard — the exact bug the
    // conditional update was written to replace.
    await expect(
      db.query(`UPDATE users SET "creditBalance" = -1 WHERE id = 'u1'`),
    ).rejects.toThrow(/users_credit_balance_non_negative/);

    expect(await balance()).toBe(100);
  });

  it("refuses an unguarded decrement past the balance", async () => {
    await expect(
      db.query(
        `UPDATE users SET "creditBalance" = "creditBalance" - 500 WHERE id = 'u1'`,
      ),
    ).rejects.toThrow(/users_credit_balance_non_negative/);
  });
});

describe("idempotency", () => {
  it("refuses a second reservation for the same generation", async () => {
    await seedGeneration("g1");

    const insert = () =>
      db.query(
        `INSERT INTO credit_transactions
           ("id","userId","amount","reason","balanceAfter","generationId","idempotencyKey","createdAt")
         VALUES (gen_random_uuid()::text,'u1',-90,'GENERATION_RESERVATION',10,'g1','reserve:g1', now())`,
      );

    await insert();
    await expect(insert()).rejects.toThrow(/idempotencyKey|unique/i);
  });

  it("refuses a second release, so a job polled by three tabs refunds once", async () => {
    await seedGeneration("g2");

    const release = () =>
      db.query(
        `INSERT INTO credit_transactions
           ("id","userId","amount","reason","balanceAfter","generationId","idempotencyKey","createdAt")
         VALUES (gen_random_uuid()::text,'u1',90,'GENERATION_RELEASE',100,'g2','release:g2', now())`,
      );

    await release();
    await expect(release()).rejects.toThrow(/idempotencyKey|unique/i);
  });

  it("keeps reserve, capture and release on separate keys", async () => {
    // Three rows for one generation, all distinct. A shared key would make a
    // capture look like a duplicate reservation and be silently dropped.
    await seedGeneration("g3");

    for (const [key, amount, reason] of [
      ["reserve:g3", -90, "GENERATION_RESERVATION"],
      ["capture:g3", 0, "GENERATION_CAPTURE"],
      ["release:g3", 90, "GENERATION_RELEASE"],
    ] as const) {
      await db.query(
        `INSERT INTO credit_transactions
           ("id","userId","amount","reason","balanceAfter","generationId","idempotencyKey","createdAt")
         VALUES (gen_random_uuid()::text,'u1',$1,$2::"CreditReason",0,'g3',$3, now())`,
        [amount, reason, key],
      );
    }

    const rows = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM credit_transactions WHERE "generationId" = 'g3'`,
    );
    expect(rows.rows[0]!.count).toBe("3");
  });
});

describe("release", () => {
  it("returns credits and leaves the balance reconstructable", async () => {
    await reserve(90);
    expect(await balance()).toBe(10);

    const rows = await db.query<{ creditBalance: number }>(RELEASE_SQL, [
      90,
      "u1",
    ]);

    expect(rows.rows[0]!.creditBalance).toBe(100);
    expect(await balance()).toBe(100);
  });

  it("keeps balance equal to the sum of the ledger", async () => {
    /**
     * The invariant the whole ledger exists for.
     *
     * `balance = SUM(amount)` is what makes "explain this number" answerable.
     * A capture writes `amount: 0` precisely so that recording the moment a
     * reservation became final does not disturb it.
     */
    await seedGeneration("g4");
    await reserve(90);

    for (const [amount, reason, key] of [
      [-90, "GENERATION_RESERVATION", "reserve:g4"],
      [0, "GENERATION_CAPTURE", "capture:g4"],
    ] as const) {
      await db.query(
        `INSERT INTO credit_transactions
           ("id","userId","amount","reason","balanceAfter","generationId","idempotencyKey","createdAt")
         VALUES (gen_random_uuid()::text,'u1',$1,$2::"CreditReason",0,'g4',$3, now())`,
        [amount, reason, key],
      );
    }

    // 100 granted at signup, minus the 90 reserved.
    await db.query(
      `INSERT INTO credit_transactions
         ("id","userId","amount","reason","balanceAfter","idempotencyKey","createdAt")
       VALUES (gen_random_uuid()::text,'u1',100,'SIGNUP_GRANT',100,'signup-grant:c1', now())`,
    );

    const sum = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM("amount"),0)::text AS total
         FROM credit_transactions WHERE "userId" = 'u1'`,
    );

    expect(Number(sum.rows[0]!.total)).toBe(await balance());
  });
});

describe("spending counters", () => {
  it("cannot record negative spend", async () => {
    // A monthly total that can go down is a circuit breaker that can be
    // disarmed by writing to it.
    await db.query(
      `INSERT INTO budget_usage ("period","spentMicroUsd") VALUES ('2026-08', 1000)`,
    );

    await expect(
      db.query(
        `UPDATE budget_usage SET "spentMicroUsd" = -1 WHERE period = '2026-08'`,
      ),
    ).rejects.toThrow(/budget_usage_non_negative/);
  });

  it("keeps one row per month under repeated upserts", async () => {
    for (let i = 0; i < 5; i += 1) {
      await db.query(
        `INSERT INTO budget_usage ("period","spentMicroUsd") VALUES ('2026-09', 100)
         ON CONFLICT ("period") DO UPDATE
           SET "spentMicroUsd" = budget_usage."spentMicroUsd" + 100`,
      );
    }

    const rows = await db.query<{ spentMicroUsd: string }>(
      `SELECT "spentMicroUsd"::text AS "spentMicroUsd" FROM budget_usage WHERE period = '2026-09'`,
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.spentMicroUsd).toBe("500");
  });
});

describe("rate limit buckets", () => {
  it("counts up within a window and resets after it", async () => {
    const hit = (expiresInMs: number) =>
      db.query<{ count: number }>(
        `INSERT INTO rate_limit_buckets ("key","count","expiresAt")
         VALUES ('generate:u1', 1, now() + ($1 || ' milliseconds')::interval)
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
        [String(expiresInMs)],
      );

    expect((await hit(60_000)).rows[0]!.count).toBe(1);
    expect((await hit(60_000)).rows[0]!.count).toBe(2);
    expect((await hit(60_000)).rows[0]!.count).toBe(3);

    // Expire the window and hit again: back to 1, in the same row.
    await db.query(
      `UPDATE rate_limit_buckets SET "expiresAt" = now() - interval '1 second'`,
    );
    expect((await hit(60_000)).rows[0]!.count).toBe(1);

    const rows = await db.query(`SELECT * FROM rate_limit_buckets`);
    expect(rows.rows).toHaveLength(1);
  });
});
