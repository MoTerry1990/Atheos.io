/**
 * Prove the backup restores.
 *
 * A file on disk is not a backup until something has read it back. This
 * rebuilds the schema from `prisma/migrations` into a throwaway PostgreSQL
 * instance, replays the dump into it, and compares the resulting row counts
 * against production.
 *
 * PGlite is PostgreSQL compiled to WebAssembly — not SQLite, not a mock. Its
 * one limitation is a single connection, which is irrelevant here: a restore
 * is a single serial stream of statements by definition.
 *
 * Nothing about the connection string, and no row contents, reach stdout.
 *
 * Usage:  node scripts/verify-backup.mjs <path-to-dump.sql>
 */

import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const dumpPath = process.argv[2];
if (!dumpPath) throw new Error("usage: verify-backup.mjs <dump.sql>");

const MIGRATIONS = resolve(process.cwd(), "prisma/migrations");

function connectionString() {
  const file = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of file.split(/\r?\n/)) {
    const m = line.match(/^\s*DIRECT_URL\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m?.[1]) return m[1];
  }
  throw new Error("DIRECT_URL is not set");
}

/** Counts straight from production, to compare against. */
async function liveCounts() {
  const client = new Client({
    connectionString: connectionString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: tables } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  );

  const counts = {};
  for (const { tablename } of tables) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM "${tablename}"`,
    );
    counts[tablename] = rows[0].n;
  }

  await client.end();
  return counts;
}

async function restoredCounts() {
  const db = new PGlite();

  // Schema first, from the migrations that git holds and that were verified
  // applied against production during preflight.
  const names = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const name of names) {
    await db.exec(
      readFileSync(resolve(MIGRATIONS, name, "migration.sql"), "utf8"),
    );
  }

  // `_prisma_migrations` is created by Prisma Migrate, not by the migration
  // files, so a restore target built this way has to be given it.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _prisma_migrations (
      id text PRIMARY KEY, checksum text NOT NULL,
      finished_at timestamptz, migration_name text NOT NULL,
      logs text, rolled_back_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT now(),
      applied_steps_count integer NOT NULL DEFAULT 0
    );
  `);

  await db.exec(readFileSync(resolve(process.cwd(), dumpPath), "utf8"));

  const { rows: tables } = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  );

  const counts = {};
  for (const { tablename } of tables) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM "${tablename}"`,
    );
    counts[tablename] = rows[0].n;
  }

  // The financial invariant, checked on the restored copy rather than assumed:
  // the cached balance must still equal the sum of the ledger.
  const { rows: drift } = await db.query(`
    SELECT count(*)::int AS n FROM (
      SELECT u.id FROM users u
      LEFT JOIN credit_transactions t ON t."userId" = u.id
      GROUP BY u.id, u."creditBalance"
      HAVING u."creditBalance" <> COALESCE(SUM(t.amount), 0)
    ) x
  `);

  const { rows: total } = await db.query(
    `SELECT COALESCE(sum("creditBalance"),0)::int AS total FROM users`,
  );

  await db.close();
  return { counts, drift: drift[0].n, balanceTotal: total[0].total };
}

const live = await liveCounts();
const { counts: restored, drift, balanceTotal } = await restoredCounts();

const mismatches = Object.keys(live)
  .filter((t) => (live[t] ?? 0) !== (restored[t] ?? 0))
  .map((t) => ({
    table: t,
    live: live[t],
    restored: restored[t] ?? "missing",
  }));

// Operator-facing summary; see the note in backup-production.mjs.
// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      tablesCompared: Object.keys(live).length,
      liveRows: Object.values(live).reduce((a, b) => a + b, 0),
      restoredRows: Object.values(restored).reduce((a, b) => a + b, 0),
      mismatches,
      restoresCleanly: mismatches.length === 0,
      balanceLedgerDrift: drift,
      restoredBalanceTotal: balanceTotal,
    },
    null,
    2,
  ),
);

process.exit(mismatches.length === 0 && drift === 0 ? 0 : 1);
