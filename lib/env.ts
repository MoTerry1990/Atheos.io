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
    //
    // There are none. Supabase is our **Postgres host and nothing else** — it
    // is reached exclusively through DATABASE_URL and DIRECT_URL above.
    //
    // The JS client was installed in Sprint 0 for "Supabase as a platform" and
    // never imported once, because § 2 had already closed that door: Clerk owns
    // sessions, so row-level security cannot see who is asking, and the anon
    // key plus RLS is not a usable authorisation path here. All data access
    // goes through Prisma with authorisation in the service layer.
    //
    // `SUPABASE_SERVICE_ROLE_KEY` was the one worth deleting rather than merely
    // ignoring: a key that bypasses RLS entirely, sitting in the deployment
    // surface, protecting nothing and used by nobody. Removed in Sprint 14
    // along with @supabase/ssr and @supabase/supabase-js. See § 46.

    // ---- Billing --------------------------------------------------------
    STRIPE_SECRET_KEY: z.string().min(1),
    // Stripe signs every webhook. An unverified billing webhook is a way for
    // a stranger to grant themselves credits.
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    // Price ids are created in the Stripe dashboard and differ per account and
    // between test and live mode, so they cannot be committed. Optional
    // because the app must build and run without billing configured; a plan
    // whose id is missing is not offered, and asking for it fails with a
    // message naming the variable. See services/billing/plans.ts.
    STRIPE_PRICE_STUDIO_MONTHLY: z.string().min(1).optional(),
    STRIPE_PRICE_STUDIO_YEARLY: z.string().min(1).optional(),
    STRIPE_PRICE_SCALE_MONTHLY: z.string().min(1).optional(),
    STRIPE_PRICE_SCALE_YEARLY: z.string().min(1).optional(),
    STRIPE_PRICE_PACK_350: z.string().min(1).optional(),
    STRIPE_PRICE_PACK_1000: z.string().min(1).optional(),
    STRIPE_PRICE_PACK_5000: z.string().min(1).optional(),
    STRIPE_PRICE_PACK_20000: z.string().min(1).optional(),

    // ---- Background worker ----------------------------------------------
    //
    // Shared secret between whatever triggers the worker (a cron, a scheduler)
    // and the tick endpoint. Without it the endpoint refuses to run: an
    // unauthenticated worker trigger is a free way for a stranger to make us
    // do work, and the work in question costs money.
    WORKER_TRIGGER_SECRET: z.string().min(16).optional(),

    // Signs outbound webhook callbacks. Without it we refuse to deliver rather
    // than sending unsigned — an unsigned callback is one a receiver cannot
    // trust, and sending it teaches them to accept unsigned ones.
    WEBHOOK_SIGNING_SECRET: z.string().min(16).optional(),

    // ---- Internal preview routes ----------------------------------------
    //
    // `"1"` serves the `(dev)` route group in a production build. Off by
    // default, so production 404s all eight preview routes — `/admin-preview`
    // renders the admin interface with the gate bypassed, and `noindex` is a
    // request to a crawler rather than an access control.
    //
    // Set it on preview deployments and in the Playwright run, which asserts
    // against every one of these routes. Never set it on the production
    // deployment.
    ENABLE_DEV_PREVIEWS: z.enum(["0", "1"]).optional(),

    // ---- Administration -------------------------------------------------
    // Comma-separated Clerk user ids with admin access.
    //
    // The **root of trust** for the admin dashboard. `User.role` also grants
    // access, but this list is checked independently — so a database
    // compromise alone cannot escalate, and access is recoverable if the
    // column is ever wrong. Changing it needs a deploy, which is the point.
    ADMIN_USER_IDS: z.string().optional(),

    // ---- AI providers ---------------------------------------------------
    // Presence is what enables a provider — see services/ai/registry.ts.
    // With none of these set, the registry falls back to an explicitly
    // labelled mock so the pipeline can still be exercised.
    REPLICATE_API_TOKEN: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    // Sprint 19. Optional like every other provider key: presence is what
    // enables a provider, and the app must build and run with none of them.
    GOOGLE_AI_API_KEY: z.string().min(1).optional(),

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

    // Public base URL the R2 bucket is served from. Kept separate from the
    // bucket name so the CDN in front of storage can change without a data
    // migration — asset rows store keys, never absolute URLs.
    NEXT_PUBLIC_R2_PUBLIC_URL: z.string().url().optional(),

    // Removed in Sprint 14, recorded so nobody re-adds them by reflex:
    //
    //   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY  only ever existed to initialise
    //     @stripe/stripe-js. Checkout does not use it — `createCheckoutSession`
    //     returns Stripe's hosted `session.url` and the browser navigates
    //     there. Reinstate it if Stripe Elements is ever used for an in-page
    //     card form.
    //
    //   NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY  see the Supabase note above.
    //
    // A variable nothing reads makes a deployment checklist longer and less
    // trustworthy. Every entry on it should be load-bearing.
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

    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_STUDIO_MONTHLY: process.env.STRIPE_PRICE_STUDIO_MONTHLY,
    STRIPE_PRICE_STUDIO_YEARLY: process.env.STRIPE_PRICE_STUDIO_YEARLY,
    STRIPE_PRICE_SCALE_MONTHLY: process.env.STRIPE_PRICE_SCALE_MONTHLY,
    STRIPE_PRICE_SCALE_YEARLY: process.env.STRIPE_PRICE_SCALE_YEARLY,
    STRIPE_PRICE_PACK_350: process.env.STRIPE_PRICE_PACK_350,
    STRIPE_PRICE_PACK_1000: process.env.STRIPE_PRICE_PACK_1000,
    STRIPE_PRICE_PACK_5000: process.env.STRIPE_PRICE_PACK_5000,
    STRIPE_PRICE_PACK_20000: process.env.STRIPE_PRICE_PACK_20000,

    WORKER_TRIGGER_SECRET: process.env.WORKER_TRIGGER_SECRET,
    WEBHOOK_SIGNING_SECRET: process.env.WEBHOOK_SIGNING_SECRET,

    ENABLE_DEV_PREVIEWS: process.env.ENABLE_DEV_PREVIEWS,

    ADMIN_USER_IDS: process.env.ADMIN_USER_IDS,

    REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,

    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,

    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
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
