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
    //
    // Named after the PlanTier value, which since Sprint 4.1 is also the plan's
    // customer-facing name — STUDIO is the $89.99 Studio plan, not the old
    // $35.99 one. Monthly only: annual billing was retired in Sprint 4, so
    // there are no `_YEARLY` variables to set.
    //
    // None of these has ever been set in any environment; Stripe is not
    // configured. Renaming them therefore breaks nothing.
    STRIPE_PRICE_CREATOR_MONTHLY: z.string().min(1).optional(),
    STRIPE_PRICE_PRO_MONTHLY: z.string().min(1).optional(),
    STRIPE_PRICE_STUDIO_MONTHLY: z.string().min(1).optional(),
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
    /**
     * Offer the Veo 3.1 tiers in the studio.
     *
     * Off by default and deliberately not set anywhere yet. The models are
     * callable — the Replicate token already reaches them — but their real
     * invoice rate is unverified, so enabling them would put a price in front of
     * customers that has never been checked against a bill. The flag exists so
     * the adapter can be exercised and benchmarked before that happens.
     */
    ENABLE_VEO_31: z.enum(["0", "1"]).optional(),
    ENABLE_SMART_IMAGE: z.enum(["0", "1"]).optional(),
    /**
     * The interactive Creative Director.
     *
     * Absent means off, and off is enforced on the server rather than by hiding
     * a button: a forged request reaches the same check. It stays off until the
     * planner has been benchmarked, and nothing in the build depends on it — the
     * deterministic planner needs no credentials at all.
     */
    ENABLE_CREATIVE_DIRECTOR: z.enum(["0", "1"]).optional(),
    /**
     * Studio V2, for the owner only.
     *
     * Two conditions, both required: this flag **and** an admin caller. The
     * flag alone would expose an unfinished interface to every signed-in user
     * the moment it is set, and an admin check alone would ship V2 the instant
     * the code merged. Neither is a decision to make by accident.
     *
     * Read at call time rather than from the validated snapshot — a flag is
     * runtime state a deploy flips, and `createEnv` captures `process.env`
     * once at module load.
     */
    ENABLE_STUDIO_V2_OWNER_BETA: z.enum(["0", "1"]).optional(),
    /**
     * Signs creative plan tokens. Server-only, and its own secret.
     *
     * Deliberately not derived from `CLERK_SECRET_KEY` or `STRIPE_SECRET_KEY`,
     * which was the previous approach: reusing an authentication or payment
     * secret to sign a second kind of artefact means rotating either one
     * silently invalidates the other's tokens, and it widens what a single
     * leaked value is good for.
     *
     * Optional while the Director is off so the build and every existing
     * environment keep working untouched. Required the moment it is on — see
     * `creativePlanConfigProblems`.
     */
    CREATIVE_PLAN_SIGNING_SECRET: z.string().min(1).optional(),

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

    // ---- Financial circuit breakers (Sprint 4) --------------------------
    //
    // These live in the environment rather than in the database on purpose.
    // A kill switch whose off position is a database row can be flipped by
    // anything that can write to the database — including, in the worst case,
    // the bug you are trying to stop. The environment is the one surface no
    // request, no browser and no compromised session can reach, and changing
    // it needs a deploy or a dashboard login.
    //
    // All optional. Absent means "not tripped", so the safe default is the one
    // that requires no configuration to be correct.

    // Stops every generation, immediately, for everyone. "1" to arm.
    ATHEOS_KILL_SWITCH: z.enum(["0", "1"]).optional(),

    // Stops Free-plan generations only. Paid users are unaffected. The first
    // lever to pull when spend climbs, because free usage earns nothing.
    ATHEOS_FREE_GENERATION_DISABLED: z.enum(["0", "1"]).optional(),

    // Comma-separated provider ids to refuse, e.g. "replicate,openai".
    ATHEOS_DISABLED_PROVIDERS: z.string().optional(),

    // Comma-separated model ids to refuse, e.g. "replicate/video-pro".
    ATHEOS_DISABLED_MODELS: z.string().optional(),

    // What the provider has actually invoiced this month, in US dollars.
    //
    // Atheos accumulates its own *estimate* of spend as generations run. That
    // estimate is built from four unverified cost figures and is not an
    // invoice, so the breaker reads estimate + this number. Set it from the
    // provider dashboard during reconciliation; see docs/OPERATIONS.md.
    //
    // A string rather than a number because every environment variable is a
    // string, and coercing here keeps the parse failure at boot.
    ATHEOS_MANUAL_SPEND_USD: z.coerce.number().min(0).optional(),

    // ---- Object storage (Cloudflare R2) ---------------------------------
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET_NAME: z.string().min(1).optional(),

    /**
     * A **second, private** R2 bucket, for originals that must never be served.
     *
     * The public bucket above is fronted by `NEXT_PUBLIC_R2_PUBLIC_URL`, so
     * anything in it is reachable by anyone who learns the key. That is right
     * for a customer's finished asset and wrong for a provider master: a 44 MB
     * original with its content credentials intact is evidence, not content,
     * and publishing it is not a thing we ever want to do by accident.
     *
     * Separate credentials rather than the same token widened, so the token
     * that serves the website cannot read or write masters at all. Neither
     * carries `NEXT_PUBLIC_`, and neither may: a private bucket with a public
     * variable name is a private bucket for about one deploy.
     *
     * `R2_ACCOUNT_ID` is shared deliberately — it is already server-only and
     * names the same Cloudflare account, so duplicating it would create two
     * values that must agree and eventually will not.
     */
    R2_PRIVATE_BUCKET_NAME: z.string().min(1).optional(),
    R2_PRIVATE_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_PRIVATE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
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
    STRIPE_PRICE_CREATOR_MONTHLY: process.env.STRIPE_PRICE_CREATOR_MONTHLY,
    STRIPE_PRICE_PRO_MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY,
    STRIPE_PRICE_STUDIO_MONTHLY: process.env.STRIPE_PRICE_STUDIO_MONTHLY,
    STRIPE_PRICE_PACK_1000: process.env.STRIPE_PRICE_PACK_1000,
    STRIPE_PRICE_PACK_5000: process.env.STRIPE_PRICE_PACK_5000,
    STRIPE_PRICE_PACK_20000: process.env.STRIPE_PRICE_PACK_20000,

    WORKER_TRIGGER_SECRET: process.env.WORKER_TRIGGER_SECRET,
    WEBHOOK_SIGNING_SECRET: process.env.WEBHOOK_SIGNING_SECRET,

    ENABLE_DEV_PREVIEWS: process.env.ENABLE_DEV_PREVIEWS,
    ENABLE_VEO_31: process.env.ENABLE_VEO_31,
    ENABLE_SMART_IMAGE: process.env.ENABLE_SMART_IMAGE,
    ENABLE_CREATIVE_DIRECTOR: process.env.ENABLE_CREATIVE_DIRECTOR,
    ENABLE_STUDIO_V2_OWNER_BETA: process.env.ENABLE_STUDIO_V2_OWNER_BETA,
    CREATIVE_PLAN_SIGNING_SECRET: process.env.CREATIVE_PLAN_SIGNING_SECRET,

    ADMIN_USER_IDS: process.env.ADMIN_USER_IDS,
    ATHEOS_KILL_SWITCH: process.env.ATHEOS_KILL_SWITCH,
    ATHEOS_FREE_GENERATION_DISABLED:
      process.env.ATHEOS_FREE_GENERATION_DISABLED,
    ATHEOS_DISABLED_PROVIDERS: process.env.ATHEOS_DISABLED_PROVIDERS,
    ATHEOS_DISABLED_MODELS: process.env.ATHEOS_DISABLED_MODELS,
    ATHEOS_MANUAL_SPEND_USD: process.env.ATHEOS_MANUAL_SPEND_USD,

    REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,

    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,

    R2_PRIVATE_BUCKET_NAME: process.env.R2_PRIVATE_BUCKET_NAME,
    R2_PRIVATE_ACCESS_KEY_ID: process.env.R2_PRIVATE_ACCESS_KEY_ID,
    R2_PRIVATE_SECRET_ACCESS_KEY: process.env.R2_PRIVATE_SECRET_ACCESS_KEY,

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
