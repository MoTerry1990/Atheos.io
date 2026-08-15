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

`prisma/migrations/20260814000000_financial_safety/` — **created, not applied.**

### Pre-flight

1. **Confirm no subscription rows exist.** Sprint 4 reuses the `AGENCY` enum
   value for the $89.99 Studio tier, which is only safe if nothing has ever
   been sold on it.

   ```sql
   SELECT "planTier", count(*) FROM subscriptions GROUP BY "planTier";
   ```

   Expected: **zero rows.** If any exist, stop, and add a new enum value
   instead of reusing one — see the note in `services/billing/plan-config.ts`.

2. **Survey balances.** The migration adds `CHECK (creditBalance >= 0)` and
   clamps any negative balance to zero first, writing a ledger row for each.

   ```sql
   SELECT count(*), min("creditBalance") FROM users WHERE "creditBalance" < 0;
   ```

   Expected: **0 rows.** No generation has run in production, so no balance
   should ever have gone negative. A non-zero count means the pre-Sprint-4 race
   fired and each row will be written off to zero — read them first and decide
   whether the users need compensating.

3. **Take a backup.** Supabase → Database → Backups → the daily snapshot is
   enough; confirm one exists from today.

### Apply

```bash
npx dotenv-cli -e .env.local -- npx prisma migrate deploy
```

`migrate deploy` applies pending migrations without prompting and never resets.
It uses `DIRECT_URL` (port 5432) — the transaction pooler cannot run DDL or hold
the advisory locks Migrate needs.

### Verify

```sql
-- Enum values
SELECT unnest(enum_range(NULL::"CreditReason"));
-- Expect GENERATION_RESERVATION, GENERATION_CAPTURE, GENERATION_RELEASE
-- alongside the originals.

-- Constraint
SELECT conname FROM pg_constraint
 WHERE conname IN ('users_credit_balance_non_negative','budget_usage_non_negative');
-- Expect both.

-- Tables
SELECT tablename FROM pg_tables
 WHERE tablename IN ('budget_usage','rate_limit_buckets');
-- Expect both.
```

### If it fails halfway

Every statement is guarded (`IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`, `DO`
blocks around the constraints, `ON CONFLICT DO NOTHING` on the clamp rows), so
re-running it is safe. Run it again rather than editing it.

### Rolling back

There is no down migration. Adding enum values, tables and a CHECK constraint
is additive, and the only way any of it breaks existing behaviour is the
constraint — which can be dropped on its own without touching data:

```sql
ALTER TABLE users DROP CONSTRAINT users_credit_balance_non_negative;
```

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
