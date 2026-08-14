-- Sequences: one user-facing video assembled from many generated clips.
--
-- Scenes point at `generations` rather than duplicating them, so a clip keeps
-- the credits, retries, refunds and R2 storage that already work. The sequence
-- is a container and an ordering, not a second pipeline.

CREATE TYPE "SequenceStatus" AS ENUM ('DRAFT', 'GENERATING', 'STITCHING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "sequences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "status" "SequenceStatus" NOT NULL DEFAULT 'DRAFT',
    "targetSeconds" INTEGER NOT NULL,
    "seed" INTEGER,
    "creditsCost" INTEGER NOT NULL DEFAULT 0,
    "outputAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scenes" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "generationId" TEXT,

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sequences_userId_createdAt_idx" ON "sequences"("userId", "createdAt");
CREATE INDEX "sequences_status_idx" ON "sequences"("status");

-- One generation belongs to at most one scene: a clip is not shared between
-- sequences, and reusing one would make a refund ambiguous.
CREATE UNIQUE INDEX "scenes_generationId_key" ON "scenes"("generationId");
CREATE INDEX "scenes_sequenceId_idx" ON "scenes"("sequenceId");
-- Two scenes cannot occupy the same position in the cut.
CREATE UNIQUE INDEX "scenes_sequenceId_index_key" ON "scenes"("sequenceId", "index");

ALTER TABLE "sequences" ADD CONSTRAINT "sequences_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL, not CASCADE: deleting the stitched asset must not delete the
-- sequence and with it the record of what was charged for.
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_outputAssetId_fkey"
    FOREIGN KEY ("outputAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scenes" ADD CONSTRAINT "scenes_sequenceId_fkey"
    FOREIGN KEY ("sequenceId") REFERENCES "sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_generationId_fkey"
    FOREIGN KEY ("generationId") REFERENCES "generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
