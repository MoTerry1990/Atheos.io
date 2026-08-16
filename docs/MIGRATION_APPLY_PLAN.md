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

### Procedure

The migration is wrapped in `DO $$ ... END $$` blocks; a failure mid-statement
rolls that block back automatically. If it partially succeeded and must be
reversed:

1. **Stop writes.** Pause the Vercel deployment or take the app to maintenance.
2. **Restore from the backup taken in §4:**
   ```bash
   npx prisma migrate reset --force --skip-seed
   ```
   then replay the dump:
   ```bash
   psql "$DIRECT_URL" -f "C:/Users/mauri/Backups/atheos/<file>.sql"
   ```
   The dump sets `session_replication_role = replica`, so foreign-key ordering
   is not a problem. It is data-only — the schema comes from
   `prisma migrate deploy` up to the _previous_ migration first.
3. **Verify** the four counts and the ledger invariant from §7 match the
   pre-migration values.
4. **Redeploy** the last known-good commit.

`psql` is **not currently installed on this machine.** Install PostgreSQL client
tools _before_ applying, or the rollback path is theoretical. This is a
precondition, not a footnote.

### Stop conditions — do not proceed at all if

- the fresh backup does not verify clean
- `subscriptions` is no longer empty and the mapping has not been re-proved
- `TEST_DATABASE_URL` rehearsal (Sprint 5A §5–7) has still not been performed
- anyone is mid-signup, or a Stripe webhook is in flight
- `psql` is unavailable, leaving no rollback path

---

## 9. What has _not_ been proved

Sprint 5A could not run the rehearsal: `TEST_DATABASE_URL` is unset, and this
plan is written from a **read-only preflight plus static reading of the SQL**, not
from an observed apply.

What that leaves unverified:

- the migration actually completing on a real server
- the second run being a true no-op in practice
- the constraints rejecting negative values in practice
- rollback working end to end
- the parallel-reservation concurrency tests (3 skipped)

The empty `subscriptions` table means the _data_ risk is near zero. The
_mechanical_ risk — a statement erroring halfway — is unproven and is the reason
to rehearse first.
