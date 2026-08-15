# Operations — financial controls

Everything in this file is something you do when money is involved. It is
written to be readable at 2am, so each procedure is a numbered list with the
fastest option first.

**Absolute monthly ceiling: $500. Preferred: $175–$300.**

---

## Contents

1. [Stop everything, right now](#1-stop-everything-right-now)
2. [Stop Free-plan generations](#2-stop-free-plan-generations)
3. [Disable one provider or one model](#3-disable-one-provider-or-one-model)
4. [Update the manual monthly spend figure](#4-update-the-manual-monthly-spend-figure)
5. [Inspect credit transactions safely](#5-inspect-credit-transactions-safely)
6. [Apply the Sprint 4 migration](#6-apply-the-sprint-4-migration)
   - [6.1 Backup](#61-backup)
   - [6.2 Rollback](#62-rollback)
7. [The spending ladder, and what each rung does](#7-the-spending-ladder)
8. [Rate limiting — how it works and when to change it](#8-rate-limiting)
9. [Monthly reconciliation](#9-monthly-reconciliation)

---

## 1. Stop everything, right now

**The global kill switch. Blocks every generation, for everyone, immediately.**

In the Vercel dashboard → Project → Settings → Environment Variables:

```
ATHEOS_KILL_SWITCH = 1
```

Then **redeploy** — Vercel only reads environment variables at build and cold
start, so an unchanged deployment keeps the old value until its instances
recycle. Trigger a redeploy from the Deployments tab (⋯ → Redeploy) rather than
waiting.

Faster still, from a terminal:

```bash
vercel env add ATHEOS_KILL_SWITCH production
```

Enter `1` at the prompt, then:

```bash
vercel --prod
```

### What it does and does not do

- **Does:** refuse every new generation with a 503 and a message saying nothing
  was charged. No credits move.
- **Does not:** cancel generations already submitted to a provider. Those are
  already being billed. Cancel them individually from the admin dashboard, or
  from the Replicate dashboard if it is severe.

### To lift it

Set it to `0` or delete the variable, then redeploy.

**Why the environment and not a database row:** a switch whose off position
lives in the database can be flipped by anything that can write to the
database — including the runaway you are trying to stop. The environment is the
one surface no request can reach.

---

## 2. Stop Free-plan generations

The first lever to pull when spend climbs. Free usage earns nothing, so
stopping it costs no revenue.

```
ATHEOS_FREE_GENERATION_DISABLED = 1
```

Redeploy. Paying customers are unaffected.

This also happens **automatically at $225** of estimated monthly spend — see
the ladder in § 7. Set the variable when you want it sooner than that.

The mock provider stays available even when this is set: stopping it protects
no money and only prevents somebody finding out the product works.

---

## 3. Disable one provider or one model

When a single model is misbehaving — burning GPU time, failing repeatedly, or
newly repriced by the vendor — take it out without stopping anything else.

**One model:**

```
ATHEOS_DISABLED_MODELS = replicate/video-pro
```

**Several** (comma-separated, whitespace is trimmed):

```
ATHEOS_DISABLED_MODELS = replicate/video-pro, openai/gpt-image-1
```

**A whole provider:**

```
ATHEOS_DISABLED_PROVIDERS = replicate
```

Redeploy after either.

### Model ids

| Model                 | Id                       | Modality |
| --------------------- | ------------------------ | -------- |
| FLUX Schnell          | `replicate/flux-schnell` | Image    |
| FLUX Dev              | `replicate/flux-dev`     | Image    |
| Real-ESRGAN (upscale) | `replicate/real-esrgan`  | Image    |
| Background Remover    | `replicate/remove-bg`    | Image    |
| GPT Image 1           | `openai/gpt-image-1`     | Image    |
| Motion 1              | `replicate/video-gen`    | Video    |
| Motion Pro            | `replicate/video-pro`    | Video    |
| Score (music)         | `replicate/music`        | Audio    |
| Foley (SFX)           | `replicate/sfx`          | Audio    |

`google/gemini-2.5-flash-image` is **already disabled in code** because its
provider cost has never been measured. Re-enabling it means measuring the cost
first and setting `enabled: true` in `services/billing/model-costs.ts`.

### The permanent version

For a model that should stay off, set `enabled: false` on its entry in
`services/billing/model-costs.ts` and deploy. That is checked by the test suite
and survives an environment variable being cleaned up later.

---

## 4. Update the manual monthly spend figure

### Why this exists

Atheos accumulates its own **estimate** of provider spend as generations are
captured. That estimate is built from `services/billing/model-costs.ts`, where
four of the figures are inferred from run time rather than read from an
invoice. It is not the provider's bill and it is not claimed to be.

The circuit breaker reads **estimate + manual baseline**, so anything the
estimate misses can be corrected upward without a code change.

### Procedure

1. Open <https://replicate.com/account/billing> and read the **current month's**
   spend.
2. Open the admin dashboard's spending panel and read Atheos's estimate for the
   same month.
3. If Replicate's figure is **higher**, set the difference:

   ```
   ATHEOS_MANUAL_SPEND_USD = 47.20
   ```

4. Redeploy.
5. **Reset it to `0` on the first of each month.** It is a correction to the
   current month only, and leaving last month's figure in place permanently
   inflates the total and will eventually trip the breaker for no reason.

If Replicate's figure is _lower_ than the estimate, leave the variable at `0`.
Never set it negative — the column has a CHECK constraint that refuses one, and
talking the breaker down is the one direction that has no upside.

### Future work

Replicate exposes billing through its API. Synchronising automatically is
Sprint 5 work and is recorded as such in `REVENUE_READINESS_AUDIT.md`. Until
then this is a manual monthly step, and skipping it means the breaker is
working from an undercount.

---

## 5. Inspect credit transactions safely

The ledger is append-only. **Never `UPDATE` or `DELETE` a row in
`credit_transactions`** — a correction is a new row with the opposite sign, so
the history of a balance stays reconstructable.

### One user's history

Supabase → SQL Editor:

```sql
SELECT "createdAt", "amount", "reason", "balanceAfter", "generationId"
  FROM credit_transactions
 WHERE "userId" = 'THE_USER_ID'
 ORDER BY "createdAt" DESC
 LIMIT 100;
```

### Does the balance reconcile?

```sql
SELECT u.id,
       u."creditBalance"                       AS cached,
       COALESCE(SUM(t.amount), 0)              AS ledger,
       u."creditBalance" - COALESCE(SUM(t.amount), 0) AS drift
  FROM users u
  LEFT JOIN credit_transactions t ON t."userId" = u.id
 GROUP BY u.id
HAVING u."creditBalance" <> COALESCE(SUM(t.amount), 0);
```

**Every row returned is a bug.** `creditBalance` is a cached sum of the ledger
and is only ever written in the same transaction as the entry that changed it,
so drift means something wrote it another way.

### Failed generations we were billed for

These are the ones the release path **refused** to refund, because the provider
had already accepted the work:

```sql
SELECT g.id, g."userId", g.model, g."creditsCost", g.error, g."createdAt"
  FROM generations g
 WHERE g.status IN ('FAILED','CANCELED')
   AND EXISTS (SELECT 1 FROM credit_transactions c
                WHERE c."idempotencyKey" = 'capture:' || g.id)
   AND NOT EXISTS (SELECT 1 FROM credit_transactions r
                    WHERE r."idempotencyKey" = 'release:' || g.id)
 ORDER BY g."createdAt" DESC;
```

`listCapturedFailures()` in `services/generation.ts` runs the same query for the
admin dashboard.

**To refund one deliberately**, insert a `MANUAL_ADJUSTMENT` — never edit an
existing row — and update the cached balance in the same transaction:

```sql
BEGIN;
  UPDATE users SET "creditBalance" = "creditBalance" + 90
   WHERE id = 'THE_USER_ID'
  RETURNING "creditBalance";
  -- Use the returned value as balanceAfter below.
  INSERT INTO credit_transactions
    ("id","userId","amount","reason","balanceAfter","generationId","idempotencyKey","metadata","createdAt")
  VALUES (gen_random_uuid()::text,'THE_USER_ID',90,'MANUAL_ADJUSTMENT',
          THE_RETURNED_BALANCE,'THE_GENERATION_ID',
          'manual-refund:THE_GENERATION_ID',
          '{"reason":"goodwill — provider produced unusable output"}'::jsonb,
          now());
COMMIT;
```

The `idempotencyKey` is derived from the generation id, so running this twice
does nothing the second time.

### Never do this

- Do not read or paste secret values into a SQL editor, a ticket or a chat.
- Do not `SELECT *` from `users` into anywhere shared — it carries emails.

---

## 6. Apply the Sprint 4 migration

`prisma/migrations/20260814000000_financial_safety_and_plan_tiers/` —
**created, not applied.**

It carries two things: the financial-safety schema (Sprint 4) and the
`PlanTier` rebuild (Sprint 4.1). They are one migration rather than two because
the first was never applied anywhere, so amending it in place left a clean
history instead of a permanent two-step explaining a mistake nobody saw.

> **The directory was renamed** from `20260814000000_financial_safety`. If any
> environment has already applied the old name, **stop** — resolve it as a
> rename inside `_prisma_migrations` before running anything. None has; this is
> written for the case where that turns out to be wrong.

### Pre-flight

1. **Confirm the subscriptions table is empty.**

   ```sql
   SELECT "planTier"::text, count(*) FROM subscriptions GROUP BY 1;
   ```

   Expected: **zero rows.** Stripe has never been configured, so nothing has
   ever been sold.

   **If rows exist, the migration is still correct** — every legacy value has
   an explicit destination (`STARTER`/`BASIC` → `FREE`, `STUDIO` → `CREATOR`,
   `SCALE` → `PRO`, `AGENCY` → `STUDIO`), and that mapping is covered by
   `tests/db/migration-safety.test.ts`. What changes is that somebody's paid
   entitlement is being rewritten, so read the rows first and confirm each one
   lands where you expect before proceeding.

2. **Survey balances.** The migration adds `CHECK (creditBalance >= 0)` and
   clamps any negative balance to zero first, writing a ledger row for each.

   ```sql
   SELECT count(*), min("creditBalance") FROM users WHERE "creditBalance" < 0;
   ```

   Expected: **0 rows.** A non-zero count means the pre-Sprint-4 race fired.
   Those balances will be written off to zero, so read them first and decide
   whether the users need compensating.

3. **Take a backup.** See § 6.1.

### Apply

```bash
npx dotenv-cli -e .env.local -- npx prisma migrate deploy
```

`migrate deploy` applies pending migrations without prompting and never resets.
It uses `DIRECT_URL` (port 5432) — the transaction pooler cannot run DDL or hold
the advisory locks Migrate needs.

### Locks and downtime

| Statement                                     | Lock                              | Cost at zero rows                               |
| --------------------------------------------- | --------------------------------- | ----------------------------------------------- |
| `ALTER TYPE "CreditReason" ADD VALUE`         | none on tables                    | instant                                         |
| `ALTER TABLE users ADD CONSTRAINT CHECK`      | ACCESS EXCLUSIVE, `users`         | full scan; instant on a small table             |
| `ALTER TABLE subscriptions ALTER COLUMN TYPE` | ACCESS EXCLUSIVE, `subscriptions` | table rewrite; **sub-millisecond on zero rows** |
| `CREATE TABLE`, `CREATE INDEX IF NOT EXISTS`  | new objects only                  | instant                                         |

The enum rebuild is the only statement that rewrites a table. ACCESS EXCLUSIVE
blocks reads as well as writes on `subscriptions` for its duration — which,
with no rows, is not a measurable outage. **If that table ever holds meaningful
volume, this is the statement to reconsider**, not the constraint.

Nothing here touches `generations`, `assets` or `credit_transactions` data. The
two new indexes on `credit_transactions` are built without `CONCURRENTLY`
because Prisma Migrate wraps the file in a transaction, and on a small table a
brief `SHARE` lock is cheaper than the operational complexity of splitting them
out.

### Verify

```sql
SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'PlanTier' ORDER BY e.enumsortorder;
```

Expect `FREE, CREATOR, PRO, STUDIO` — in that order, which is price order.

```sql
SELECT column_default FROM information_schema.columns
 WHERE table_name = 'subscriptions' AND column_name = 'planTier';
```

Expect `'FREE'::"PlanTier"`. The default is dropped before the conversion and
put back after it; a NULL here means the rebuild was interrupted.

```sql
SELECT unnest(enum_range(NULL::"CreditReason"));

SELECT conname FROM pg_constraint
 WHERE conname IN ('users_credit_balance_non_negative','budget_usage_non_negative');

SELECT tablename FROM pg_tables
 WHERE tablename IN ('budget_usage','rate_limit_buckets');
```

### If it fails halfway

Every statement is guarded — `IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`, `DO`
blocks around the constraints, `ON CONFLICT DO NOTHING` on the clamp rows, and
an early `RETURN` in the enum block once `CREATOR` exists. **Run it again**
rather than editing it. `tests/db/migration-safety.test.ts` applies it twice
and asserts the second run changes nothing.

---

## 6.1 Backup

Before applying, in this order.

**1. Supabase snapshot.** Dashboard → Database → Backups. Confirm a snapshot
exists dated today; take a manual one if not. This is the rollback of record.

**2. A logical dump.** Faster to restore than a full snapshot, and on this
database it is the _only_ option — the Supabase plan in use provides no
downloadable manual backup.

The obvious command is:

```bash
pg_dump "$DIRECT_URL" --data-only --column-inserts -t users -t subscriptions -t credit_transactions -f atheos-pre-sprint4.sql
```

**`pg_dump` is not installed on the development machine**, is not in any
standard Windows PostgreSQL location, and no package manager present carries
it. So there is a scripted equivalent that uses the `pg` driver the
application already depends on:

```bash
node scripts/backup-production.mjs
```

It writes `atheos-production-<ISO timestamp>.sql` to `C:/Users/mauri/Backups/atheos`
— **outside the repository**, because a dump inside a git working tree invites
a commit, and this one contains email addresses and prompts. Override the
destination with `ATHEOS_BACKUP_DIR`.

### What the scripted dump does and does not cover

**Data: complete.** Every row of every table in `public`, including
`_prisma_migrations`, as `INSERT` statements. Literals are quoted by Postgres
itself — each value is `quote_nullable(col::text)` inside the query — so
`jsonb`, arrays, enums, timestamps and `bytea` all round-trip. Hand-rolled
JavaScript escaping is where scripts like this normally corrupt data, and it
does not attempt any.

**Schema: not included, and does not need to be.** It is reproducible from
`prisma/migrations`, which is in git. Restore is:

```bash
npx dotenv-cli -e .env.local -- npx prisma migrate deploy
```

then replay the dump. It opens with `SET session_replication_role = replica`,
which suspends foreign-key triggers for the session — the same thing
`pg_dump --disable-triggers` does — so table order does not matter.

**The honest gap:** a real `pg_dump` also captures sequences, functions,
extensions, RLS policies and grants. This project defines none of its own and
Prisma owns the rest, but anything Supabase adds outside the migrations is not
in this file.

### Verify the backup before trusting it

A file on disk is not a backup until something has read it back:

```bash
node scripts/verify-backup.mjs "C:/Users/mauri/Backups/atheos/<filename>.sql"
```

It rebuilds the schema from `prisma/migrations` into a throwaway PostgreSQL
instance, replays the dump, and compares every table's row count against
production — then re-checks that `creditBalance` still equals the sum of the
ledger on the restored copy. It exits non-zero on any mismatch. **Do not apply
a migration on the strength of an unverified dump.**

**3. Record the current migration state**, so a rollback knows where to return
to:

```sql
SELECT migration_name, finished_at FROM _prisma_migrations
 ORDER BY finished_at DESC LIMIT 5;
```

---

## 6.2 Rollback

**Nothing in this migration destroys data**, so a rollback is subtractive
rather than a restore. Take these in order and stop at the first one that gets
you working again.

**1. The CHECK constraint** — the only change that can reject a write which
previously succeeded:

```sql
ALTER TABLE users DROP CONSTRAINT users_credit_balance_non_negative;
```

**2. The new tables.** Dropping them disarms the spending breaker and the rate
limiter, which then fail safe — `emergency` and `failMode: "closed"`
respectively. That is a hard stop on generation, so redeploy the previous build
at the same time:

```sql
DROP TABLE IF EXISTS budget_usage;
DROP TABLE IF EXISTS rate_limit_buckets;
```

**3. The enum rotation.** Reverse it with the same rebuild technique. The map is
not injective — `FREE` came from both `STARTER` and `BASIC` — so this returns
every free account to `STARTER`, which is where all of them were:

```sql
BEGIN;
  CREATE TYPE "PlanTier_old" AS ENUM ('STARTER','BASIC','STUDIO','SCALE','AGENCY');
  ALTER TABLE subscriptions ALTER COLUMN "planTier" DROP DEFAULT;
  ALTER TABLE subscriptions ALTER COLUMN "planTier" TYPE "PlanTier_old"
    USING (CASE "planTier"::text
             WHEN 'FREE'    THEN 'STARTER'
             WHEN 'CREATOR' THEN 'STUDIO'
             WHEN 'PRO'     THEN 'SCALE'
             WHEN 'STUDIO'  THEN 'AGENCY'
           END)::"PlanTier_old";
  ALTER TABLE subscriptions ALTER COLUMN "scheduledTier" TYPE "PlanTier_old"
    USING (CASE "scheduledTier"::text
             WHEN 'FREE'    THEN 'STARTER'
             WHEN 'CREATOR' THEN 'STUDIO'
             WHEN 'PRO'     THEN 'SCALE'
             WHEN 'STUDIO'  THEN 'AGENCY'
           END)::"PlanTier_old";
  DROP TYPE "PlanTier";
  ALTER TYPE "PlanTier_old" RENAME TO "PlanTier";
  ALTER TABLE subscriptions ALTER COLUMN "planTier" SET DEFAULT 'STARTER'::"PlanTier";
COMMIT;
```

**4. The credit reasons — leave them.** Postgres cannot drop an enum value, and
three unused labels cost nothing. Removing them would mean rebuilding
`CreditReason`, which rewrites the entire ledger.

**5. `_prisma_migrations`.** Delete the row so a later `migrate deploy`
re-applies cleanly:

```sql
DELETE FROM _prisma_migrations
 WHERE migration_name = '20260814000000_financial_safety_and_plan_tiers';
```

**6. If all of that is worse than the problem**, restore the § 6.1 snapshot and
redeploy the previous build.

---

## 7. The spending ladder

Read from `budget_usage.spentMicroUsd + budget_usage.manualBaselineMicroUsd +
ATHEOS_MANUAL_SPEND_USD`, evaluated on every generation.

| Monthly spend | Level                  | What stops                                       |
| ------------: | ---------------------- | ------------------------------------------------ |
|          $100 | `review`               | Nothing. Logged, so the crossing is visible      |
|          $175 | `alert`                | Nothing. Top of the preferred range              |
|          $225 | `free_stopped`         | Free-plan generations on paid providers          |
|          $275 | `expensive_restricted` | Video, for everyone                              |
|          $350 | `nonessential_paused`  | Upscaling and background removal                 |
|          $425 | `economical_only`      | Video and all free usage; cheap images still run |
|          $475 | `emergency`            | **Everything**                                   |
|          $500 | ceiling                | Must never be reached. $475 exists so it is not  |

Paying customers keep working until $425. That ordering is deliberate: a
subscriber whose generations stop has been sold something undelivered, while a
free user who is throttled has lost nothing they paid for.

**If the spend figure cannot be read at all, the level is `emergency`.** A
breaker that cannot see its input assumes the worst. If generation stops
unexpectedly and no threshold has been crossed, check the database connection
first — `spend.blocked` with `cause: budget_usage_unreadable` will be in the
logs.

### Watching it

Structured events on stdout, one JSON line each:

```
{"evt":"spend.threshold","level":"alert","period":"2026-08"}
{"evt":"spend.blocked","modelId":"replicate/video-pro","level":"expensive_restricted"}
{"evt":"spend.emergency_stop","period":"2026-08","degraded":false}
```

`spend.blocked`, `spend.emergency_stop` and `limit.store_unavailable` go to
**stderr**, so a Vercel log drain can alert on stderr alone without matching
strings.

Every payload passes through `scrub()` in `lib/events.ts`: keys containing
`token`, `secret`, `password`, `authorization`, `cookie`, `apikey`,
`credential`, `signature` or `prompt` are replaced with `[redacted]`, and every
string is truncated at 200 characters.

---

## 8. Rate limiting

### Where the counters live

Postgres, in `rate_limit_buckets`. One row per caller per policy, incremented
by a single atomic upsert.

Before Sprint 4 they lived in a `Map` in the lambda's heap, which on Vercel is
not a weak limiter but **not a limiter**: every instance held its own count, so
the effective limit was `configured × instances`, and it loosened exactly when
load made it matter.

### Why not Redis

It is the textbook answer and it is a second paid dependency on the budget this
whole system defends. Postgres is already provisioned and one upsert per request
is well inside Supabase's capacity at this scale.

**When to switch:** if the limiter round trip shows up in p95 latency, or if
`rate_limit_buckets` write volume becomes a meaningful share of database load.
The upgrade is Upstash Redis (~$0–10/month at this size) as one new
`RateLimitStore` implementation in `lib/rate-limit.ts` — no call site changes.

### Limits per plan

| Plan    | At once | Per minute | Per hour |
| ------- | ------: | ---------: | -------: |
| Free    |       1 |          3 |       10 |
| Creator |       3 |         12 |       60 |
| Pro     |       5 |         20 |      200 |
| Studio  |       8 |         40 |      500 |

Concurrency is the free tier's real defence. A rate limit of twelve a minute
permits twelve _at once_; a concurrency cap of one turns a burst into a queue.

### When the store is unreachable

Per policy, not globally:

- **`failMode: "closed"`** — generation, enhancement, billing, sign-up, and
  anything else that can reach a provider or a payment processor. These refuse,
  with a 5-second `Retry-After`.
- **`failMode: "open"`** (the default) — reads. These fall back to per-instance
  counting, which is the old inadequate behaviour used as an emergency floor.

Either way `limit.store_unavailable` is written to stderr.

### Sweeping

The daily worker deletes windows that expired more than an hour ago
(`sweepRateLimitBuckets()`). If the worker is not running, the table grows by
roughly one row per active caller per policy and is harmless — but the worker
not running is itself blocker B3.

---

## 9. Monthly reconciliation

On the **first of the month**, in order:

1. Reset `ATHEOS_MANUAL_SPEND_USD` to `0`, redeploy.
2. Read last month's Replicate invoice.
3. Compare it against `budget_usage` for that period:

   ```sql
   SELECT period,
          ("spentMicroUsd" + "manualBaselineMicroUsd") / 1000000.0 AS estimated_usd,
          "freeSpentMicroUsd" / 1000000.0                         AS free_usd
     FROM budget_usage
    ORDER BY period DESC LIMIT 3;
   ```

4. If the estimate was low, work out which models were underpriced and update
   `services/billing/model-costs.ts`. Change `verification` to `verified` and
   put the invoice date in `checked` for anything you have now confirmed.
5. Re-run the suite. `tests/unit/model-costs.test.ts` fails if a corrected cost
   pushes a model under its margin floor — which is the signal to raise its
   credit price, not to lower the floor.

`free_usd` is the number that decides whether the free tier is sustainable. If
it is a large share of the total while conversions are flat, the signup grant is
too generous — it is a single constant, `SIGNUP_GRANT` in
`services/billing/catalogue.ts`.
