# Production migration apply plan

`20260814000000_financial_safety_and_plan_tiers` — the one migration on disk that
production has not applied.

**Nothing in this file has been run against production.** It is the plan, written
after the read-only preflight in Sprint 5A, to be executed only on approval.

Preflight taken 2026-08-16 against project `wzrbeapgfnfsedyphuyp`.

---

## 1. What the migration does

| Change                              | Detail                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `budget_usage`                      | new table (absent in production — confirmed)                                        |
| `rate_limit_buckets`                | new table (absent in production — confirmed)                                        |
| `budget_usage_non_negative`         | new CHECK (absent — confirmed)                                                      |
| `users_credit_balance_non_negative` | new CHECK (absent — confirmed)                                                      |
| `CreditReason`                      | three values added via `ADD VALUE IF NOT EXISTS`                                    |
| `PlanTier`                          | **rebuilt**: `STARTER, BASIC, STUDIO, SCALE, AGENCY` → `FREE, CREATOR, PRO, STUDIO` |
| indexes                             | two on `credit_transactions`, `IF NOT EXISTS`                                       |

### The tier mapping

```
STARTER → FREE
BASIC   → FREE      (retired $5 tier; nearest surviving plan)
STUDIO  → CREATOR   ← changes meaning
SCALE   → PRO
AGENCY  → STUDIO    ← takes the STUDIO name
```

This is a **rotation**, not a rename: `STUDIO` and `AGENCY` both move, and
`STUDIO` means something different afterwards. That is why it is done by building
`PlanTier_new` and converting with an explicit `USING CASE` — value-by-value
`RENAME VALUE` cannot express a rotation without a collision.

The `CASE` has no `ELSE`. An unmapped legacy value therefore yields `NULL` against
a `NOT NULL` column, which aborts the transaction. That is the correct failure
mode: loud, atomic, no silent mis-tiering.

---

## 2. Why the risk is unusually low right now

The preflight found the blast radius is empty:

| Fact                                                       | Value                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| Columns typed `PlanTier`                                   | exactly two, both on `subscriptions`                            |
| `subscriptions` row count                                  | **0**                                                           |
| Rows that will be remapped                                 | **0**                                                           |
| `users` / `credit_transactions` / `generations` / `assets` | 1 / 40 / 29 / 21                                                |
| Users with negative balance                                | 0 (so the new CHECK cannot reject an existing row)              |
| Balance-vs-ledger drift                                    | 0                                                               |
| Target objects already present                             | none — migration is not partially applied                       |
| Migration role                                             | `postgres`, owns all 21 tables, `CREATE` on database and schema |
| Server                                                     | PostgreSQL 17.6                                                 |

`subscriptions.planTier` carries a column default of `'STARTER'`, a value the new
enum does not contain. The migration drops that default _before_ the type
conversion and restores it as `'FREE'` afterwards — the single most likely
failure point, already handled.

**This is the cheapest moment this migration will ever be applied.** Every
additional subscriber increases the cost of getting it wrong.

---

## 3. Maintenance window

**Recommended: none required, but schedule 15 minutes of low traffic.**

The DDL is fast (empty tables, two new tables, two indexes on a 40-row table).
Expected lock duration is well under a second. `ALTER TABLE ... ALTER COLUMN
TYPE` takes an `ACCESS EXCLUSIVE` lock on `subscriptions`, which currently has no
rows and no readers.

**Maximum acceptable downtime: 60 seconds.** Past that, something is wrong —
abort rather than wait (see §8).

---

## 4. Backup

Taken and verified before this plan was written:

|                  |                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------- |
| File             | `atheos-production-2026-08-16T06-01-05-932Z.sql`                                      |
| Directory        | `C:/Users/mauri/Backups/atheos` (outside the repo, untracked)                         |
| Size             | 78,123 bytes                                                                          |
| SHA-256          | `0cde658e6776c073d57d32b97547228ab85193f703da2d7705c7bedb51bc9723`                    |
| Tables           | 21                                                                                    |
| Rows             | 115                                                                                   |
| Restore verified | yes — replayed into PGlite, 115/115 rows, 0 mismatches, ledger drift 0, balance 16493 |

**Take a fresh backup immediately before applying** — this one ages the moment
anybody signs in.

```bash
node scripts/backup-production.mjs
```

```bash
node scripts/verify-backup.mjs "C:/Users/mauri/Backups/atheos/<new-file>.sql"
```

Proceed only if `restoresCleanly: true` and `balanceLedgerDrift: 0`.

---

## 5. Final read-only preflight

Re-run immediately before applying; all four must still hold.

```sql
SELECT count(*) FROM subscriptions;
```

Expect `0`. **If this is not 0, stop** and re-verify the tier mapping against the
actual distribution before continuing.

```sql
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
 WHERE t.typname='PlanTier' ORDER BY e.enumsortorder;
```

Expect the five legacy values. If `CREATOR` is present the migration already ran.

```sql
SELECT to_regclass('public.budget_usage'), to_regclass('public.rate_limit_buckets');
```

Expect two `NULL`s.

```sql
SELECT count(*) FROM users WHERE "creditBalance" < 0;
```

Expect `0`, or `users_credit_balance_non_negative` will reject an existing row.

---

## 6. The apply command

```bash
npx prisma migrate deploy
```

`migrate deploy`, never `migrate dev` — `dev` may reset the database and is not
for production. It connects via `DIRECT_URL` (session pooler, port 5432), which
is correct: DDL must not go through the transaction pooler on 6543.

### Expected output

```
9 migrations found in prisma/migrations

Applying migration `20260814000000_financial_safety_and_plan_tiers`

The following migration(s) have been applied:
...
All migrations have been successfully applied.
```

Only that one migration should be named. If it names others, the history is not
what the preflight measured — **stop**.

---

## 7. Post-migration verification

```sql
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
 WHERE t.typname='PlanTier' ORDER BY e.enumsortorder;
```

Expect exactly `FREE, CREATOR, PRO, STUDIO` — and nothing else.

```sql
SELECT to_regclass('public.budget_usage'), to_regclass('public.rate_limit_buckets');
```

Both non-null.

```sql
SELECT conname FROM pg_constraint
 WHERE conname IN ('budget_usage_non_negative','users_credit_balance_non_negative');
```

Both rows present.

```sql
SELECT column_default FROM information_schema.columns
 WHERE table_name='subscriptions' AND column_name='planTier';
```

Expect `'FREE'::"PlanTier"`.

```sql
SELECT count(*) FROM users;
SELECT count(*) FROM credit_transactions;
SELECT COALESCE(sum("creditBalance"),0) FROM users;
```

Expect `1`, `40`, `16493` — unchanged. **Any change here means data moved and is
a rollback trigger.**

```sql
SELECT count(*) FROM (
  SELECT u.id FROM users u LEFT JOIN credit_transactions t ON t."userId"=u.id
  GROUP BY u.id, u."creditBalance"
  HAVING u."creditBalance" <> COALESCE(SUM(t.amount),0)) x;
```

Expect `0`.

### Idempotency

```bash
npx prisma migrate deploy
```

Second run must report `No pending migrations to apply.` The enum block also
guards itself: it returns early if `CREATOR` already exists.

### Application smoke tests

- `/sitemap.xml` → 200 with content (this is the unauthenticated route that
  queries `prisma.user.findMany()`)
- Signed-in `/dashboard`, `/studio`, `/profile`, `/settings` → 200
- Vercel Runtime Logs → no `PrismaClientKnownRequestError`, no `P2021`
  (table does not exist), no `P2022` (column does not exist)
- One generation through the mock provider, confirming a reserve → capture
  ledger pair (**no paid generation**)

---

## 8. Rollback

### Triggers — any one of these, roll back

- `migrate deploy` exits non-zero
- the enum ends up with anything other than the four canonical values
- any row count in §7 differs from `1 / 40 / 29 / 21`
- balance-vs-ledger drift becomes non-zero
- protected routes return 500 after deploy
- `P2021` / `P2022` in runtime logs
- DDL still running after **60 seconds**

### Tooling

PostgreSQL client **17.11** is installed and **not on PATH**. Use the full paths;
a bare `psql` will not resolve.

```
C:\Program Files\PostgreSQLin\psql.exe
C:\Program Files\PostgreSQLin\pg_restore.exe
```

`pg_restore` is **not used**. The backup is plain data-only SQL — 115 `INSERT`
statements, no DDL — so it is replayed with `psql -f`. `pg_restore` only reads
the custom/tar/directory formats `pg_dump -F` produces.

Client 17.11 against server 17.6 is the supported direction: same major version,
client slightly newer.

### Procedure

The migration is wrapped in `DO $$ ... END $$` blocks; a failure mid-statement
rolls that block back automatically. If it partially succeeded and must be
reversed:

1. **Stop writes.** Pause the Vercel deployment or take the app to maintenance.

2. **Rebuild the schema to the previous migration.**

   ```bash
   npx prisma migrate reset --force --skip-seed
   ```

   The dump carries no DDL, so the schema must exist before the data lands.

3. **Replay the dump with the real client.** Credentials go through the
   environment so nothing sensitive reaches the process list — never put the
   password in the URL on the command line:

   ```bash
   PGPASSWORD='<password>' PGSSLMODE=require "/c/Program Files/PostgreSQL/17/bin/psql.exe" -h '<pooler-host>' -p 5432 -U 'postgres.<project-ref>' -d postgres -v ON_ERROR_STOP=1 --quiet --no-psqlrc -f 'C:/Users/mauri/Backups/atheos/<file>.sql'
   ```

   `ON_ERROR_STOP=1` is not optional: without it psql reports success after
   skipping failed statements, which is the worst possible outcome for a
   restore. The dump opens its own `BEGIN`/`COMMIT` and sets
   `session_replication_role = replica`, so **do not** add
   `--single-transaction` — it would nest and warn. That setting is per-session
   and does not survive the connection; verified.

4. **Verify** the counts and the ledger invariant from §7 match the
   pre-migration values.

5. **Redeploy** the last known-good commit.

### Rehearsed, with the real tooling — Sprint 5A.2

Executed end to end against an isolated `atheos_restore_test_<hex>` schema on
the separate `atheos-test` project:

| Step                           | Result                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Backup checksum re-verified    | 78,123 bytes, sha256 `0cde658e…9723` — exact match                                              |
| `psql -f` restore              | **exit 0**, 14.5 s, zero stderr                                                                 |
| Restored                       | 21 tables, 115 rows, all per-table counts exact                                                 |
| Balance / ledger drift         | 16,493 / **0**                                                                                  |
| Invalid foreign keys           | 0                                                                                               |
| Apply migration                | enum → `FREE, CREATOR, PRO, STUDIO`; both tables created                                        |
| Rollback (rebuild + `psql -f`) | **exit 0**, 13.7 s; enum back to the five legacy values, both tables gone, all counts identical |
| Re-apply                       | canonical again, counts identical                                                               |

Two differences from the production procedure remain, and neither is a gap in
the tooling proof:

- The rehearsal rebuilt the schema by executing the migration files directly
  rather than through `npx prisma migrate reset`, because `reset` targets a
  whole database and this had to stay inside one schema. The SQL applied is
  byte-identical; the driver differs.
- Isolation is by schema, not by database. Production's rollback recreates
  objects in `public`.

The `psql -f` restore itself — the step that had never been executed — is now
proven with the exact binary, exact flags and the exact verified backup file.

### Stop conditions — do not proceed at all if

- the fresh backup does not verify clean
- `subscriptions` is no longer empty and the mapping has not been re-proved
- anyone is mid-signup, or a Stripe webhook is in flight
- the full path to `psql.exe` does not resolve, or `psql --version` is not 17.x
- `ON_ERROR_STOP=1` is missing from the restore command
- the fresh backup's checksum was not recorded before applying

---

## 9. What has been proved, and what has not

Rehearsed on real managed PostgreSQL (Sprints 5A.1 and 5A.2), inside disposable
schemas on the separate `atheos-test` project:

- the migration applies, and a second apply is a genuine no-op
- every legacy tier maps as documented, on seeded fixtures covering all five
- `scheduledTier` NULLs pass through; the default resets to `FREE`
- both tables and both CHECK constraints are created
- the constraints reject negative balances, negative budget usage, invalid
  enum values, invalid foreign keys and duplicate idempotency keys
- parallel reservation is atomic and balances never go negative — 3 tests that
  had never run before
- the verified backup restores with the real `psql` 17.11 binary, and the full
  migrate → rollback → re-apply cycle round-trips with counts unchanged

Still unproven, honestly:

- **Applying to production itself.** Every rehearsal used a schema whose data
  was restored from the production dump, not production.
- **`prisma migrate deploy` against the production pooler.** The rehearsals
  executed the migration SQL directly; `deploy` also writes
  `_prisma_migrations` and takes its own advisory lock.
- **Behaviour with a non-empty `subscriptions` table.** Production has 0 rows;
  the mapping was proved on fixtures instead. If that count is ever non-zero at
  apply time, stop and re-prove (see §5).
