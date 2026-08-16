import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Disposable, uniquely-named schemas on the managed `atheos-test` database.
 *
 * ## What this replaces, and why
 *
 * The concurrency suite used to begin with:
 *
 *     DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
 *
 * That is correct for a throwaway container and catastrophic anywhere else, so
 * it was guarded by refusing any URL containing `supabase` or `pooler`. The
 * guard worked, and its cost was that the tests could only ever run against a
 * local Postgres — which is not installed here, so they never ran at all. Three
 * tests skipped for weeks is not safety; it is the appearance of safety.
 *
 * The replacement removes the reason for the guard rather than the guard. No
 * statement here ever touches `public`. Each run creates one schema of its own,
 * works entirely inside it, and drops exactly that schema by name.
 *
 * ## Fail closed
 *
 * Every check below throws rather than returning false. A test that cannot
 * prove which database it is pointed at must not run, and must not quietly
 * skip either — an unproven identity is an error, not an absence.
 */

/**
 * The production project. Hard-coded on purpose.
 *
 * This is a public identifier, not a credential — it appears in the pooler
 * username and in `docs/`. Writing it down is what makes "is this production?"
 * answerable in code rather than by eye.
 */
const PRODUCTION_REF = "wzrbeapgfnfsedyphuyp";

/** Every schema this harness creates begins with exactly this. */
export const SCHEMA_PREFIX = "atheos_migration_test_";

/**
 * The only shape a droppable schema may have.
 *
 * Anchored at both ends and limited to lowercase hex, so a name cannot carry a
 * quote, a semicolon, or a trailing `; DROP SCHEMA public`. The drop path
 * re-validates against this immediately before executing.
 */
const SCHEMA_PATTERN = /^atheos_migration_test_[0-9a-f]{16}$/;

export interface TestTarget {
  connectionString: string;
  /** Project ref of the target, proven not to be production. */
  ref: string;
}

/**
 * Read and prove the target database.
 *
 * Parsed by hand rather than with `URL`: a password containing `[` or `]` makes
 * `new URL()` throw, which is not hypothetical — both the production and the
 * test connection strings arrived that way, wrapped in the brackets from
 * Supabase's `[YOUR-PASSWORD]` template.
 */
export function managedTarget(): TestTarget {
  const raw = process.env.MIGRATION_TEST_DATABASE_URL;

  if (!raw) {
    throw new Error(
      "MIGRATION_TEST_DATABASE_URL is not set. These tests require the " +
        "atheos-test managed database; they must not fall back to production.",
    );
  }

  const afterScheme = raw.slice(raw.indexOf("://") + 3);
  const at = afterScheme.lastIndexOf("@");
  if (at < 0) throw new Error("MIGRATION_TEST_DATABASE_URL is malformed.");

  const userinfo = afterScheme.slice(0, at);
  const user = decodeURIComponent(userinfo.slice(0, userinfo.indexOf(":")));
  const ref = user.includes(".") ? user.slice(user.indexOf(".") + 1) : "";

  if (!ref) {
    throw new Error(
      "Could not determine the project ref from MIGRATION_TEST_DATABASE_URL. " +
        "Identity is unproven, so refusing to run.",
    );
  }

  // Two independent checks. The username could in principle be shaped
  // correctly while the host still points at production.
  if (ref === PRODUCTION_REF || raw.includes(PRODUCTION_REF)) {
    throw new Error(
      "MIGRATION_TEST_DATABASE_URL points at the PRODUCTION project. Refusing.",
    );
  }

  return { connectionString: raw, ref };
}

/** True when the managed target is configured — for `describe.skipIf`. */
export function managedTargetConfigured(): boolean {
  return Boolean(process.env.MIGRATION_TEST_DATABASE_URL);
}

export interface IsolatedSchema {
  schema: string;
  pool: Pool;
  /** Drops exactly this schema. Safe to call twice. */
  destroy: () => Promise<void>;
}

/**
 * Create one schema, and a pool whose every connection is scoped to it.
 *
 * `options: -c search_path=…` is a startup parameter, so it applies to each
 * connection the pool opens rather than to whichever one happened to run a
 * `SET`. That distinction matters here: the concurrency tests deliberately use
 * many simultaneous connections, and a `SET search_path` on one of them would
 * leave the others pointed at `public`.
 */
export async function createIsolatedSchema(
  maxConnections = 24,
): Promise<IsolatedSchema> {
  const target = managedTarget();
  const schema = `${SCHEMA_PREFIX}${randomBytes(8).toString("hex")}`;

  if (!SCHEMA_PATTERN.test(schema)) {
    throw new Error(`Generated schema name failed validation: ${schema}`);
  }

  /**
   * One migrated schema at a time, across the whole test run.
   *
   * The Sprint 4 migration decides whether it has already run by looking for a
   * `PlanTier` carrying `CREATOR` — with **no namespace filter**, so it matches
   * that type in *any* schema. Production has one schema and never notices;
   * this harness creates several, and Vitest runs files in parallel, so a
   * second schema would find the first's `CREATOR` and silently skip its own
   * rotation. That is exactly what happened: the enum came back as
   * `STARTER, BASIC, …` in a schema that had just "migrated".
   *
   * Serialising the *apply* was not enough — the other schema still existed
   * with `CREATOR` in it. So the lock is held for the schema's entire lifetime
   * and released in `destroy()`, which means the previous schema is dropped
   * before the next one is created.
   *
   * The cost is that managed test files run one at a time. That is the correct
   * trade: the alternative is a test that passes while proving nothing.
   *
   * This is a property of the migration and **not** a production defect, so the
   * migration is left exactly as it is.
   */
  const lock = new Pool({
    connectionString: target.connectionString,
    max: 1,
    ssl: { rejectUnauthorized: false },
  });
  await lock.query(
    `SELECT pg_advisory_lock(hashtext('atheos_migration_rehearsal'))`,
  );

  try {
    await lock.query(`CREATE SCHEMA "${schema}"`);
  } catch (error) {
    await lock.end().catch(() => undefined);
    throw error;
  }

  const pool = new Pool({
    connectionString: target.connectionString,
    max: maxConnections,
    ssl: { rejectUnauthorized: false },
    // `public` stays on the path for extensions (pgcrypto, uuid-ossp) that
    // live there. It is last, so every unqualified CREATE lands in the test
    // schema, and nothing here ever writes to it.
    options: `-c search_path="${schema}",public`,
  });

  let destroyed = false;
  const destroy = async () => {
    if (destroyed) return;
    destroyed = true;
    await pool.end().catch(() => undefined);

    // Re-validate at the point of destruction. The name has not changed since
    // it was generated, and checking again costs nothing — this is the one
    // statement in the file that destroys anything.
    if (!SCHEMA_PATTERN.test(schema) || schema === "public") {
      throw new Error(`Refusing to drop unsafe schema name: ${schema}`);
    }

    try {
      // Same connection that holds the lock, so the drop is guaranteed to
      // happen before any other file is allowed to create its schema.
      await lock.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await lock
        .query(
          `SELECT pg_advisory_unlock(hashtext('atheos_migration_rehearsal'))`,
        )
        .catch(() => undefined);
      await lock.end().catch(() => undefined);
    }
  };

  return { schema, pool, destroy };
}

const MIGRATIONS = resolve(import.meta.dirname, "../../prisma/migrations");

export function migrationNames(): string[] {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function migrationSql(name: string): string {
  return readFileSync(resolve(MIGRATIONS, name, "migration.sql"), "utf8");
}

/**
 * Apply migrations in order, up to but not including `stopBefore`.
 *
 * No migration file qualifies a table with `public.` — verified across all
 * nine — so with the search_path above every object lands in the test schema.
 */
/**
 * Kept for call sites that apply a migration directly.
 *
 * The lock now lives on the schema itself (see `createIsolatedSchema`), held
 * from creation to drop. Acquiring it again here from a *different* session
 * would deadlock against ourselves, so this is deliberately a pass-through.
 */
export async function withMigrationLock<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

export async function applyMigrations(
  isolated: IsolatedSchema,
  stopBefore?: string,
): Promise<string[]> {
  const applied: string[] = [];
  for (const name of migrationNames()) {
    if (stopBefore && name === stopBefore) break;
    await isolated.pool.query(migrationSql(name));
    applied.push(name);
  }
  return applied;
}
