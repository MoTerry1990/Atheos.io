# Deployment — Atheos.io

**Scope:** Phase 5. Vercel deployment preparation and runbook.
**Target:** Vercel + Supabase Postgres + Clerk + Stripe + Cloudflare R2.

Follow the order. Each step's verification unblocks the next, and the ordering
is the point — steps 4 and 5 will fail if 2 and 3 are skipped.

---

## Platform compatibility — verified

| Concern                  | Verdict                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Next.js version**      | ✅ 15.5.22, App Router. First-class on Vercel.                                                                                                                                                                                 |
| **Edge runtime**         | ✅ Only `middleware.ts` runs on Edge. It calls `clerkMiddleware` and sets one header — no Prisma, no Node built-ins. 90.9 kB, within the 1 MB Edge limit.                                                                      |
| **Node runtime**         | ✅ Every route handler and Server Component runs on Node. **No `export const runtime` anywhere**, so nothing is accidentally on Edge where Prisma would fail.                                                                  |
| **Prisma on serverless** | ✅ `serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg"]` keeps them out of the bundle. `build` runs `prisma generate` first, which Vercel requires — a cached `node_modules` would otherwise ship a stale client. |
| **Image optimization**   | ✅ AVIF + WebP, `remotePatterns` for R2 and Clerk hosts, `minimumCacheTTL` 1 year, explicit `deviceSizes`/`imageSizes`. Uses Vercel's optimizer.                                                                               |
| **Headers**              | ✅ Set in `next.config.ts` and therefore applied by Vercel: enforcing CSP, HSTS with preload, `nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy`.                                                                      |
| **Caching**              | ✅ `/api/*` is `no-store, private`; `/_next/static/*` is `immutable` for a year; `/dev/*` is a day; `/sitemap.xml` is ISR 1 h.                                                                                                 |
| **Compression**          | ✅ Vercel gzips and brotlis at the edge automatically. Nothing to configure — do not set `compress` in `next.config.ts`, it applies to the Node server Vercel does not use.                                                    |
| **Middleware matcher**   | ✅ Excludes `_next`, static file extensions and the eight preview routes, so it does not run on assets.                                                                                                                        |
| **`vercel.json`**        | ✅ Added this sprint: cron, `maxDuration: 60` on three long routes, region `fra1`.                                                                                                                                             |
| **Node version**         | ⚠️ `engines.node` is `>=20.9.0` — a floor, not a pin. Set the exact major in Vercel → Settings → General → Node.js Version.                                                                                                    |

---

## Step 1 — GitHub

The repository exists at `https://github.com/MoTerry1990/Atheos.io` and the
Release Candidate commit is on `main` locally. If it is not yet pushed:

```bash
git push -u origin main
```

Credential Manager will prompt once. Verify the file count on GitHub matches
`git ls-files | wc -l` locally — a partial push is worse than none.

**Confirm `.env.local` is not in the repository.** It is ignored, and it is
worth checking with your own eyes before the repo is public:

```bash
git ls-files | grep -c "^\.env\.local$"
```

Expect `0`.

---

## Step 2 — Supabase (do this before Vercel)

1. Create a project. Choose a region near your Vercel region — `fra1` in
   `vercel.json` pairs with `eu-central-1`. Cross-continent adds 100 ms+ to
   **every** query.
2. Set a strong database password. Store it in a password manager.
3. Settings → Database → Connection string. Take **both**:
   - **Transaction pooler**, port `6543` → `DATABASE_URL`
   - **Session**, port `5432` → `DIRECT_URL`
4. Append `?pgbouncer=true` to `DATABASE_URL`.

> These must be different strings. The pooler cannot run DDL or hold the
> advisory locks Prisma Migrate needs. Setting both to the same value is the
> single most common failure at this step.

**Apply the schema from your machine**, not from Vercel:

```bash
DIRECT_URL="postgresql://...:5432/postgres" npx prisma migrate deploy
```

**`migrate deploy`, never `migrate dev`.** `dev` tries to create a fifth
migration against a shadow database. Four exist and are the deployment artefact.

Verify: Supabase → Table Editor shows **17 tables**.

---

## Step 3 — Clerk

1. Create an application. Enable the sign-in methods you want.
2. API Keys → copy `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
3. Leave the webhook until step 6 — it needs the deployed URL.

> The placeholder key in local `.env.local` is why `/` and `/explore` 400 in a
> real browser and why 16 E2E tests skip. A real key resolves both. After
> deploying, re-run with `E2E_CLERK_LIVE=1` and expect 120 passing, 0 skipped.

---

## Step 4 — Stripe

1. Test mode. Copy `STRIPE_SECRET_KEY`.
2. Create products and prices for Studio and Scale (monthly + yearly) and the
   three credit packs. Copy all seven price ids.
3. Leave the webhook until step 6.

A plan whose price id is unset is not offered rather than failing at checkout —
so you can launch with a subset and add the rest later.

---

## Step 5 — Cloudflare R2

1. Create a bucket, e.g. `atheos-assets`.
2. Create an S3-compatible API token; copy the access key id and secret.
3. Enable a public development URL or attach a custom domain.
4. **CORS**: allow `GET` and `HEAD` from your app origin.

`NEXT_PUBLIC_R2_PUBLIC_URL` feeds both `images.remotePatterns` and the CSP
`img-src`. A custom domain not set here loads nothing and the browser console
will show a CSP violation, not a 404.

---

## Step 6 — Vercel

1. Add New → Project → import `MoTerry1990/Atheos.io`.
2. Framework preset: **Next.js** (auto-detected). Leave build and output
   settings alone — `vercel.json` and `package.json` already carry them.
3. **Environment Variables — paste everything from `ENVIRONMENT_TEMPLATE.md`
   before clicking Deploy.** The build imports `lib/env.ts` and fails on the
   first missing required variable. This is deliberate. Do **not** reach for
   `SKIP_ENV_VALIDATION`.
4. Set `NEXT_PUBLIC_APP_URL` to the production URL you intend to keep. Changing
   it later invalidates OG images and canonical URLs.
5. Deploy.
6. **Now create the webhooks**, with the real URL:
   - Clerk → Webhooks → `https://<domain>/api/webhooks/clerk`
     Events: `user.created`, `user.updated`, `user.deleted`.
     Copy the signing secret → `CLERK_WEBHOOK_SIGNING_SECRET`.
   - Stripe → Webhooks → `https://<domain>/api/webhooks/stripe`
     Events: `checkout.session.completed`,
     `customer.subscription.created|updated|deleted`,
     `invoice.paid`, `invoice.payment_failed`.
     Copy the signing secret → `STRIPE_WEBHOOK_SECRET`.
7. Set `WORKER_TRIGGER_SECRET` and `CRON_SECRET` **to the same value**:
   ```bash
   openssl rand -hex 32
   ```
8. Redeploy so the new variables take effect. Environment variables are read at
   build time; adding one without redeploying changes nothing.

### Cron and your Vercel plan

`vercel.json` schedules `/api/worker/tick` **every minute**. That requires
**Pro**. On Hobby, cron runs at most once per day, which is useless for a job
queue — on Hobby, run the worker elsewhere:

```bash
while true; do
  curl -s -X POST -H "Authorization: Bearer $WORKER_TRIGGER_SECRET" \
    https://<domain>/api/worker/tick
  sleep 30
done
```

Any always-on host works. `runTick` is idempotent under concurrency, so
over-scheduling is safe by construction.

---

## Step 7 — DNS

Vercel serves `*.vercel.app` immediately. For a custom domain:

| Record  | Name  | Value                  |
| ------- | ----- | ---------------------- |
| `A`     | `@`   | `76.76.21.21`          |
| `CNAME` | `www` | `cname.vercel-dns.com` |

Vercel provisions the certificate automatically. Then:

1. Update `NEXT_PUBLIC_APP_URL` and redeploy.
2. Update both webhook endpoint URLs.
3. Update Clerk's allowed origins.
4. Confirm `https://<domain>/sitemap.xml` shows the new host.

> **HSTS is set with `preload` and a two-year max-age.** Once a browser sees it,
> that host is HTTPS-only for two years and there is no quick way back. Do not
> point a domain here that you might want to serve over HTTP.

---

## Production deployment checklist

Run in order. Stop at the first failure.

**Before deploying**

- [ ] `npm run verify` passes locally (typecheck, lint, format, 256 tests)
- [ ] `npx playwright test` passes (104 passed, 16 skipped)
- [ ] All six required env vars set in Vercel → Production
- [ ] `DATABASE_URL` ≠ `DIRECT_URL`
- [ ] `ENABLE_DEV_PREVIEWS` **not** set on production
- [ ] `SKIP_ENV_VALIDATION` **not** set anywhere

**After the build succeeds**

- [ ] `/` returns 200 in a real browser, not just `curl`
- [ ] `/design-system` returns **404** — previews must not be public
- [ ] `/admin-preview` returns **404**
- [ ] `/admin` returns 404 anonymous
- [ ] `/api/projects` returns 401 anonymous
- [ ] `/sitemap.xml` and `/robots.txt` return 200
- [ ] Response carries `Content-Security-Policy` (not `-Report-Only`) and HSTS

**First-run correctness — the part nobody skips twice**

- [ ] Sign up once → confirm the `users` row **and** the signup credit grant
- [ ] Generate once → confirm the debit, the R2 object and the `assets` row
- [ ] Force a failure → confirm **exactly one** refund
- [ ] Subscribe in Stripe test mode → confirm the plan and grant
- [ ] **Redeliver that Stripe webhook from the dashboard → confirm it grants
      nothing the second time.** Proven at the database level by a unique
      constraint; never proven against real Stripe. It is the single most
      important check in this project.
- [ ] Queue a generation, close the browser → confirm it still completes
- [ ] Confirm the cron is firing: Vercel → Deployments → Cron Jobs

---

## Rollback plan

**Application — seconds, no data risk**

Vercel → Deployments → the last known-good deployment → **Promote to
Production**. Instant, atomic, and it does not touch the database. Do this
first, then diagnose.

**Environment variable — one redeploy**

Correct the value, then redeploy. Editing without redeploying changes nothing;
they are read at build time.

**Database — the one that needs care**

Prisma migrations have **no down migrations here, by design**. Rolling a schema
change back means:

1. Promote the previous application deployment first, so nothing is writing.
2. Restore from a Supabase point-in-time backup, or write a forward migration
   that reverses the change.

Never hand-edit a production schema to match an older deployment. The
`_prisma_migrations` table will disagree with reality and the next
`migrate deploy` will fail in a way that is hard to unpick.

**A migration is the only irreversible step in this runbook.** Take a snapshot
before applying one to a database with real user data.

**Stripe and Clerk** hold their own state and are not rolled back by redeploying.
A refund is a Stripe operation; a deleted user is a Clerk operation. Both
reconcile into our tables by webhook, so fix them at the source and let the
webhook catch up.

**Kill switch, no deploy required**

Unset `WORKER_TRIGGER_SECRET` in Vercel and redeploy: the tick endpoint refuses
to run and returns 404, halting all queue processing while leaving the site up.
Useful when a provider is burning money and you need it stopped now.
