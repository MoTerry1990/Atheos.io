import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * The single validated entry point for configuration.
 *
 * Nothing in `app/`, `features/`, `services/` or `lib/` may read
 * `process.env` directly. Two reasons, both learned expensively:
 *
 *  1. A missing or malformed variable fails the **build**, loudly, with the
 *     name of the variable. The alternative is `undefined` flowing into an SDK
 *     constructor and surfacing three layers away as an unauthenticated request
 *     at 3am.
 *
 *  2. The server/client split is enforced by the type system. A secret placed
 *     in `server` cannot be imported into a client component — the build breaks
 *     instead of quietly inlining your Stripe key into a JavaScript bundle
 *     shipped to every visitor.
 *
 * Adding a variable means adding it here, to `.env.example`, and to the
 * deployment environment. All three, every time.
 */
export const env = createEnv({
  /**
   * Server-only. Never reaches the browser.
   */
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    // ---- Database -------------------------------------------------------
    // Pooled connection (Supabase transaction pooler, port 6543). Used by the
    // application at runtime through the pg driver adapter.
    DATABASE_URL: z.string().url(),
    // Session connection (port 5432). Used by Prisma Migrate only — see
    // prisma.config.ts for why these cannot be the same string.
    DIRECT_URL: z.string().url(),

    // ---- Identity -------------------------------------------------------
    CLERK_SECRET_KEY: z.string().min(1),
    // Verifies inbound Clerk webhooks. Without it, anyone who learns the
    // endpoint can create users in our database.
    CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1).optional(),

    // ---- Supabase -------------------------------------------------------
    // Bypasses row-level security. Server-side only, always.
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

    // ---- Billing --------------------------------------------------------
    STRIPE_SECRET_KEY: z.string().min(1),
    // Stripe signs every webhook. An unverified billing webhook is a way for
    // a stranger to grant themselves credits.
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

    // ---- Uploads --------------------------------------------------------
    UPLOADTHING_TOKEN: z.string().min(1).optional(),

    // ---- Object storage (Cloudflare R2) ---------------------------------
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET_NAME: z.string().min(1).optional(),
  },

  /**
   * Exposed to the browser. Everything here is public by definition — it ends
   * up in the JavaScript bundle. If a value would be damaging to read in
   * devtools, it does not belong in this block.
   */
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    // Anon key is safe to publish *only* because row-level security is what
    // actually restricts it. Never treat it as a secret, never rely on it alone.
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    // Public base URL the R2 bucket is served from. Kept separate from the
    // bucket name so the CDN in front of storage can change without a data
    // migration — asset rows store keys, never absolute URLs.
    NEXT_PUBLIC_R2_PUBLIC_URL: z.string().url().optional(),
  },

  /**
   * Next.js inlines `NEXT_PUBLIC_*` at build time, so client variables have to
   * be listed explicitly rather than read off `process.env` dynamically.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,

    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,

    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    CLERK_WEBHOOK_SIGNING_SECRET: process.env.CLERK_WEBHOOK_SIGNING_SECRET,

    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,

    UPLOADTHING_TOKEN: process.env.UPLOADTHING_TOKEN,

    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,

    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_R2_PUBLIC_URL: process.env.NEXT_PUBLIC_R2_PUBLIC_URL,
  },

  /**
   * Escape hatch for Docker builds and CI lint jobs, where secrets are
   * legitimately absent. Must never be set in an environment that serves
   * traffic — that would defeat the entire point of this file.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,

  /**
   * `FOO=` in a .env file yields `""`, which passes `z.string()` and then fails
   * far away as an empty API key. Treat it as absent so the schema catches it.
   */
  emptyStringAsUndefined: true,
});
