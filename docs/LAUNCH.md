# Launch checklist

Written at the end of Sprint 13. Its job is to be **accurate**, not reassuring.

Everything below is one of three things, and they are never blurred:

- **✅ Verified** — executed and observed, here, with the evidence named.
- **⚠️ Written, never run** — the code exists and typechecks. Nothing has
  exercised it.
- **❌ Not built.**

> ## Read this first
>
> **Atheos has never run against real infrastructure.** No database, no Clerk
> instance, no Stripe account, no AI provider key, no R2 bucket. Thirteen
> sprints of code, and not one generation, payment, sign-up or webhook has
> executed.
>
> **~~No migration has ever been generated.~~ Closed in Sprint 14.**
> `prisma/migrations/0_init/` now exists — 476 lines of SQL, generated offline
> with `migrate diff`, applied to a real Postgres engine and verified against
> the schema (§ 47). It has still never been applied by `prisma migrate` itself
> to a real database, so step 2 below remains a genuine first.
>
> **There are no tests.** Zero. In a codebase with an append-only credit ledger,
> idempotent payment webhooks, refund logic and admin tooling that adjusts
> balances.
>
> This is not a product that is ready to launch. It is a complete, coherent,
> carefully-reasoned implementation that has never been switched on. Those are
> different things, and the gap between them is what this document exists to
> stop anybody forgetting.

---

## Before anything else

These are ordered. Each one is a prerequisite for the next.

1. **Provision Postgres.** Two connection strings — pooled for runtime, direct
   for migrations. They are not interchangeable; see § 3 of `DECISIONS.md`.
2. **`npx prisma migrate deploy`.** The migration already exists — do **not**
   run `migrate dev`, which would try to create a second one. Read
   `prisma/migrations/0_init/migration.sql` first; it is meant to be read.
3. **For a database that already has these tables**, adopt the migration
   instead: `npx prisma migrate resolve --applied 0_init`.
4. **Create a Clerk instance.** Set the publishable and secret keys, then the
   webhook endpoint at `/api/webhooks/clerk` and its signing secret. Without
   that secret, sign-ups create no user row and nothing else works.
5. **Set `ADMIN_USER_IDS`** to your own Clerk user id. Without it, nobody can
   reach `/admin` and there is no recovery path if the `role` column is wrong.
6. **Stripe test mode.** Create the four plan prices and three pack prices, set
   the seven `STRIPE_PRICE_*` variables, and run `stripe listen --forward-to
localhost:3000/api/webhooks/stripe`.
7. **R2 bucket** plus a public URL. Generation is disabled without it — checked
   before credits are spent, deliberately.
8. **One AI provider key.** Without one the mock provider is used and the studio
   says so in a banner.

---

## First run: what to actually check

Not a smoke test. These are the specific things designed to be exactly-once,
and none has ever executed.

- [ ] **Sign up.** Confirm the Clerk webhook creates the `users` row _and_ the
      `SIGNUP_GRANT` ledger entry, in one transaction.
- [ ] **Generate once** against the mock provider. Confirm the debit, the R2
      write, and that the asset row carries the right `kind` and `mimeType`.
- [ ] **Force a failure.** Confirm the refund lands **exactly once** —
      `idempotencyKey = refund:{generationId}`.
- [ ] **Subscribe in test mode.** Confirm one `SUBSCRIPTION_GRANT`.
- [ ] **Redeliver that webhook from the Stripe dashboard.** Confirm it grants
      **nothing** the second time. This is the single most important check in
      this document: it is the difference between a working ledger and giving
      inventory away.
- [ ] **Upgrade, then downgrade.** Confirm the upgrade charges immediately and
      the downgrade schedules for the period end without removing anything.
- [ ] **Adjust credits from `/admin`, then submit the same form twice.**
      Confirm one adjustment and one audit row.
- [ ] **Open a support view.** Confirm an audit entry exists for the _read_.
- [ ] **Sign in as a non-admin and request `/admin` and `/api/admin/overview`.**
      Both must be 404. Only the anonymous case has been verified.
- [ ] **Publish a post, then take it down.** Confirm it leaves `/explore` and
      the sitemap, and that likes and comments survive.

---

## Verified in this environment

Real evidence, all of it from Sprint 13 unless noted.

- ✅ **Production build clean.** `tsc --noEmit`, `eslint --max-warnings 0`,
  `prettier --check`, `next build` — all pass.
- ✅ **Security headers**, observed on a `next start` response:
  CSP (Report-Only), `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Strict-Transport-Security`.
- ✅ **API cache policy**: `/api/*` returns
  `no-store, no-cache, must-revalidate, private`.
- ✅ **Admin gate, anonymous**: every `/api/admin/*` route returns 404, and
  `/admin` returns 404 while `/studio` returns 307 — so the route's
  existence does not leak.
- ✅ **Every other API rejects unauthenticated writes** with 401.
- ✅ **Webhook signature enforcement**: the Stripe webhook refuses unsigned
  requests rather than processing them.
- ✅ **Heading structure**: one `h1` per page, no skipped levels, checked on
  every reachable page against the production server.
- ✅ **No horizontal overflow** at 375px or 1280px on any reachable page.
- ✅ **Tap targets** ≥ 24px (WCAG 2.5.8) — five separate misses found and fixed
  across Sprints 8–13.
- ✅ **Interaction behaviour**, per sprint, against fixtures: video playback,
  autosave with a flush on unmount, marketplace install, community
  like/comment/follow, admin credit adjustment with double-submit.

---

## Written, never run

Everything with a database or a vendor behind it.

- ⚠️ Every Prisma query in the codebase. They typecheck against a generated
  client; none has reached Postgres. The **schema** is now verified (§ 47); the
  **queries** are not.
- ⚠️ The whole generation pipeline — providers, storage, credits, refunds.
- ⚠️ All of billing: checkout, portal, plan changes, webhooks, invoices.
- ⚠️ Clerk sign-up, sign-in, OAuth, password reset, and the user-sync webhook.
- ⚠️ The admin gate for a **signed-in non-admin**. Shares a code path with the
  anonymous case, which was verified.
- ✅ ~~The landing page in a browser.~~ Verified in Sprint 14 against
  `next start`: 162KB of HTML, correct title, exactly one `h1`, no Clerk
  interstitial. The dev handshake only intercepts `/` in development.
- ⚠️ Replicate model versions are `PLACEHOLDER` and rejected at submit with a
  clear message. Real hashes come from a Replicate account.

---

## Not built

- ❌ **Tests.** The largest single gap.
- ❌ **A background reconciler.** The client is the job runner; a job whose tab
  closes stops advancing until someone reopens the studio. Resumption
  narrows the window, it does not close it.
- ❌ **Rate limiting** on any endpoint.
- ❌ **Error tracking and structured logging.** `console.error` only.
- ❌ **Audio generation.** Two voice packs are catalogued and marked unusable.
- ❌ **The asset library**, third-party marketplace publishing, bulk export.
- ❌ **Backups, runbooks, load testing.**

---

## Deployment

### Environment

Every variable is listed in `.env.example` with a comment explaining what
breaks without it. The build fails on a missing **required** one — that is
`lib/env.ts` doing its job (§ 7), not an obstacle to work around.

Optional variables degrade honestly and say so in the interface: no Stripe
prices means plans are shown but not purchasable; no provider key means the
mock provider and a banner; no R2 means generation is disabled _before_ credits
are spent.

### The CSP ships in Report-Only

~~`Content-Security-Policy-Report-Only` by default.~~ A policy that has never
seen real traffic will block something — an OAuth popup, a Stripe redirect, a
Clerk captcha frame. Expect to hit one of those on the first staging deploy, and
fix it there.

**Updated in Sprint 15: it now enforces by default.** The wait-for-evidence
plan assumed reports would accumulate, and none can from a product that has
never been deployed. `CSP_REPORT_ONLY=1` goes back to observing if a real
deployment needs something diagnosed.

### Order

1. Migrations against staging, then production.
2. Deploy with all env vars set.
3. Register both webhook endpoints and set their signing secrets.
4. Verify `/admin` → System status shows every check green or knowingly amber.
5. Work the first-run list above.

### Rollback

The application is stateless; reverting the deployment is enough. **Migrations
are not** — review the SQL before applying, and take a snapshot first. Nothing
in this codebase performs a destructive migration today, but nothing enforces
that either.

---

## Known behaviour that looks like a bug

Recorded so nobody "fixes" it.

- **Trending is empty** and does not fall back to recent. With nothing
  published there is nothing to rank, and a ranking that invents momentum lies
  about the only thing it measures (§ 34).
- **Featured creators is empty.** It is editorial, not popularity-derived, and
  stays blank until somebody is featured (§ 34).
- **Voice packs install and do nothing.** Audio does not exist yet; they say so
  (§ 31).
- **The mock provider stamps its output** "not AI generated" and the studio
  shows a banner. Both disappear when a real provider is configured.
- **Recorded revenue is labelled approximate.** It is reconstructed from our
  ledger and misses refunds and disputes; Stripe is the source of truth (§ 6).
- **`/admin` returns 404, not 403.** Deliberate (§ 38).
- **Credits outstanding is labelled a liability**, because it is.
