-- Sprint 4 + 4.1 — financial safety, credit ledger, abuse protection, and the
-- canonical plan tiers.
--
-- Closes B1 (no spending control), B2 (credit race), B7 (ineffective rate
-- limiter) at the schema level, and rebuilds `PlanTier` so its values are the
-- plan names. B5 and B6 are code-only and need nothing here.
--
-- ## Why this is one migration and not two
--
-- The Sprint 4 half of this file was written, committed and **never applied**.
-- Sprint 4.1 amended it in place rather than chaining a second migration on
-- top, because a follow-up that corrects something no database has ever seen
-- leaves a permanent two-step in the history explaining a mistake that never
-- reached anyone. One unapplied migration is easier to review and impossible
-- to half-apply in the wrong order.
--
-- The directory was renamed from `20260814000000_financial_safety` for the
-- same reason. If any environment has already applied the old name — none has,
-- see docs/OPERATIONS.md § 6 — do **not** apply this; resolve it as a rename
-- in `_prisma_migrations` first.
--
-- ## Safe to rerun
--
-- Every statement is guarded (`IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`, a
-- `DO` block around the CHECK). A half-applied migration can be re-run without
-- erroring, which matters because the one destructive-looking statement in here
-- — the balance clamp — is the one most likely to be interrupted.
--
-- ## Applied to production: NOT YET
--
-- Deliberately. See docs/OPERATIONS.md § "Applying the Sprint 4 migration" for
-- the pre-flight checks, in particular the balance survey that must be run
-- before the CHECK constraint is added.

-- ---------------------------------------------------------------------------
-- 1. Credit reasons for the reservation lifecycle
-- ---------------------------------------------------------------------------
--
-- Additive. GENERATION_SPEND and GENERATION_REFUND stay, because the ledger is
-- append-only and historical rows carry them. Nothing is rewritten.
--
-- Each in its own statement: Postgres cannot add several enum values in one
-- ALTER TYPE, and before 12 could not do it inside a transaction at all.

ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'GENERATION_RESERVATION';
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'GENERATION_CAPTURE';
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'GENERATION_RELEASE';

-- ---------------------------------------------------------------------------
-- 2. A balance may never be negative
-- ---------------------------------------------------------------------------
--
-- The backstop behind the conditional UPDATE in services/billing/ledger.ts.
-- The conditional update is the mechanism; this catches the next piece of code
-- that forgets to use it.
--
-- ### The clamp, and why it is written this way
--
-- A CHECK constraint cannot be added while any row violates it. The pre-Sprint-4
-- race could drive a balance negative, so any such row is raised to zero first.
--
-- Zero, not the absolute value and not a reversal: a negative balance is
-- credits that were spent and never paid for, and the generations they bought
-- have already happened. Setting it to zero writes off the overspend, which is
-- the outcome that does not take anything away from a customer.
--
-- Every clamp writes a ledger row, so the adjustment is auditable and the
-- invariant `balance = SUM(amount)` survives. `idempotencyKey` is derived from
-- the user id, so a re-run collides and inserts nothing.
--
-- Expected to affect **zero rows** on this database — no generation has ever
-- run in production. It is written for correctness, not because a problem is
-- known to exist.

INSERT INTO credit_transactions
  ("id", "userId", "amount", "reason", "balanceAfter", "idempotencyKey", "metadata", "createdAt")
SELECT
  'clamp_' || u."id",
  u."id",
  -u."creditBalance",
  'MANUAL_ADJUSTMENT'::"CreditReason",
  0,
  'sprint4-clamp:' || u."id",
  jsonb_build_object(
    'migration', '20260814000000_financial_safety',
    'previousBalance', u."creditBalance",
    'note', 'negative balance written off before the non-negative CHECK was added'
  ),
  now()
FROM users u
WHERE u."creditBalance" < 0
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE users SET "creditBalance" = 0 WHERE "creditBalance" < 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_credit_balance_non_negative'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_credit_balance_non_negative
      CHECK ("creditBalance" >= 0);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Monthly provider spend — the circuit breaker's input
-- ---------------------------------------------------------------------------
--
-- `period` is the primary key, so the month is the identity and an upsert
-- cannot create a second row for the same month under concurrency.
--
-- BIGINT because the unit is micro-USD: $500 is 500,000,000, which fits in an
-- INT, and a year of accumulated history plus a fat-fingered manual entry does
-- not. Money is not the place to be economical with a column type.

CREATE TABLE IF NOT EXISTS budget_usage (
  "period"                 TEXT PRIMARY KEY,
  "spentMicroUsd"          BIGINT      NOT NULL DEFAULT 0,
  "manualBaselineMicroUsd" BIGINT      NOT NULL DEFAULT 0,
  "freeSpentMicroUsd"      BIGINT      NOT NULL DEFAULT 0,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Spend is a total, and a total cannot decrease.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budget_usage_non_negative'
  ) THEN
    ALTER TABLE budget_usage
      ADD CONSTRAINT budget_usage_non_negative
      CHECK ("spentMicroUsd" >= 0
         AND "manualBaselineMicroUsd" >= 0
         AND "freeSpentMicroUsd" >= 0);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Rate-limit windows — B7
-- ---------------------------------------------------------------------------
--
-- Replaces the in-memory Map that Vercel made ineffective: N instances held N
-- independent counters, so the real limit was N x the configured one and it
-- loosened as load created instances.
--
-- One row per caller per policy. The window start is not in the key — the
-- upsert resets `count` and `expiresAt` in place when it finds an expired row,
-- which keeps the table bounded instead of growing a row per window.

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  "key"       TEXT PRIMARY KEY,
  "count"     INTEGER      NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL
);

-- For the sweep in services/worker/runner.ts, which deletes long-expired rows.
CREATE INDEX IF NOT EXISTS "rate_limit_buckets_expiresAt_idx"
  ON rate_limit_buckets ("expiresAt");

-- ---------------------------------------------------------------------------
-- 5. PlanTier — the values become the plan names (Sprint 4.1)
-- ---------------------------------------------------------------------------
--
-- ## What changes
--
--   STARTER -> FREE      $0
--   STUDIO  -> CREATOR   $9.99
--   SCALE   -> PRO       $34.99
--   AGENCY  -> STUDIO    $89.99
--   BASIC   -> dropped   the retired $5 tier, never sold
--
-- ## Why a rebuild rather than ALTER TYPE ... RENAME VALUE
--
-- It is a **rotation**, not a set of independent renames. `STUDIO` has to
-- become `CREATOR` at the same moment `AGENCY` becomes `STUDIO`, and Postgres
-- cannot hold two values named `STUDIO` in between. Renaming through a
-- temporary name would work and would leave the type's internal sort order
-- scrambled, which is visible in `enum_range()` and in any ORDER BY on the
-- column.
--
-- Building a fresh type and converting the column with an explicit `USING`
-- map is deterministic, states every mapping in one place, and fails loudly on
-- a value nobody planned for rather than silently dropping the row.
--
-- ## Safety
--
-- `subscriptions` is expected to hold **zero rows** — Stripe has never been
-- configured, so nothing has ever been sold. The conversion is written to be
-- correct anyway: every old value has an explicit destination, and `BASIC`
-- maps to `FREE` rather than erroring, because a row on a retired $5 tier that
-- somehow exists is closest to a free account and must not block the migration
-- or be silently deleted.
--
-- The `ALTER TABLE ... ALTER COLUMN TYPE` takes an ACCESS EXCLUSIVE lock and
-- rewrites the table. On zero rows that is sub-millisecond. The guard below
-- makes the whole block a no-op once it has run, so the migration is still
-- safe to rerun.

DO $$
BEGIN
  -- Already rebuilt? Then there is nothing to do. Detected by looking for a
  -- value that only exists after the rotation.
  IF EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'PlanTier' AND e.enumlabel = 'CREATOR'
  ) THEN
    RETURN;
  END IF;

  CREATE TYPE "PlanTier_new" AS ENUM ('FREE', 'CREATOR', 'PRO', 'STUDIO');

  -- The default has to go first: Postgres will not convert a column whose
  -- default expression is still typed as the old enum.
  ALTER TABLE subscriptions ALTER COLUMN "planTier" DROP DEFAULT;

  ALTER TABLE subscriptions
    ALTER COLUMN "planTier" TYPE "PlanTier_new"
    USING (
      CASE "planTier"::text
        WHEN 'STARTER' THEN 'FREE'
        WHEN 'BASIC'   THEN 'FREE'     -- retired $5 tier; nearest surviving plan
        WHEN 'STUDIO'  THEN 'CREATOR'
        WHEN 'SCALE'   THEN 'PRO'
        WHEN 'AGENCY'  THEN 'STUDIO'
      END
    )::"PlanTier_new";

  -- `scheduledTier` holds a pending downgrade and is nullable. Same map; NULL
  -- passes through untouched because CASE returns NULL for a NULL input.
  ALTER TABLE subscriptions
    ALTER COLUMN "scheduledTier" TYPE "PlanTier_new"
    USING (
      CASE "scheduledTier"::text
        WHEN 'STARTER' THEN 'FREE'
        WHEN 'BASIC'   THEN 'FREE'
        WHEN 'STUDIO'  THEN 'CREATOR'
        WHEN 'SCALE'   THEN 'PRO'
        WHEN 'AGENCY'  THEN 'STUDIO'
      END
    )::"PlanTier_new";

  DROP TYPE "PlanTier";
  ALTER TYPE "PlanTier_new" RENAME TO "PlanTier";

  ALTER TABLE subscriptions
    ALTER COLUMN "planTier" SET DEFAULT 'FREE'::"PlanTier";
END $$;

-- ---------------------------------------------------------------------------
-- 6. Ledger read paths
-- ---------------------------------------------------------------------------
--
-- `listCapturedFailures()` looks up capture/release rows by idempotency key,
-- which the existing unique index already serves. What has no index is the
-- generation-scoped lookup the release path does, and the per-user history the
-- billing screen renders.

CREATE INDEX IF NOT EXISTS "credit_transactions_generationId_reason_idx"
  ON credit_transactions ("generationId", "reason");

CREATE INDEX IF NOT EXISTS "credit_transactions_userId_createdAt_idx"
  ON credit_transactions ("userId", "createdAt" DESC);
