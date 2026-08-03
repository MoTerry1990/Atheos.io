-- Generation telemetry (Sprint 19)
--
-- Adds what a generation cost us and how it behaved. `creditsCost` already
-- records what the *user* was charged; none of this was recorded before, which
-- is why unit economics were unmeasurable and "why was that slow" had no
-- answer.
--
-- Every column is nullable with no default. That is deliberate: for cost and
-- tokens, NULL means "not recorded", and defaulting to 0 would make an unpriced
-- model indistinguishable from a free one in a margin report.
--
-- Additive only. No column is dropped or retyped, so this is safe to apply to a
-- populated table and safe to roll back by ignoring.

-- AlterTable
ALTER TABLE "generations"
  ADD COLUMN "costMicroUsd" INTEGER,
  ADD COLUMN "latencyMs" INTEGER,
  ADD COLUMN "promptTokens" INTEGER,
  ADD COLUMN "completionTokens" INTEGER,
  ADD COLUMN "requestedProvider" TEXT,
  ADD COLUMN "attempts" JSONB;

-- CreateIndex
-- Cost reporting scans by provider over a time window. Without this the margin
-- query is a sequential scan over every generation ever made.
CREATE INDEX "generations_provider_createdAt_idx" ON "generations"("provider", "createdAt");
