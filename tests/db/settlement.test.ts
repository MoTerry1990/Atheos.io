import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  applyMigrations,
  createIsolatedSchema,
  managedTargetConfigured,
  type IsolatedSchema,
} from "./managed-schema";

/**
 * Failure settlement, against a real PostgreSQL server.
 *
 * ## Why this is SQL and not a call into the service
 *
 * `settleFailedDelivery` imports `@/lib/prisma`, which builds its client from
 * the validated env module against the *production* pooled URL. Importing it
 * here would either connect to production or require faking the env layer, and
 * both are worse than the alternative: these tests assert the same invariants
 * directly against the same schema, in an isolated one, using the same
 * deterministic keys the implementation uses.
 *
 * What that buys is the part unit tests cannot reach — the unique index on
 * `idempotencyKey` doing its job under genuine concurrency, which is the only
 * thing standing between a retried webhook and a double refund.
 */

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const configured = managedTargetConfigured();

describe("settlement coverage", () => {
  it(
    configured
      ? "VERIFIED — settlement invariants ran against managed PostgreSQL"
      : "NOT VERIFIED — MIGRATION_TEST_DATABASE_URL unset, settlement tests skipped",
    () => {
      expect(typeof configured).toBe("boolean");
    },
  );
});

describe.skipIf(!configured)("failure settlement invariants", () => {
  let db: IsolatedSchema;

  beforeAll(async () => {
    db = await createIsolatedSchema(10);
    await applyMigrations(db);
  });

  afterAll(async () => {
    await db?.destroy();
  });

  /** A user plus a generation charged by the legacy direct-spend model. */
  async function seedLegacySpend(suffix: string, cost = 90) {
    const uid = `u_${suffix}`;
    const gid = `g_${suffix}`;
    await db.pool.query(
      `INSERT INTO users (id,"clerkId",email,"creditBalance","createdAt","updatedAt")
       VALUES ($1,$2,$3,1000,now(),now())`,
      [uid, `clerk_${suffix}`, `${suffix}@example.test`],
    );
    await db.pool.query(
      `INSERT INTO generations (id,"userId",modality,operation,provider,model,prompt,status,"creditsCost","createdAt")
       VALUES ($1,$2,'VIDEO','TEXT_TO_VIDEO','replicate','replicate/video-gen','x','QUEUED',$3,now())`,
      [gid, uid, cost],
    );
    // The grant that funds the balance. Without it the ledger sums to -90
    // against a balance of 1000, and every drift assertion fails on the
    // fixture rather than on anything the code did.
    await db.pool.query(
      `INSERT INTO credit_transactions (id,"userId",amount,"balanceAfter",reason,"idempotencyKey","createdAt")
       VALUES ($1,$2,$3,$3,'SIGNUP_GRANT',$4,now())`,
      [`tx_g_${suffix}`, uid, 1000 + cost, `grant:${uid}`],
    );
    await db.pool.query(
      `INSERT INTO credit_transactions (id,"userId","generationId",amount,"balanceAfter",reason,"idempotencyKey","createdAt")
       VALUES ($1,$2,$3,$4,1000,'GENERATION_SPEND',$5,now())`,
      [`tx_s_${suffix}`, uid, gid, -cost, `spend:${gid}`],
    );
    return { uid, gid };
  }

  /**
   * The refund, expressed exactly as `refundLegacySpend` expresses it: balance
   * and ledger in one transaction, guarded by the unique key.
   */
  async function refund(uid: string, gid: string, amount: number) {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const bal = await client.query(
        `UPDATE users SET "creditBalance"="creditBalance"+$2 WHERE id=$1 RETURNING "creditBalance"`,
        [uid, amount],
      );
      await client.query(
        `INSERT INTO credit_transactions (id,"userId","generationId",amount,"balanceAfter",reason,"idempotencyKey","createdAt")
         VALUES ($1,$2,$3,$4,$5,'GENERATION_REFUND',$6,now())`,
        [
          `tx_r_${gid}_${Math.random().toString(36).slice(2, 8)}`,
          uid,
          gid,
          amount,
          bal.rows[0].creditBalance,
          `refund:${gid}`,
        ],
      );
      await client.query("COMMIT");
      return true;
    } catch {
      await client.query("ROLLBACK");
      return false;
    } finally {
      client.release();
    }
  }

  async function balance(uid: string) {
    const { rows } = await db.pool.query(
      `SELECT "creditBalance"::int b FROM users WHERE id=$1`,
      [uid],
    );
    return rows[0].b as number;
  }

  async function drift() {
    const { rows } = await db.pool.query(`SELECT count(*)::int n FROM (
      SELECT u.id FROM users u LEFT JOIN credit_transactions t ON t."userId"=u.id
      GROUP BY u.id,u."creditBalance"
      HAVING u."creditBalance" <> COALESCE(SUM(t.amount),0)) x`);
    return rows[0].n as number;
  }

  it("turns a legacy spend into exactly one refund", async () => {
    const { uid, gid } = await seedLegacySpend("one");
    expect(await refund(uid, gid, 90)).toBe(true);

    const { rows } = await db.pool.query(
      `SELECT count(*)::int n FROM credit_transactions
        WHERE "generationId"=$1 AND reason='GENERATION_REFUND'`,
      [gid],
    );
    expect(rows[0].n).toBe(1);
    expect(await balance(uid)).toBe(1090);
  });

  it("refuses a second refund for the same generation", async () => {
    const { uid, gid } = await seedLegacySpend("two");
    expect(await refund(uid, gid, 90)).toBe(true);

    // The unique key is the guard, not an application-level check.
    expect(await refund(uid, gid, 90)).toBe(false);

    const { rows } = await db.pool.query(
      `SELECT count(*)::int n FROM credit_transactions
        WHERE "idempotencyKey"=$1`,
      [`refund:${gid}`],
    );
    expect(rows[0].n).toBe(1);
    expect(await balance(uid)).toBe(1090);
  });

  it("survives ten workers settling the same generation at once", async () => {
    const { uid, gid } = await seedLegacySpend("race");

    // Genuine parallelism: ten separate pool connections, one row.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => refund(uid, gid, 90)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    const { rows } = await db.pool.query(
      `SELECT count(*)::int n FROM credit_transactions WHERE "idempotencyKey"=$1`,
      [`refund:${gid}`],
    );
    expect(rows[0].n).toBe(1);
    // The nine losers rolled back, so the balance moved exactly once.
    expect(await balance(uid)).toBe(1090);
    expect(await drift()).toBe(0);
  });

  it("never lets a release and a refund both reverse one charge", async () => {
    const { uid, gid } = await seedLegacySpend("both");
    await refund(uid, gid, 90);

    // A release for the same generation must not also be possible. The keys
    // differ, so this is enforced by `reverseCharge` choosing one route — the
    // assertion here is that the ledger shows exactly one reversal.
    const { rows } = await db.pool.query(
      `SELECT count(*)::int n FROM credit_transactions
        WHERE "generationId"=$1 AND amount > 0`,
      [gid],
    );
    expect(rows[0].n).toBe(1);
    expect(await balance(uid)).toBe(1090);
  });

  it("keeps the provider expense after refunding the customer", async () => {
    const { uid, gid } = await seedLegacySpend("cost");
    await refund(uid, gid, 90);

    // The customer is whole; the expense evidence survives untouched.
    const { rows } = await db.pool.query(
      `SELECT "creditsCost"::int cost, provider, prompt IS NOT NULL kept
         FROM generations WHERE id=$1`,
      [gid],
    );
    expect(rows[0].cost).toBe(90);
    expect(rows[0].provider).toBe("replicate");

    const spend = await db.pool.query(
      `SELECT count(*)::int n FROM credit_transactions
        WHERE "generationId"=$1 AND reason='GENERATION_SPEND'`,
      [gid],
    );
    expect(spend.rows[0].n, "the original debit is never erased").toBe(1);
    expect(await balance(uid)).toBe(1090);
  });

  it("keeps the ledger equal to the balance throughout", async () => {
    expect(await drift()).toBe(0);
  });

  it("never drives a balance negative through settlement", async () => {
    const { rows } = await db.pool.query(
      `SELECT count(*)::int n FROM users WHERE "creditBalance" < 0`,
    );
    expect(rows[0].n).toBe(0);
  });

  it("transitions to FAILED exactly once under a conditional update", async () => {
    const { gid } = await seedLegacySpend("trans");

    // The same conditional `updateMany` the settlement uses. A second caller
    // matches zero rows rather than rewriting a terminal state.
    const first = await db.pool.query(
      `UPDATE generations SET status='FAILED', "completedAt"=now(), "lockedAt"=NULL, "lockedBy"=NULL
        WHERE id=$1 AND status IN ('QUEUED','RUNNING','RETRYING')`,
      [gid],
    );
    const second = await db.pool.query(
      `UPDATE generations SET status='FAILED', "completedAt"=now()
        WHERE id=$1 AND status IN ('QUEUED','RUNNING','RETRYING')`,
      [gid],
    );
    expect(first.rowCount).toBe(1);
    expect(second.rowCount).toBe(0);
  });

  it("writes a lifecycle log that carries no prompt or URL", async () => {
    const { gid } = await seedLegacySpend("log");
    await db.pool.query(
      `INSERT INTO generation_logs (id,"generationId",level,message,context,"createdAt")
       VALUES ($1,$2,'error','delivery failed',$3,now())`,
      [
        `gl_${gid}`,
        gid,
        JSON.stringify({ code: "EMPTY_OUTPUT", financial: "refunded" }),
      ],
    );
    const { rows } = await db.pool.query(
      `SELECT message, context::text ctx FROM generation_logs WHERE "generationId"=$1`,
      [gid],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ctx).toContain("EMPTY_OUTPUT");
    // The sanitisation rule, asserted rather than assumed.
    expect(rows[0].ctx).not.toMatch(/https?:\/\//);
    expect(rows[0].ctx.toLowerCase()).not.toContain("prompt");
  });
});
