/**
 * A logical backup of the production database, without `pg_dump`.
 *
 * ## Why this exists
 *
 * `docs/OPERATIONS.md` § 6.1 specifies `pg_dump`. It is not installed on this
 * machine, is not in any standard Windows PostgreSQL location, and there is no
 * package manager present that already carries it. Rather than claim a dump
 * that did not happen, this produces an equivalent **data-only** export using
 * the `pg` driver the application already depends on.
 *
 * ## What it does and does not cover
 *
 * **Data: complete.** Every row of every table in the `public` schema,
 * including `_prisma_migrations`, written as `INSERT` statements.
 *
 * **Schema: not included, and does not need to be.** The schema is fully
 * reproducible from `prisma/migrations`, which is in git and whose applied
 * state was verified against the database before this ran. Restoring means
 * `prisma migrate deploy` onto an empty database, then this file.
 *
 * This is the honest limit of the substitution: a real `pg_dump` also captures
 * sequences, functions, extensions, RLS policies and grants. This project has
 * no functions or RLS of its own, and Prisma owns the rest — but if Supabase
 * ever adds policies outside the migrations, they are not in here.
 *
 * ## Literals are quoted by Postgres, not by JavaScript
 *
 * Every value is cast to `text` and wrapped in `quote_nullable()` **inside the
 * query**. Postgres does the escaping, and the resulting literal coerces back
 * to the original column type on insert — including `jsonb`, arrays, enums,
 * timestamps and `bytea`. Hand-rolling that escaping in JS is where this kind
 * of script normally corrupts data, so it does not try.
 *
 * ## It never prints a connection string
 *
 * The URL is read from `.env.local` and passed straight to the driver. Nothing
 * derived from it is written to stdout or into the backup file.
 *
 * Usage:  node scripts/backup-production.mjs
 */

import { Client } from "pg";
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";

/** Outside the repository — a dump inside a git working tree invites a commit. */
const BACKUP_DIR =
  process.env.ATHEOS_BACKUP_DIR ?? "C:/Users/mauri/Backups/atheos";

function connectionString() {
  const file = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");

  for (const line of file.split(/\r?\n/)) {
    const match = line.match(/^\s*DIRECT_URL\s*=\s*"?([^"\n]*)"?\s*$/);
    if (match?.[1]) return match[1];
  }

  throw new Error("DIRECT_URL is not set in .env.local");
}

/**
 * Tables in dependency order is not attempted.
 *
 * The restore header sets `session_replication_role = replica`, which suspends
 * foreign-key triggers for the session. That is the standard way to load a
 * logical dump without solving the ordering problem, and it is what `pg_dump
 * --disable-triggers` does.
 */
async function tableNames(client) {
  const { rows } = await client.query(`
    SELECT tablename
      FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename
  `);
  return rows.map((row) => row.tablename);
}

async function columnNames(client, table) {
  const { rows } = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((row) => row.column_name);
}

async function main() {
  mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = resolve(BACKUP_DIR, `atheos-production-${stamp}.sql`);
  const out = createWriteStream(target, { encoding: "utf8" });

  const write = (text) =>
    out.write(text)
      ? Promise.resolve()
      : new Promise((r) => out.once("drain", r));

  const client = new Client({
    connectionString: connectionString(),
    ssl: { rejectUnauthorized: false },
    // A backup must not be interrupted by a statement timeout mid-table.
    statement_timeout: 0,
  });

  await client.connect();

  await write(
    [
      "-- Atheos production — logical data backup",
      `-- Taken: ${new Date().toISOString()}`,
      "--",
      "-- Data only. Restore onto a database whose schema has been rebuilt with",
      "--   npx prisma migrate deploy",
      "-- then run this file. Foreign-key triggers are suspended for the session.",
      "--",
      "BEGIN;",
      "SET session_replication_role = replica;",
      "",
    ].join("\n"),
  );

  const tables = await tableNames(client);
  const counts = {};

  for (const table of tables) {
    const columns = await columnNames(client, table);
    if (columns.length === 0) continue;

    const columnList = columns.map((c) => `"${c}"`).join(", ");

    // Postgres builds the literal list; this file never quotes a value itself.
    const literals = columns
      .map((c) => `quote_nullable("${c}"::text)`)
      .join(", ");

    const { rows } = await client.query(
      `SELECT 'INSERT INTO "${table}" (${columnList}) VALUES (' ||
              concat_ws(', ', ${literals}) ||
              ');' AS stmt
         FROM "${table}"`,
    );

    counts[table] = rows.length;

    await write(`-- ${table}: ${rows.length} row(s)\n`);
    for (const row of rows) await write(row.stmt + "\n");
    await write("\n");
  }

  await write(
    ["SET session_replication_role = origin;", "COMMIT;", ""].join("\n"),
  );

  await client.end();
  out.end();
  await pipeline(out.closed ? [] : [], async () => {}).catch(() => {});
  await new Promise((r) => out.on("close", r));

  const size = statSync(target).size;

  // Filename and directory only — no credentials, no row contents. This is an
  // operator-facing script whose entire output is this summary, which is why
  // the project's no-console rule is waived here rather than loosened.
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        file: target.split(/[\\/]/).pop(),
        directory: BACKUP_DIR,
        takenAt: new Date().toISOString(),
        bytes: size,
        tables: Object.keys(counts).length,
        rows: Object.values(counts).reduce((a, b) => a + b, 0),
        perTable: counts,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("BACKUP FAILED:", error.message.split("\n")[0].slice(0, 200));
  process.exit(1);
});
