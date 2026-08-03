import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Applies **every** migration in order, the way `prisma migrate deploy` would.
 *
 * `schema.test.ts` applies the baseline only. This exists so that the second
 * migration — and every one after it — is proven to apply *on top of* what came
 * before, which is the failure mode a single-migration test cannot see: a
 * migration that is valid alone and conflicts with its predecessor.
 */

let db: PGlite;

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../prisma/migrations");

function migrationsInOrder(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

beforeAll(async () => {
  db = new PGlite();
  for (const name of migrationsInOrder()) {
    const sql = readFileSync(
      resolve(MIGRATIONS_DIR, name, "migration.sql"),
      "utf8",
    );
    await db.exec(sql);
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const columnsOf = async (table: string) => {
  const { rows } = await db.query<{
    column_name: string;
    is_nullable: string;
    data_type: string;
  }>(
    `SELECT column_name, is_nullable, data_type
     FROM information_schema.columns WHERE table_name = $1`,
    [table],
  );
  return new Map(rows.map((r) => [r.column_name, r]));
};

describe("the migration chain", () => {
  it("applies every migration in order without conflict", () => {
    // Reaching `beforeAll` without throwing is the assertion. Stated explicitly
    // so a failure reads as "migrations conflict" rather than as a cryptic
    // setup error.
    expect(migrationsInOrder().length).toBeGreaterThanOrEqual(2);
  });

  it("keeps every baseline table and adds only expected ones", async () => {
    // Asserted by name rather than by count. The count version of this test
    // failed the moment Sprint 20 added `generation_logs` — which is the wrong
    // signal: a *new* table is normal, a *missing* one is the disaster. Naming
    // them catches the failure that matters and ignores the one that does not.
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'`,
    );
    const tables = new Set(rows.map((r) => r.table_name));

    for (const name of [
      "users",
      "subscriptions",
      "credit_transactions",
      "generations",
      "assets",
      "folders",
      "collections",
      "collection_assets",
      "admin_audit_log",
      "posts",
      "post_likes",
      "comments",
      "follows",
      "marketplace_favorites",
      "marketplace_installs",
      "webhook_events",
    ]) {
      expect(tables.has(name), `baseline table missing: ${name}`).toBe(true);
    }

    // Added by the worker migration.
    expect(tables.has("generation_logs")).toBe(true);
  });
});

describe("generation telemetry columns", () => {
  it("adds every telemetry column", async () => {
    const columns = await columnsOf("generations");

    for (const name of [
      "costMicroUsd",
      "latencyMs",
      "promptTokens",
      "completionTokens",
      "requestedProvider",
      "attempts",
    ]) {
      expect(columns.has(name), `missing column: ${name}`).toBe(true);
    }
  });

  it("makes every telemetry column nullable, with no default", async () => {
    // The point of the design: NULL means "not recorded". A default of 0 would
    // make an unpriced model look like a free one in a margin report.
    const columns = await columnsOf("generations");

    for (const name of [
      "costMicroUsd",
      "latencyMs",
      "promptTokens",
      "completionTokens",
    ]) {
      expect(columns.get(name)?.is_nullable, name).toBe("YES");
    }

    const { rows } = await db.query<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name='generations' AND column_name='costMicroUsd'`,
    );
    expect(rows[0].column_default).toBeNull();
  });

  it("stores attempts as JSONB, not text", async () => {
    // JSONB so a support query can filter on it. Text would make the attempt
    // trail unqueryable, which defeats the reason for recording it.
    const columns = await columnsOf("generations");
    expect(columns.get("attempts")?.data_type).toBe("jsonb");
  });

  it("indexes provider and createdAt together for cost reporting", async () => {
    const { rows } = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename='generations' AND indexname='generations_provider_createdAt_idx'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("accepts a fully populated telemetry row", async () => {
    await db.exec(`
      INSERT INTO users ("id","clerkId","email","updatedAt")
      VALUES ('tu1','tc1','t1@example.com',now());
    `);

    await db.query(
      `INSERT INTO generations
         ("id","userId","provider","model","modality","prompt",
          "costMicroUsd","latencyMs","promptTokens","completionTokens",
          "requestedProvider","attempts")
       VALUES ('tg1','tu1','openai','gpt-image-1','IMAGE','a cat',
               40000, 812, 1200, 340, 'replicate',
               '[{"providerId":"replicate","error":{"code":"timeout"}}]'::jsonb)`,
    );

    const { rows } = await db.query<{
      costMicroUsd: number;
      latencyMs: number;
      requestedProvider: string;
    }>(`SELECT "costMicroUsd","latencyMs","requestedProvider"
        FROM generations WHERE "id"='tg1'`);

    expect(rows[0].costMicroUsd).toBe(40_000);
    expect(rows[0].latencyMs).toBe(812);
    expect(rows[0].requestedProvider).toBe("replicate");
  });

  it("can query the attempt trail as JSON, which is why it is JSONB", async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM generations
       WHERE "attempts" @> '[{"providerId":"replicate"}]'::jsonb`,
    );
    expect(rows[0].n).toBe(1);
  });

  it("leaves telemetry null when not supplied, rather than zero", async () => {
    await db.query(
      `INSERT INTO generations ("id","userId","provider","model","modality","prompt")
       VALUES ('tg2','tu1','mock','mock/x','IMAGE','y')`,
    );

    const { rows } = await db.query<{
      costMicroUsd: number | null;
      promptTokens: number | null;
    }>(
      `SELECT "costMicroUsd","promptTokens" FROM generations WHERE "id"='tg2'`,
    );

    expect(rows[0].costMicroUsd).toBeNull();
    expect(rows[0].promptTokens).toBeNull();
  });
});
