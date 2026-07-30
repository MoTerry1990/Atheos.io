import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * The database client.
 *
 * Prisma 7 connects through a driver adapter rather than a bundled query
 * engine, so the connection string lives here rather than in the schema. This
 * is the **pooled** URL — Supabase's transaction pooler. Migrations use a
 * different, direct connection; see `prisma.config.ts`.
 *
 * The global cache exists because Next.js re-evaluates modules on every hot
 * reload in development. Without it, a few minutes of editing opens hundreds of
 * connections and Postgres starts refusing them. In production the module is
 * evaluated once and the branch is inert.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    // Queries are noisy and occasionally contain user prompts; log them only
    // when explicitly developing against the database.
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@/lib/generated/prisma/enums";
export type * from "@/lib/generated/prisma/models";
