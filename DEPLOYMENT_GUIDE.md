# Deployment Guide — Vercel

**Phase 7 · Final Sprint.** Every step required to launch Atheos.io.

Follow the order. Steps 5 and 6 fail if 2–4 are skipped, because the build
**refuses to compile** without the six required environment variables — by
design, verified by removing them and watching it stop at `lib/env.ts:13`.

Supersedes `DEPLOYMENT.md` where they differ.

---

## Before you start

|                 |                                                                      |
| --------------- | -------------------------------------------------------------------- |
| Repository      | `https://github.com/MoTerry1990/Atheos.io` — synced at `9d4188d`     |
| Accounts needed | Supabase, Clerk, Stripe, Cloudflare R2, Vercel                       |
| Already done    | Replicate (verified working)                                         |
| Realistic time  | 3–5 hours, mostly account signup                                     |
| Cost to start   | Free tiers throughout, except Vercel Pro if you want per-minute cron |

---

## Step 1 — Supabase

1. **supabase.com** → New project → name `atheos`
2. **Region: Frankfurt (eu-central-1)** — `vercel.json` pins the app to `fra1`.
   A cross-continent database adds 100 ms+ to _every_ query and will dominate
   every performance number you ever measure.
3. Generate a database password and **save it in a password manager**
4. **Connect → ORMs → Prisma.** Take **both** strings:

| Supabase label     | Port   | Variable       |
| ------------------ | ------ | -------------- |
| Transaction pooler | `6543` | `DATABASE_URL` |
| Session            | `5432` | `DIRECT_URL`   |

5. Replace `[YOUR-PASSWORD]` in both; append `?pgbouncer=true` to `DATABASE_URL`

> **They must be different strings.** The pooler cannot run DDL or hold the
> advisory locks Prisma Migrate needs. Using one for both is the most common
> failure at this step, and it fails _later_, confusingly.

6. Put both into `.env.local`, then apply the schema **from your machine**:

```bash
npx prisma migrate deploy
```

**`migrate deploy`, never `migrate dev`.** `dev` tries to create a fifth
migration against a shadow database; the four that exist are the artefact.

**Verify:** Supabase → Table Editor shows **17 tables**. Then locally:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health
```

Expect **200**. It returns 503 today because the database is the only
dependency that can fail the health check.

---

## Step 2 — Clerk

1. **clerk.com** → new application → enable your sign-in methods
2. API Keys → copy `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
3. Put both in `.env.local`, replacing the placeholders
4. Leave the webhook until step 5 — it needs the deployed URL

**This is the highest-value single step.** It fixes `/` and `/explore`, which
currently show a Clerk error in any browser, and unblocks sign-up, sign-in,
OAuth and the 16 skipped E2E tests. Re-run to confirm:

```bash
npx playwright test
```

Expect **120 passed, 0 skipped** with `E2E_CLERK_LIVE=1`.

---

## Step 3 — Cloudflare R2

1. Create a bucket, e.g. `atheos-assets`
2. Create an S3-compatible API token; copy the access key id and secret
3. Enable a public development URL, or attach a custom domain
4. **CORS:** allow `GET` and `HEAD` from your app origin
5. Set all four `R2_*` variables plus `NEXT_PUBLIC_R2_PUBLIC_URL`

**With this and the Replicate token already working, generation produces a real
stored image.** Storage is the current hard stop — a result has nowhere to go.

`NEXT_PUBLIC_R2_PUBLIC_URL` feeds both `images.remotePatterns` and the CSP
`img-src`. Get it wrong and images fail with a CSP violation, not a 404.

---

## Step 4 — Stripe

1. **Test mode.** Copy `STRIPE_SECRET_KEY`
2. Create products and prices: Studio and Scale (monthly + yearly), three credit
   packs. Copy all seven price ids
3. Leave the webhook until step 5

A plan whose price id is unset is **not offered** rather than failing at
checkout, so you can launch with a subset.

---

## Step 5 — Vercel

1. **Add New → Project** → import `MoTerry1990/Atheos.io`
2. Framework preset **Next.js** (auto-detected). Leave build settings alone —
   `vercel.json` and `package.json` carry them
3. **Paste every environment variable from `ENV_CHECKLIST.md` before clicking
   Deploy.** Do **not** use `SKIP_ENV_VALIDATION` — you get a green build and an
   app that 500s on every database request
4. Set `NEXT_PUBLIC_APP_URL` to the URL you intend to keep; changing it later
   invalidates OG images and canonical URLs
5. **Do not set `ENABLE_DEV_PREVIEWS`** — production must 404 the preview routes
6. Deploy
7. **Now create the webhooks**, with the real URL:
   - Clerk → `https://<domain>/api/webhooks/clerk` → events `user.created`,
     `user.updated`, `user.deleted` → secret into `CLERK_WEBHOOK_SIGNING_SECRET`
   - Stripe → `https://<domain>/api/webhooks/stripe` → events
     `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`,
     `invoice.payment_failed` → secret into `STRIPE_WEBHOOK_SECRET`
8. Generate one secret and set it as **both** `WORKER_TRIGGER_SECRET` and
   `CRON_SECRET`:
   ```bash
   openssl rand -hex 32
   ```
   Vercel signs cron requests with the latter; the route checks the former.
9. **Redeploy.** Environment variables are read at build time — adding one
   without redeploying changes nothing.
10. Set the Node version: Settings → General → **Node.js 22.x**

### Cron and your plan

`vercel.json` schedules `/api/worker/tick` every minute, which needs **Pro**. On
Hobby, cron runs once a day — useless for a queue. Run the worker elsewhere:

```bash
while true; do
  curl -s -X POST -H "Authorization: Bearer $WORKER_TRIGGER_SECRET" \
    https://<domain>/api/worker/tick
  sleep 30
done
```

`runTick` is idempotent under concurrency, so over-scheduling is safe.

---

## Step 6 — Verify the deployment

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/api/health   # 200
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/design-system # 404
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/admin-preview # 404
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/api/projects  # 401
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/admin         # 404
curl -sI https://<domain>/ | grep -i "content-security-policy\|strict-transport"
```

The two 404s are the security guard added this sprint. If either returns 200,
`ENABLE_DEV_PREVIEWS` is set in production — unset it and redeploy.

**Then the first-run list, in order:**

- [ ] Sign up → confirm the `users` row **and** the signup credit grant
- [ ] Generate → confirm the debit, the R2 object and the `assets` row
- [ ] Force a failure → confirm **exactly one** refund
- [ ] Subscribe in test mode → confirm plan and grant
- [ ] **Redeliver that Stripe webhook → confirm it grants nothing**
- [ ] Queue a job, close the browser → confirm it completes
- [ ] Point an uptime monitor at `/api/health`

The webhook redelivery is the one to insist on. It is proven at the database
level by a unique constraint and has never been proven against real Stripe.

---

## Step 7 — DNS (optional)

| Record  | Name  | Value                  |
| ------- | ----- | ---------------------- |
| `A`     | `@`   | `76.76.21.21`          |
| `CNAME` | `www` | `cname.vercel-dns.com` |

Then update `NEXT_PUBLIC_APP_URL`, both webhook URLs, Clerk's allowed origins,
and redeploy.

> **HSTS is set with `preload` and a two-year max-age.** Once a browser sees it,
> that host is HTTPS-only for two years with no quick way back. Do not point a
> domain here you might want to serve over HTTP.

---

## Rollback

**Application — seconds, no data risk.** Vercel → Deployments → last known-good
→ **Promote to Production**. Atomic, does not touch the database. Do this first,
diagnose second.

**Environment variable.** Fix the value, redeploy. Editing without redeploying
changes nothing.

**Database — the one that needs care.** There are no down migrations, by design.
Promote the previous deployment first so nothing is writing, then restore from a
Supabase point-in-time backup or write a forward migration that reverses the
change. Never hand-edit a production schema: `_prisma_migrations` will disagree
with reality and the next deploy fails in a way that is hard to unpick.

**Kill switch, no deploy needed.** Unset `WORKER_TRIGGER_SECRET` and redeploy —
the tick endpoint returns 404 and all queue processing halts while the site
stays up. Use it when a provider is burning money.
