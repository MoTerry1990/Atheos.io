-- CreateTable
CREATE TABLE "connector_quote" (
    "jtiHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "publicModelId" TEXT NOT NULL,
    "quotedCredits" INTEGER NOT NULL,
    "capabilityVersion" INTEGER NOT NULL,
    "compilerVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "connector_quote_pkey" PRIMARY KEY ("jtiHash")
);

-- CreateTable
CREATE TABLE "connector_idempotency" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_idempotency_pkey" PRIMARY KEY ("userId","key")
);

-- CreateIndex
CREATE INDEX "connector_quote_userId_createdAt_idx" ON "connector_quote"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "connector_quote_expiresAt_idx" ON "connector_quote"("expiresAt");

-- CreateIndex
CREATE INDEX "connector_idempotency_expiresAt_idx" ON "connector_idempotency"("expiresAt");

-- AddForeignKey
ALTER TABLE "connector_quote" ADD CONSTRAINT "connector_quote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_idempotency" ADD CONSTRAINT "connector_idempotency_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_idempotency" ADD CONSTRAINT "connector_idempotency_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

