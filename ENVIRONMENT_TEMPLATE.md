# Environment Template — Sprint 25

**Scope:** Phase 4. Every environment variable the application reads.
**Source of truth:** `lib/env.ts`. Nothing in `app/`, `features/`, `services/`
or `lib/` may read `process.env` directly, so this list is complete by
construction — a variable that is not here is not read.

**Example values below are truncated on purpose.** They show only the vendor's
prefix, never a full-length key shape.

> **Do not "complete" them.** A first draft of this file used full-length
> placeholders like `sk_test_` followed by 24 filler characters. GitHub's push
> protection matched that against Stripe's real key format and **rejected the
> entire push** — a scanner cannot tell an invented placeholder from a live
> credential, and it is right not to try. Keep the prefixes short.

No real secret appears in this file.

---

## Required — the build fails without these

Six. Verified by removing `.env.local` and running `npm run build`, which
stopped at `lib/env.ts:13` naming each missing variable.

| Variable                            | Purpose                                                                                                                                        | Required | Example                                                                                               | Set in         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- | -------------- |
| `DATABASE_URL`                      | Runtime Postgres connection. Supabase **transaction pooler**, port 6543 — serverless opens and discards connections. Must parse as a URL.      | ✅       | `postgresql://postgres.abcd:PASS@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true` | Vercel · local |
| `DIRECT_URL`                        | Migrations only. Supabase **session** connection, port 5432 — the pooler cannot run DDL or hold Migrate's advisory locks. Must parse as a URL. | ✅       | `postgresql://postgres.abcd:PASS@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`                | Vercel · local |
| `CLERK_SECRET_KEY`                  | Server-side Clerk API calls and session verification.                                                                                          | ✅       | `sk_test_… (Stripe/Clerk dashboard)`                                                                  | Vercel · local |
| `STRIPE_SECRET_KEY`                 | Server-side Stripe API. Test mode is fine for a first deploy.                                                                                  | ✅       | `sk_test_… (Stripe/Clerk dashboard)`                                                                  | Vercel · local |
| `NEXT_PUBLIC_APP_URL`               | Canonical origin. Used for absolute URLs in metadata, OG images, sitemap and Stripe return URLs. Must parse as a URL.                          | ✅       | `https://atheos-io.vercel.app`                                                                        | Vercel · local |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk browser SDK. Public by definition — it ships in the bundle.                                                                              | ✅       | `pk_test_… (Clerk dashboard)`                                                                         | Vercel · local |

> **`DATABASE_URL` and `DIRECT_URL` must differ.** Setting them to the same
> string is the most common Supabase + Prisma mistake: the app appears to work
> and `prisma migrate deploy` fails, or worse, migrates through a pooler that
> silently drops the advisory lock.

---

## Strongly recommended — the app builds and runs without these, but degrades

| Variable                       | Purpose                                                                                                                                                                                                                                 | Required | Example                                       | Set in |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------- | ------ |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Verifies inbound Clerk webhooks. **Without it a sign-up creates no user row** — the app appears to work and no one exists in the database. The receiver returns 503 naming this variable rather than failing open.                      | ⚠️       | `whsec_… (shown when you create the webhook)` | Vercel |
| `STRIPE_WEBHOOK_SECRET`        | Verifies inbound Stripe webhooks. Without it, no subscription or credit grant is ever processed. An unverified billing webhook is a way for a stranger to grant themselves credits.                                                     | ⚠️       | `whsec_… (shown when you create the webhook)` | Vercel |
| `WORKER_TRIGGER_SECRET`        | Shared secret for `/api/worker/tick`. **Without it the endpoint refuses to run** and returns 404, so no queued job is ever processed. Minimum 16 characters.                                                                            | ⚠️       | `openssl rand -hex 32`                        | Vercel |
| `CRON_SECRET`                  | **Vercel platform variable**, not in `lib/env.ts`. Vercel Cron signs its request with `Authorization: Bearer $CRON_SECRET`; the route checks it against `WORKER_TRIGGER_SECRET`. **Set both to the same value.**                        | ⚠️       | same value as `WORKER_TRIGGER_SECRET`         | Vercel |
| `WEBHOOK_SIGNING_SECRET`       | Signs outbound webhook callbacks. Without it the worker refuses to deliver rather than sending unsigned — an unsigned callback is one a receiver cannot trust. Minimum 16 characters.                                                   | ⚠️       | `openssl rand -hex 32`                        | Vercel |
| `ADMIN_USER_IDS`               | Comma-separated Clerk user ids with admin access. The **root of trust** for the admin dashboard — checked independently of `User.role`, so a database compromise alone cannot escalate. Changing it needs a deploy, which is the point. | ⚠️       | `user_2abc...,user_2def...`                   | Vercel |

---

## Storage — required for generation to produce anything durable

All four are optional to the schema; the feature does not work without all four.

| Variable                    | Purpose                                                                                                                                                                                                               | Required | Example                    | Set in |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------- | ------ |
| `R2_ACCOUNT_ID`             | Cloudflare account id.                                                                                                                                                                                                | ○        | `a1b2c3d4e5f6...`          | Vercel |
| `R2_ACCESS_KEY_ID`          | R2 S3-compatible access key.                                                                                                                                                                                          | ○        | `xxxxxxxxxxxxxxxx`         | Vercel |
| `R2_SECRET_ACCESS_KEY`      | R2 S3-compatible secret.                                                                                                                                                                                              | ○        | `xxxxxxxxxxxxxxxxxxxxxxxx` | Vercel |
| `R2_BUCKET_NAME`            | Bucket to write generated assets to.                                                                                                                                                                                  | ○        | `atheos-assets`            | Vercel |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | Public base URL assets are served from. Kept separate from the bucket name so a CDN can change without a data migration — asset rows store keys, never absolute URLs. Also feeds `images.remotePatterns` and the CSP. | ○        | `https://cdn.atheos.io`    | Vercel |

---

## AI providers — presence is what enables a provider

With none set, the registry falls back to an **explicitly labelled mock**. It
does not silently pretend to generate.

| Variable              | Purpose                                                                                                                                                          | Required | Example                             | Set in |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------- | ------ |
| `REPLICATE_API_TOKEN` | Enables the Replicate adapter. **Note:** all five model versions are still `PLACEHOLDER_*` and rejected at submit — this key alone does not make Replicate work. | ○        | `r8_… (Replicate account settings)` | Vercel |
| `OPENAI_API_KEY`      | Enables the OpenAI adapter.                                                                                                                                      | ○        | `sk-proj-… (OpenAI dashboard)`      | Vercel |
| `GOOGLE_AI_API_KEY`   | Enables the Gemini adapter. Catalogued as `declared`, so it stays unreachable until promoted.                                                                    | ○        | `AIza… (Google AI Studio)`          | Vercel |

---

## Stripe price ids — a plan whose id is unset is not offered

Created in the Stripe dashboard; they differ per account and between test and
live mode, so they cannot be committed.

| Variable                      | Purpose                     | Required | Example                      | Set in |
| ----------------------------- | --------------------------- | -------- | ---------------------------- | ------ |
| `STRIPE_PRICE_STUDIO_MONTHLY` | Studio plan, monthly.       | ○        | `price_… (Stripe dashboard)` | Vercel |
| `STRIPE_PRICE_STUDIO_YEARLY`  | Studio plan, yearly.        | ○        | `price_… (Stripe dashboard)` | Vercel |
| `STRIPE_PRICE_SCALE_MONTHLY`  | Scale plan, monthly.        | ○        | `price_… (Stripe dashboard)` | Vercel |
| `STRIPE_PRICE_SCALE_YEARLY`   | Scale plan, yearly.         | ○        | `price_… (Stripe dashboard)` | Vercel |
| `STRIPE_PRICE_PACK_1000`      | One-off 1,000-credit pack.  | ○        | `price_… (Stripe dashboard)` | Vercel |
| `STRIPE_PRICE_PACK_5000`      | One-off 5,000-credit pack.  | ○        | `price_… (Stripe dashboard)` | Vercel |
| `STRIPE_PRICE_PACK_20000`     | One-off 20,000-credit pack. | ○        | `price_… (Stripe dashboard)` | Vercel |

---

## Build and platform flags

| Variable              | Purpose                                                                                                                                                                                                                                                                                                                | Required | Example      | Set in       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ | ------------ |
| `NODE_ENV`            | Set by the platform. `development` \| `test` \| `production`.                                                                                                                                                                                                                                                          | auto     | `production` | automatic    |
| `ENABLE_DEV_PREVIEWS` | **New in Sprint 25.** `"1"` serves the eight `(dev)` preview routes in a production build. Off by default, so production 404s them — `/admin-preview` renders the admin interface with the gate bypassed. Set on preview deployments if you want them; the Playwright run sets it itself. **Never set on production.** | ○        | `1`          | preview only |
| `CSP_REPORT_ONLY`     | `"1"` downgrades the CSP to `Content-Security-Policy-Report-Only`. Useful for a first deploy if you suspect the policy blocks something. Turn it back off.                                                                                                                                                             | ○        | `1`          | temporary    |
| `SKIP_ENV_VALIDATION` | Bypasses this entire file. **Never set it on a deployment that serves traffic** — you get a green build and an app that 500s on every request touching the database. It exists for CI lint jobs and Docker builds.                                                                                                     | ○        | `1`          | CI only      |

---

## Missing variables — flagged

Measured against a production launch, not against the build.

| Variable                                      | Status                  | Consequence if left unset                                                     |
| --------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| All six **required**                          | ❌ not set anywhere yet | Build fails. Nothing deploys.                                                 |
| `CLERK_WEBHOOK_SIGNING_SECRET`                | ❌                      | Sign-ups create no user row. Silent, and the worst kind — the app looks fine. |
| `STRIPE_WEBHOOK_SECRET`                       | ❌                      | No payment is ever processed into a credit grant.                             |
| `WORKER_TRIGGER_SECRET` + `CRON_SECRET`       | ❌                      | The queue never drains. Every generation stays QUEUED forever.                |
| `WEBHOOK_SIGNING_SECRET`                      | ❌                      | Outbound callbacks are refused rather than sent unsigned.                     |
| `ADMIN_USER_IDS`                              | ❌                      | No one can reach the admin dashboard.                                         |
| All four `R2_*` + `NEXT_PUBLIC_R2_PUBLIC_URL` | ❌                      | Generations produce nothing durable.                                          |
| At least one provider key                     | ❌                      | Everything routes to the labelled mock.                                       |
| All seven `STRIPE_PRICE_*`                    | ❌                      | No plan is purchasable.                                                       |

**Nothing is configured in any deployment environment today**, because no
deployment environment exists. That is the launch blocker, and it is the same
one every report since Sprint 14 has named.

---

## `.env.example`

Fixed this sprint. The `.gitignore` rule `.env*` matched the template as well as
the secrets, so it had never been committed and anyone cloning the repository
got no list of what to set. A negation rule now re-includes it.

**`.env.local` is still ignored** — confirmed with `git check-ignore`. Verify
after any `.gitignore` edit:

```bash
git check-ignore -v .env.local
```
