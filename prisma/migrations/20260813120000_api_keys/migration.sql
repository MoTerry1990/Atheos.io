-- Credentials for programs acting on a user's behalf: MCP clients, custom GPT
-- actions, automation platforms.
--
-- `hash` is unique so verification is a single indexed lookup rather than a
-- scan over every key comparing hashes — the difference between O(1) and O(n)
-- on the hot path of every API request.

CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_keys_hash_key" ON "api_keys"("hash");
CREATE INDEX "api_keys_userId_createdAt_idx" ON "api_keys"("userId", "createdAt");

ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
