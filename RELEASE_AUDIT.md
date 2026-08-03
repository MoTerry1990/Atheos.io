# Atheos — Release Audit

**Date:** 2026-08-02 · **Sprints 0–24 complete · Release Candidate 1**
**Reviewer posture:** Principal Engineer, production readiness review
**Sources:** `PROJECT_AUDIT.md`, `INFRASTRUCTURE_REPORT.md`, `SECURITY_REPORT.md`,
`PERFORMANCE_REPORT.md`, `TEST_REPORT.md`, `AI_ENGINE.md`,
`AI_PROVIDER_REPORT.md`, `WORKER_REPORT.md`, `COST_ENGINE_REPORT.md`,
`STATUS_REPORT.md`, `AI_STUDIO_REDESIGN.md`, `LANDING_PAGE_REPORT.md`,
`RC1_REPORT.md`, `docs/LAUNCH.md`, `docs/DECISIONS.md`, `ROADMAP.md`.

**Every number below was re-measured against the working tree today.** Where a
report's figure disagreed with the code, the code won and the disagreement is
noted.

---

> ## The finding that governs this entire review
>
> **Atheos has never been switched on.** No database, no Clerk instance, no
> Stripe account, no storage bucket, no AI provider key. In twenty-five sprints
> not one generation, payment, sign-up, upload or vendor call has executed.
>
> This is not a caveat attached to an otherwise-passing review. It is the
> review. Every score below is split between **built**, **verified here**, and
> **proven against a real dependency** — and the third column is empty.

---

# Executive Summary

| Metric                   | Score                              |
| ------------------------ | ---------------------------------- |
| **Overall completion**   | **69 %**                           |
| **Production readiness** | **42 %**                           |
| **Launch readiness**     | **15 %**                           |
| **Technical debt**       | **18 %** (low — see qualification) |
| **Time to production**   | **12–16 weeks** (see breakdown)    |

### Overall completion — 69 %

Weighted by what it takes to charge a customer, not by feature count.

| Area                                                   | Weight | Complete | Contribution |
| ------------------------------------------------------ | ------ | -------- | ------------ |
| UI surface and design system                           | 20 %   | 96 %     | 19.2         |
| Application features (studio → admin)                  | 25 %   | 87 %     | 21.8         |
| Data model and migrations                              | 10 %   | 95 %     | 9.5          |
| Server pipeline (generation, credits, storage, worker) | 15 %   | 75 %     | 11.3         |
| Billing and identity **integration**                   | 10 %   | 30 %     | 3.0          |
| Infrastructure (provisioning, CI, deploy, scheduling)  | 10 %   | 10 %     | 1.0          |
| Testing and observability                              | 10 %   | 30 %     | 3.0          |
|                                                        |        |          | **68.8 %**   |

Up two points from the Sprint 21 audit's 67 %. Sprints 22–24 were UI and quality
work: they moved the top two rows and nothing else. **The three rows holding the
number down cannot be moved by writing more application code.**

### Production readiness — 42 / 100

| Component               | Score | Evidence                                                           |
| ----------------------- | ----- | ------------------------------------------------------------------ |
| Schema deployability    | 90    | 4 migrations, chain-applied to real Postgres, 50+ assertions       |
| Configuration hygiene   | 90    | Every variable read by something; build fails on a missing one     |
| Integration correctness | 60    | Two silent webhook bugs found and fixed; no vendor ever called     |
| Test integrity          | 45    | 256 unit + 104 E2E green; 19 % coverage; harness defect just fixed |
| Observability           | 10    | 30 `console.error` sites, no error tracker, no metrics             |
| Deployment automation   | 5     | No CI, no `vercel.json`, no Dockerfile, no cron                    |
| Live infrastructure     | 0     | Unchanged since Sprint 0                                           |

Sprint 21 scored 40. The two-point gain is for RC1 repairing the test harness —
**not** for new capability.

### Launch readiness — 15 / 100

Deliberately far below production readiness, because they are different
questions. Production readiness asks _would it run_. Launch readiness asks
_may it be opened to the public_.

It may not. There is no content moderation on a product that generates arbitrary
imagery and publishes it to an indexable gallery; no terms, privacy policy or
acceptable-use policy; no account deletion or data export; no takedown path; no
incident runbook; no error tracking with which to notice any of it going wrong.
Each of those is a launch blocker independent of whether the code works.

### Technical debt — 18 %

Low, and the number needs its qualification. Estimated rework as a fraction of
total effort.

**Debt is unusually low for a codebase this size** because the recurring pattern
here is _not built yet_, not _built wrong_. The provider contract absorbed eleven
vendors without modification. Six duplicated auth checks were collapsed to one.
RC1 found exactly **one** genuine duplicate function in the entire tree.

What debt exists is concentrated and named:

| Debt                                                   | Rework                     |
| ------------------------------------------------------ | -------------------------- |
| Worker built but not cut over — two generation paths   | Rewrite `generation.ts`    |
| `RateLimitStore` / `HealthStore` in-memory             | One Redis impl each        |
| 15 of 31 `findMany` calls unbounded                    | Mechanical                 |
| Replicate's 5 model versions are `PLACEHOLDER_*`       | Needs an account, not code |
| `gpuTimeMs` / token columns exist, nothing writes them | Provider interface change  |
| `(dev)` route group ships to production                | One layout guard           |

### Estimated time to production

One experienced full-stack engineer, working sequentially where blocked.

| Phase                                                                    | Elapsed         |
| ------------------------------------------------------------------------ | --------------- |
| Commit the tree; provision Postgres, Clerk, Stripe, R2; `migrate deploy` | 3–5 days        |
| Work the `docs/LAUNCH.md` first-run list end to end                      | 1 week          |
| Make 2–3 providers genuinely work (real versions, keys, cost bases)      | 1–2 weeks       |
| Wire the worker into `generation.ts`; add a scheduler                    | 1 week          |
| CI, error tracking, structured logging, Redis behind both stores         | 1–2 weeks       |
| Service-layer test coverage on a Postgres harness                        | 2 weeks         |
| **→ Closed beta with real users**                                        | **6–8 weeks**   |
| Content moderation pipeline                                              | 1–2 weeks       |
| Account deletion, data export, GDPR paths                                | 1 week          |
| Legal pages (needs counsel — elapsed, not effort)                        | 2–3 weeks       |
| Load test, backups, runbook, status page                                 | 1 week          |
| **→ Public launch**                                                      | **12–16 weeks** |

The bulk is not writing code. It is proving that code which has never run
actually works, and building the operational and legal surface a public AI
product legally requires.

---

# Infrastructure

| Area                      | State                                                                                                                                                                  | Grade |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Database**              | Schema excellent — 17 tables, 11 enums, 22 FKs with deliberate cascade/set-null policy. **No instance exists.** Never touched by Prisma's own migration machinery.     | ⚠️ 40 |
| **Migrations**            | 4 migrations, chain-applied in order to real Postgres (PGlite) and introspected. Index count reconciles exactly: 30 `@@index` + 3 `@@unique` + 10 `@unique` = 43.      | ✅ 85 |
| **Authentication**        | Clerk 7, custom flows, authorisation lives with the resource. Verified over HTTP: 401 anonymous everywhere, 404 across admin. **Nothing has ever authenticated.**      | ⚠️ 55 |
| **Storage**               | R2 client construction and failure modes correct. **No bucket.** Objects protected only by unguessable keys; the direct URL has no ownership check.                    | ⚠️ 30 |
| **Payments**              | Checkout, portal, plan changes, invoices, webhook lifecycle all written. **Zero Stripe API calls, ever.** No tax, dunning or dispute handling.                         | ⚠️ 30 |
| **AI Providers**          | 11 catalogued, **2 `implemented`, 9 `declared`** — re-counted in `catalogue.ts` today. 3 adapters exist. **None has ever called its vendor.**                          | 🔴 15 |
| **Workers**               | Queue is real: atomic claim via `FOR UPDATE SKIP LOCKED`, leases, heartbeats, retry scheduling, persisted logs, signed callbacks. **Nothing schedules it.**            | ⚠️ 45 |
| **Environment Variables** | Strongest infrastructure area. Schema ↔ `.env.example` ↔ usage reconcile exactly; build fails on a missing required var; 5 dead vars removed incl. a service-role key. | ✅ 90 |
| **Deployment**            | No `vercel.json`, no `Dockerfile`, no `docker-compose.yml`, no CI, no staging, no backups — all verified absent today.                                                 | 🔴 5  |

**Sharpest finding, and it is not subtle:** the last git commit is
**`b9683e7 Sprint 6: AI image generation`**. **147 files are uncommitted.**
Eighteen sprints of work exist only in a working tree on one disk. This was
flagged as Critical in Sprint 14 when it was 93 files; it is now 147.

**Worker wiring — measured, not assumed:** `grep` for `runTick|claimJobs|worker`
in `services/generation.ts` returns **zero matches**. Generation is still
client-driven. Closing the browser tab still loses the job.

---

# Frontend

| Area                  | State                                                                                                                                                            | Grade |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Landing Page**      | 13 sections, statically prerendered, SEO/JSON-LD/OG complete. `AIModels` generates itself from the engine catalogue — genuinely original. Never seen by a human. | A−    |
| **Dashboard**         | Shell, metrics, quick actions, recent projects, activity feed. Fixture-verified.                                                                                 | A−    |
| **AI Studio**         | Composer, preview, queue, history, modality rail, ⌘K palette, 8 shortcuts, resizable persisted panels. Audio/text present but disabled with stated reasons.      | A−    |
| **Projects**          | Folders, search, favourites, archive, duplicate, autosaving detail page.                                                                                         | A−    |
| **Marketplace**       | Browse, categories, detail, installs, wired into the studio.                                                                                                     | A−    |
| **Community**         | Gallery, trending, posts, likes, comments, follows, public profiles. Opt-in publishing with unpublish.                                                           | B+    |
| **Admin**             | Analytics, revenue, users, credits, moderation queue, audit log, system status.                                                                                  | A−    |
| **Responsive Design** | No horizontal overflow at 375px across all 8 preview routes, enforced in CI-able tests.                                                                          | A     |
| **Accessibility**     | One `h1` per route, no skipped levels, WCAG 2.5.8 hit areas, named controls, no positive `tabIndex`, no `onClick` on `<div>`. All enforced by tests.             | A−    |
| **Animations**        | Motion v12, `reducedMotion="user"` globally, transform/opacity only, `useInView`-gated loops.                                                                    | A     |
| **Design System**     | 41 primitives, three-layer tokens, Tailwind v4 CSS-first, dark mode, live gallery. Zero hardcoded colours, two justified arbitrary values in the whole tree.     | A     |

**The frontend is the strongest part of this project and carries one structural
caveat:** it has been verified through rendered markup, heading structure and
computed geometry — **never through a person's eyes**. A landing page is judged
by eye. That claim cannot be made from here.

**Second caveat:** no component tests exist for the six components added in
Sprints 22–23.

---

# Backend

| Area                      | State                                                                                                                                                                    | Grade |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| **API Architecture**      | 36 route files, one `apiGuard` gate, one error responder, one HTTP client. Guard order is deliberate: CSRF → session → rate limit → user row → **admin** → validation.   | A     |
| **Database Architecture** | Append-only ledger with `balanceAfter` per row; external systems own their own truth; generations and assets deliberately separate. Cascade policy reasoned per FK.      | A     |
| **Queue System**          | `FOR UPDATE SKIP LOCKED`, 5-minute leases, heartbeat scoped by `lockedBy`, retry scheduling, logs that never throw. No-double-claim proven against real Postgres.        | A−    |
| **Background Workers**    | `runTick()` correct and bounded; two concurrent ticks provably safe. **Not wired in, nothing schedules it, never run end to end.**                                       | C     |
| **Provider Manager**      | Retry-then-fallback with full jitter, circuit breaker with half-open probe, family-constrained failover that never falls back to mock, `fellBack` reported to the user.  | A     |
| **Billing**               | Ledger design is the best thing in the project — the _database_ rejects a replayed grant. Checkout/portal/plans written. **Zero Stripe calls.** No tax/dunning/disputes. | C+    |
| **Credits**               | Idempotent, append-only, refund-on-failure, balance cached in the same transaction as the ledger row. Verified against real Postgres.                                    | A−    |
| **Security**              | Rate limiting on every handler, CSRF, enforcing CSP, upload magic-byte sniffing, SSRF allowlist, admin 404-not-401, authenticated worker trigger. Verified over HTTP.    | B+    |
| **Rate Limiting**         | 8 named policies, 12/min on `generate` through 300/min on `read`. 50,000-key cap. **In-memory and per-process** — N instances means N× the limit.                        | C+    |
| **Validation**            | Zod on body and query through one gate; multipart validated more strictly than any JSON route.                                                                           | A     |
| **Logging**               | **30 `console.error` sites. That is the entire strategy.** Worker job logs persist to the database, which is the one bright spot.                                        | D     |
| **Monitoring**            | **None.** No error tracker, no metrics, no alerting, no status page, no dependency scanning.                                                                             | F     |

**The disclosure discipline deserves specific credit.** The admin surface answers
404 — not 401 — to every input shape, method, query and body. That property
survived three separate attempts to break it, including one introduced by this
project's own security sprint (input was parsed before the 404 check, so a
malformed body returned 400 and a well-formed one 404 — two answers is the
disclosure the rule exists to prevent). It was caught and fixed.

---

# AI

| Area                 | State                                                                                                                                                                                                                       | Grade |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Images**           | Full pipeline written: reserve → submit → poll → store → debit → refund on failure. Replicate + OpenAI adapters exist. **All 5 Replicate versions are `PLACEHOLDER_*`** and rejected at submit.                             | 🔴 20 |
| **Videos**           | Same pipeline, duration and camera motion in the studio, playback and download. Same placeholder problem.                                                                                                                   | 🔴 20 |
| **Audio**            | `generateAudio()` **rejects with `UnsupportedOperationError`** — verified in `engine.ts`. Two voice packs catalogued as unusable. Honest, and not implemented.                                                              | 🔴 5  |
| **Text**             | `generateText()` rejects the same way, deliberately _not_ routed through `run` — text debits no credits and produces no asset, so forcing it through the generation pipeline would give it a row it has no business having. | 🔴 5  |
| **Provider Routing** | The strongest design in the codebase. The Sprint 0 contract absorbed all eleven vendors **without modification** — the best available evidence it was right.                                                                | ✅ 90 |
| **Fallback Logic**   | Same family only, never to mock, opt-in, and **reported** so the user is told their generation ran elsewhere. Circuit breaker skips known-dead providers.                                                                   | ✅ 85 |
| **Queue**            | Real and proven under concurrency. Not yet the path generation takes.                                                                                                                                                       | ⚠️ 45 |
| **Cost Tracking**    | Micro-USD integers, written in the same transaction as the status change. `costComplete` gates margin so a partial figure cannot masquerade as a full one.                                                                  | ✅ 75 |
| **Usage Tracking**   | Set-based (`userIds`, not `userId`), so one person, a team or the platform use the same function. Only `SUCCEEDED` counts. Unknown cost is `null`, never zero.                                                              | ✅ 80 |

**The engine/adapter split is the story.** The engine is excellent — roughly 85
if scored alone. The adapters are roughly 15. **Zero vendor calls have ever
occurred**, which means the single most important thing this product does is
entirely unproven.

**Margin is correctly unavailable.** Nine of eleven providers have no cost basis,
so any real period reports `costComplete: false` and no ratio. That is the
engine refusing to give a flattering answer it cannot support — the right
behaviour, and it means the cost engine cannot yet answer the question it was
built for.

---

# Testing

| Layer           | State                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit**        | **256 passing across 17 files.** Rate limiter, CSRF, guard, pricing arithmetic, handle validation, upload sniffing, webhook signing, SSRF filter, retry classification, breaker state machine. |
| **Integration** | Provider manager (retry-before-fallback, family constraints, circuit skipping). Plus four **real-Postgres** suites via PGlite: migrations, schema constraints, worker queue, usage reporting.  |
| **E2E**         | **104 passing, 16 skipped, 0 failing** across Chromium and Pixel 7. Security posture over real HTTP, structural accessibility, responsive sweep, SEO.                                          |
| **Coverage**    | **19.07 % lines** (375/1966), 19.21 % statements, 14.97 % branches, 17.47 % functions. Scoped to `lib/`, `services/`, `utils/`, `features/studio/lib/`.                                        |

### The right 19 % is covered

Money guarantees, access guards, schema constraints, the worker's claim query
and the usage aggregation — the last four against actual Postgres, not mocks.

### What is not covered

`services/community/index.ts` (955 lines), `services/projects.ts` (742),
most of `services/billing`. Every one needs a database, and Prisma cannot be
pointed at PGlite. **This is where the uncovered 81 % lives**, and a
Postgres-backed service harness is the single highest-leverage remaining test
investment.

### The test-integrity finding — read this before trusting any prior report

RC1 discovered that **three checks the previous ten sprints cited as evidence
were not checking anything**:

1. **`playwright.config.ts` never built.** Its own comment said "builds and
   starts the production server"; the command was bare `next start`. The suite
   tested whatever was last left in `.next`. This is the worst direction for a
   harness to fail — nothing goes red, and a fix gets recorded as verified
   against a bundle that does not contain it. **Fixed.**
2. **The tap-target check measured a Clerk error page** — zero controls found,
   zero controls undersized, green since Sprint 13. **Fixed**, and it
   immediately found two real WCAG misses.
3. **The alt-text check has never examined an image.** Not fixable by
   repointing: **every route in the application renders zero `<img>` elements**.
   Kept as a tripwire; listed below as uncovered, not as passing.

**Consequence:** every "verified against `next start`" claim in Sprints 14–23
should be read as "verified against a build made at some earlier point". In
practice most were probably fine. "Probably" is the problem, and it is why test
integrity is scored 45 rather than 65.

**No CI exists.** Verified today: no `.github/workflows`. A 256-test suite that
runs only when somebody remembers is a suite that will stop passing quietly.

---

# Bugs

### Critical (4)

| #   | Bug                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **147 files uncommitted; last commit is Sprint 6.** Eighteen sprints exist on one disk. One bad `git checkout` erases them. Not a code problem; one command; blocks nothing and risks everything.                                 |
| 2   | **No adapter has ever called its vendor.** The product's core function is entirely unproven. Replicate's five model versions are `PLACEHOLDER_*` and unfixable without an account.                                                |
| 3   | **No infrastructure exists.** Database, Clerk, Stripe, R2 and provider keys are all absent. Nothing downstream can be verified until this changes.                                                                                |
| 4   | **The worker is not wired in.** `services/generation.ts` contains zero references to the queue. Generation is still client-driven — closing the tab still loses the job, which the product's own marketing copy says it does not. |

### High (12)

| #   | Bug                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | **`(dev)` route group ships to production.** `/admin-preview` renders the complete admin interface with the gate bypassed. Fixtures only, so no user data leaks — it publishes the design of every internal tool to anyone with the URL. `layout.tsx` sets `noindex` and nothing else. |
| 6   | **No error tracking or structured logging.** 30 `console.error` sites. Every control built in Sprints 15 and 20 logs somewhere nobody reads.                                                                                                                                           |
| 7   | **No CI.** No pipeline, no `npm audit`, no automated checks on push.                                                                                                                                                                                                                   |
| 8   | **Rate limiter and health store are in-memory and per-process.** Behind N instances the effective limit is N×, and a dead provider is rediscovered N times.                                                                                                                            |
| 9   | **Nothing schedules the worker tick.** No cron, no container, no `vercel.json`.                                                                                                                                                                                                        |
| 10  | **No content moderation.** Arbitrary generated imagery publishes to a public, indexable gallery with no scanning and no takedown path.                                                                                                                                                 |
| 11  | **No account deletion or data export.** Cascade rules are correct; nothing triggers them. GDPR erasure and portability unimplemented.                                                                                                                                                  |
| 12  | **No legal pages** — no terms, privacy policy, acceptable-use or takedown policy. Verified absent today.                                                                                                                                                                               |
| 13  | **15 of 31 `findMany` calls are unbounded** (re-counted excluding generated code). Rate limiting bounds how _often_ they are asked for, not how much each returns.                                                                                                                     |
| 14  | **`'unsafe-inline'` in `script-src`.** Removing it needs per-request nonces, which would force the landing page dynamic — a named trade-off, not an oversight.                                                                                                                         |
| 15  | **Core Web Vitals unmeasured.** LCP and FCP unobtainable from this harness; CLS reported zero untrustworthily; INP needs field data.                                                                                                                                                   |
| 16  | **The landing page has never been seen by a person.**                                                                                                                                                                                                                                  |

### Medium (14)

`gpuTimeMs` and token columns exist and nothing writes them (blocked by the
provider interface) · webhook retries have no backoff — five attempts in five
minutes · a cancelled job is **not cancelled at the provider**, so we keep paying
· DNS-rebinding SSRF remains open · `google.ts` result cache is process-local ·
outbound rate limit is one shared 20/min policy for every vendor · public R2
objects are protected only by unguessable keys · `assets.thumbnailKey` exists and
nothing populates it, so galleries serve full-size originals · no dead-letter
handling · webhook secrets remain optional in the env schema · 19 % coverage with
the service layer uncovered · no component tests for six Sprint 22–23 components
· no organisation entity, so set-based usage reporting has nothing to roll up to
· cost figures never reconciled against a vendor invoice.

### Low (6)

Fixed five-minute lease for every job regardless of expected duration · panel
resizing is desktop-only (`xl`+) · the alt-text tripwire has never examined an
image because the app ships zero `<img>` · `jsonOut` is built and applied nowhere
· no `pg_trgm` index, so `contains` search is a sequential scan · `/studio` at
297 kB and `/settings` at 298 kB, both dominated by Clerk's client SDK.

---

# Missing Before Launch

Every remaining blocker, ordered so each unblocks the next.

**Tier 1 — nothing else can be verified until these exist**

1. Commit the working tree. 147 files, eighteen sprints, one command.
2. Provision Postgres (both connection strings), Clerk, Stripe test mode, R2, and
   at least one provider key.
3. `npx prisma migrate deploy` — **not** `migrate dev`, which would try to create
   a fifth migration.
4. Work the `docs/LAUNCH.md` first-run list: sign up and confirm the user row
   _and_ the signup grant; generate and confirm the debit, the R2 write and the
   asset row; force a failure and confirm exactly one refund; **then redeliver a
   Stripe webhook and confirm it grants nothing.** That last check is proven at
   the database level and has never been run against real Stripe.

**Tier 2 — required for a closed beta**

5. Real Replicate version hashes and cost bases; at least two providers working
   end to end.
6. Cut `services/generation.ts` over to the worker, then schedule the tick. Only
   then is closing the browser tab actually safe.
7. Remove the `(dev)` route group from production builds — eight routes, one
   layout guard.
8. CI running `npm run verify` and `npm run test:e2e` on every push.
9. Error tracking and structured logging.
10. Redis behind `RateLimitStore` and `HealthStore` — both interfaces exist
    precisely so this is one implementation and no call-site changes.

**Tier 3 — required to open to the public**

11. Content moderation on generation and on publish.
12. Account deletion and data export.
13. Terms of service, privacy policy, acceptable-use policy, takedown path.
14. Backups with a tested restore, load test, incident runbook, status page.
15. Service-layer test coverage on a Postgres-backed harness.
16. **Have a person look at the product.**

---

# Launch Checklist

Everything required before public release.

### Infrastructure

- [ ] Working tree committed and pushed to a remote
- [ ] Postgres provisioned; `DATABASE_URL` and `DIRECT_URL` set
- [ ] `prisma migrate deploy` applied all four migrations
- [ ] Backups configured and a restore actually tested
- [ ] Clerk instance live; keys, webhook endpoint and signing secret set
- [ ] Stripe products, prices, webhook endpoint, signing secret
- [ ] R2 bucket, credentials, CORS
- [ ] At least two provider keys with real model versions and cost bases
- [ ] Staging environment mirroring production
- [ ] Redis provisioned; both in-memory stores swapped
- [ ] Worker scheduled (cron, queue consumer or long-running process)

### Correctness

- [ ] Sign up once — user row **and** signup grant both present
- [ ] Generate once — debit, R2 write, asset row all present
- [ ] Force a failure — exactly one refund, no double credit
- [ ] **Redeliver a Stripe webhook — confirm it grants nothing**
- [ ] Subscribe, upgrade, downgrade, cancel — all four lifecycle paths
- [ ] Close the browser mid-generation — job still completes
- [ ] Two concurrent generations against a balance covering one

### Quality gates

- [ ] CI green on every push: typecheck, lint, format, unit, E2E
- [ ] E2E re-run with `E2E_CLERK_LIVE=1` — all 120 pass, zero skips
- [ ] Coverage floor set at current level so it cannot regress
- [ ] Lighthouse against the deployed page; LCP, INP, CLS recorded
- [ ] Load test at expected peak

### Security and compliance

- [ ] `(dev)` route group excluded from the production build
- [ ] Error tracking live and alerting to somebody
- [ ] Content moderation on generation and publish
- [ ] Account deletion and data export working
- [ ] Terms, privacy policy, acceptable-use policy, takedown path published
- [ ] `npm audit` clean in CI
- [ ] Webhook secrets asserted required at runtime in production
- [ ] Incident runbook and status page

### Product

- [ ] A person has used every surface on a real device
- [ ] Onboarding / first-run experience exists
- [ ] Support path exists

---

# Final Grade

| Dimension           | Grade  | Justification                                                                                                                                                                                                                        |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Architecture**    | **A−** | The provider contract absorbed eleven vendors without modification. Authorisation lives with the resource. Money is integers in an append-only ledger. Held back only by the unfinished worker cutover leaving two generation paths. |
| **Frontend**        | **A−** | Six complete surfaces, 41 primitives, enforced accessibility, zero token bypasses. Held back by never having been seen and having no component tests.                                                                                |
| **Backend**         | **B+** | One guard, one error responder, one HTTP client, deliberate check ordering. Held back by the dual generation path, 15 unbounded queries, and logging that is `console.error`.                                                        |
| **Database**        | **A**  | 17 tables, 4 migrations, 50+ behavioural assertions against real Postgres. Constraints _proven_, not argued. The one deduction: `migrate deploy` remains a genuine first.                                                            |
| **Security**        | **B+** | Comprehensive and verified over real HTTP; the 404-not-401 discipline survived three attempts to break it. Held back by the per-process limiter, `unsafe-inline`, `(dev)` shipping, and no moderation.                               |
| **Performance**     | **C+** | Every choice is defensible — static render, gated animation, transform-only motion, `GROUP BY` instead of JS loops. **None of it is measured.** An unmeasured performance posture is a hypothesis.                                   |
| **Scalability**     | **C**  | Two per-process stores, an unscheduled worker, 15 unbounded queries, no caching layer, no load test. The interfaces to fix all of it exist; none is implemented.                                                                     |
| **Maintainability** | **A**  | 51 recorded decisions, ~4,500 lines of documentation, consistent idiom throughout, one duplicate function in the entire tree. Reports that correct their own earlier claims.                                                         |

## Overall Grade — **C+**

**This is an A− codebase with an F operational posture, and a production
readiness review is obliged to grade the second.**

The engineering here is genuinely better than most production systems I would
review. The provider abstraction is right. The ledger's guarantees are proven
against actual Postgres rather than asserted in a comment. Authorisation is
attached to resources instead of a middleware matcher that drifts. The
documentation explains _why_, and — unusually — corrects itself when an earlier
claim turns out to be unsupported.

And none of it has ever run. There is no database, nothing has authenticated, no
payment has been taken, no image has been generated, and the last eighteen
sprints are not in version control. A system that has never executed has an
unknown defect count, not a low one — and RC1 demonstrated exactly that by
finding three separate checks that had been reporting success while examining
nothing.

**The gap between "the suite is green" and "the thing works" is the entire
distance remaining.** Closing it requires a database, a Clerk key, a provider
key, a scheduler, an error tracker, a lawyer and a person's eyes. It does not
require more application code, and writing more would not move any score in this
report.

**Recommendation: do not launch. Commit the tree today, provision infrastructure
this week, and re-audit after the `docs/LAUNCH.md` first-run list has actually
been executed.** That single exercise will produce more information about this
system's real quality than the last ten sprints combined.
