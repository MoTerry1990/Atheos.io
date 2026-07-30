// Prisma 7 no longer loads .env automatically. This is the one place in the
// codebase that reads a raw environment variable without going through
// `lib/env.ts` — the CLI runs outside the Next.js build, so the validated
// module is not available to it.
import { config as loadEnv } from "dotenv";

import { defineConfig, env } from "prisma/config";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

/**
 * Prisma CLI configuration — migrations, introspection and seeding only.
 *
 * This is deliberately *not* where the application connects from. The running
 * app builds its client in `lib/prisma.ts` with the pg driver adapter against
 * the pooled `DATABASE_URL`. Migrate needs something the pooler cannot give it:
 * a stable session that can run DDL and hold advisory locks. So it gets
 * `DIRECT_URL` and nothing else does.
 *
 * Running migrations through a transaction pooler is one of those mistakes that
 * works in development and deadlocks in production.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",

  datasource: {
    url: env("DIRECT_URL"),
  },

  migrations: {
    path: "prisma/migrations",
  },
});
