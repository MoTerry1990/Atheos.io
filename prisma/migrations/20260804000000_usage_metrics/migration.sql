-- Units of work (Sprint 21)
--
-- `costMicroUsd` records what a generation cost. A single money column cannot
-- answer "why did last month cost more" — the answer is always one of these
-- moving, and without them a cost report can attribute spend to a provider name
-- and nothing else.
--
-- Every column is nullable with no default, deliberately. A video job has no
-- image count; defaulting it to 0 makes "zero images" and "not an image job"
-- indistinguishable inside a SUM, which is exactly the kind of quiet wrongness
-- a billing report must not have.

-- AlterTable
ALTER TABLE "generations"
  ADD COLUMN "gpuTimeMs" INTEGER,
  ADD COLUMN "imageCount" INTEGER,
  ADD COLUMN "videoSeconds" INTEGER,
  ADD COLUMN "audioSeconds" INTEGER;

-- CreateIndex
-- Per-user usage reporting over a period. The existing (userId, createdAt)
-- index serves history; this one adds status so a report can exclude failed
-- jobs without a filter step, which is most of the rows in a bad week.
CREATE INDEX "generations_userId_status_createdAt_idx"
  ON "generations"("userId", "status", "createdAt");
