# Environment Checklist

**Phase 3 · Final Sprint** · measured against `.env.local` today.

**Configured** means a real value is present. **Placeholder** means a line
exists with a value that is structurally valid but points at nothing —
dangerous, because the app starts and then fails at the first real use.
**Missing** means the line is absent.

> `.env.local` is git-ignored and always must be. This table reports _state_,
> never values.

---

## Required — the build fails without these

| Variable                            | Purpose                                                    | Required |            Configured             | Missing |
| ----------------------------------- | ---------------------------------------------------------- | :------: | :-------------------------------: | :-----: |
| `DATABASE_URL`                      | Runtime Postgres, Supabase transaction pooler, port 6543   |    ✅    |          ❌ placeholder           |   ⛔    |
| `DIRECT_URL`                        | Migrations only, session connection, port 5432             |    ✅    |          ❌ placeholder           |   ⛔    |
| `CLERK_SECRET_KEY`                  | Server-side Clerk API and session verification             |    ✅    |          ❌ placeholder           |   ⛔    |
| `STRIPE_SECRET_KEY`                 | Server-side Stripe API                                     |    ✅    |          ❌ placeholder           |   ⛔    |
| `NEXT_PUBLIC_APP_URL`               | Canonical origin for metadata, OG, sitemap, Stripe returns |    ✅    |          ❌ placeholder           |   ⛔    |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk browser SDK                                          |    ✅    | ⚠️ present, points at no instance |    —    |

**All six are effectively unset.** The build passes locally only because the
placeholders are _structurally_ valid — a URL that parses, a string that is
non-empty. Verified by removing `.env.local` and building:

```
❌ Invalid environment variables:
   DATABASE_URL      expected string, received undefined
⨯ Failed to load next.config.ts   at lib/env.ts:13
```

The Clerk publishable key is the one to understand: it is real in shape and
points at `placeholder-not-a-real-instance.clerk.accounts.dev`. That is why `/`
and `/explore` return a Clerk error in a browser and why 16 E2E tests skip.

---

## Configured and working

| Variable              | Purpose                     | Required |   Configured    | Missing |
| --------------------- | --------------------------- | :------: | :-------------: | :-----: |
| `REPLICATE_API_TOKEN` | AI generation via Replicate |    ○     | ✅ **verified** |    —    |

**The only genuinely working credential in the project.** It authenticates as
`moterry1990` and a live submission reached Replicate's billing gate — token,
model version and payload all accepted.

⚠️ **Rotate this token.** It appeared in a screenshot in the working session.
Set a spend limit at replicate.com/account/billing as immediate mitigation.

---

## Strongly recommended — silent failures without them

| Variable                       | Purpose                                                               | Required |   Configured   | Missing |
| ------------------------------ | --------------------------------------------------------------------- | :------: | :------------: | :-----: |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Verifies Clerk webhooks. **Without it a sign-up creates no user row** |    ⚠️    | ❌ placeholder |   ⛔    |
| `STRIPE_WEBHOOK_SECRET`        | Verifies Stripe webhooks. Without it no payment becomes credits       |    ⚠️    |       ❌       |   ⛔    |
| `WORKER_TRIGGER_SECRET`        | Auth for `/api/worker/tick`. **Without it the queue never drains**    |    ⚠️    |       ❌       |   ⛔    |
| `CRON_SECRET`                  | Vercel platform var. Must equal `WORKER_TRIGGER_SECRET`               |    ⚠️    |       ❌       |   ⛔    |
| `WEBHOOK_SIGNING_SECRET`       | Signs outbound callbacks; refuses to send unsigned                    |    ⚠️    |       ❌       |   ⛔    |
| `ADMIN_USER_IDS`               | Root of trust for admin access                                        |    ⚠️    |       ❌       |   ⛔    |

Each of these fails **closed and quietly**. The site works, the specific
capability does not, and nothing tells you. `CLERK_WEBHOOK_SIGNING_SECRET` is
the worst of them: sign-up appears to succeed and no user exists.

---

## Storage — generation cannot persist without all four

| Variable                    | Purpose                                               | Required | Configured | Missing |
| --------------------------- | ----------------------------------------------------- | :------: | :--------: | :-----: |
| `R2_ACCOUNT_ID`             | Cloudflare account                                    |    ○     |     ❌     |   ⛔    |
| `R2_ACCESS_KEY_ID`          | R2 S3 access key                                      |    ○     |     ❌     |   ⛔    |
| `R2_SECRET_ACCESS_KEY`      | R2 S3 secret                                          |    ○     |     ❌     |   ⛔    |
| `R2_BUCKET_NAME`            | Destination bucket                                    |    ○     |     ❌     |   ⛔    |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | Public asset base URL; feeds CSP and `remotePatterns` |    ○     |     ❌     |   ⛔    |

**This is the current hard stop for generation.** Even with Replicate working,
`isStorageConfigured()` returns false, so a result has nowhere to be written.
`/api/health` reports `storage: false` today.

---

## Optional

| Variable              | Purpose                                               | Required |       Configured        | Missing |
| --------------------- | ----------------------------------------------------- | :------: | :---------------------: | :-----: |
| `OPENAI_API_KEY`      | Enables the OpenAI adapter                            |    ○     |           ❌            |    —    |
| `GOOGLE_AI_API_KEY`   | Enables the Gemini adapter (stays `declared`)         |    ○     |           ❌            |    —    |
| `STRIPE_PRICE_*` (×7) | Plan and pack price ids; an unset plan is not offered |    ○     |           ❌            |    —    |
| `ENABLE_DEV_PREVIEWS` | Serves `(dev)` routes in a production build           |    ○     |       ❌ correct        |    —    |
| `CSP_REPORT_ONLY`     | Downgrades CSP to report-only                         |    ○     |       ❌ correct        |    —    |
| `SKIP_ENV_VALIDATION` | Bypasses this entire file                             |    ○     | ❌ **keep it that way** |    —    |

`ENABLE_DEV_PREVIEWS` being absent is **correct** — production must 404 the
preview routes. Playwright sets it for its own run.

---

## Summary

| State                                      | Count                         |
| ------------------------------------------ | ----------------------------- |
| Configured and verified                    | **1** (`REPLICATE_API_TOKEN`) |
| Placeholder — looks set, works for nothing | **6**                         |
| Missing                                    | **13**                        |

**Nothing is configured in any deployment environment**, because no deployment
environment exists.

### The order that unblocks the most, per unit of effort

1. **Clerk** — free, 2 minutes, no payment details. Fixes `/`, `/explore`, sign-up,
   sign-in, OAuth, and the 16 skipped E2E tests.
2. **Supabase** — free tier. Unblocks the database, so `/api/health` returns 200
   and every service-layer feature starts working.
3. **Cloudflare R2** — free tier. Combined with the Replicate token already in
   place, this is what makes a generated image persist.
4. **Stripe** — last. Nothing about seeing or testing the product needs it.

Steps 1–3 need no payment details and no business identity. After them, Atheos
generates and stores real images.
