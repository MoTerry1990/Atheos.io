-- Worker queue (Sprint 20)
--
-- Moves job ownership from the browser to a server-side worker. Until now the
-- client was the runner: a closed tab stopped a generation advancing until
-- someone reopened the studio.
--
-- Additive except for the enum, which only gains a value. Safe on a populated
-- table: every new column is nullable or defaulted, and no existing row's
-- meaning changes.

-- AlterEnum
--
-- RETRYING is distinct from QUEUED deliberately. A job waiting for its first
-- run and a job waiting out a backoff look identical in a status column and are
-- not the same thing — merging them hides a rising retry rate, which is the
-- earliest signal of a provider outage.
--
-- Placed after RUNNING so the enum's declaration order still reads as a
-- lifecycle. Postgres allows this without a table rewrite.
ALTER TYPE "GenerationStatus" ADD VALUE IF NOT EXISTS 'RETRYING' AFTER 'RUNNING';

-- AlterTable
ALTER TABLE "generations"
  ADD COLUMN "progress" INTEGER,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedBy" TEXT,
  ADD COLUMN "webhookUrl" TEXT,
  ADD COLUMN "webhookDelivered" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "webhookAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "webhookLastError" TEXT;

-- CreateTable
CREATE TABLE "generation_logs" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The worker's claim query. Without this every tick scans the whole table to
-- find a handful of runnable jobs, and the scan gets slower as history grows.
CREATE INDEX "generations_status_nextAttemptAt_idx" ON "generations"("status", "nextAttemptAt");

-- CreateIndex
-- Reclaiming jobs from workers that died mid-run.
CREATE INDEX "generations_status_lockedAt_idx" ON "generations"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "generation_logs_generationId_createdAt_idx" ON "generation_logs"("generationId", "createdAt");

-- AddForeignKey
-- Cascade: a deleted generation's log lines are meaningless on their own, and
-- leaving them would be orphaned personal data (prompts appear in log context).
ALTER TABLE "generation_logs"
  ADD CONSTRAINT "generation_logs_generationId_fkey"
  FOREIGN KEY ("generationId") REFERENCES "generations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
