# Atheos — Project Status Audit

**Date:** 2026-08-04 · **Sprints 0–21 complete**
**Sources:** every report in the repository — `PROJECT_AUDIT.md`,
`INFRASTRUCTURE_REPORT.md`, `SECURITY_REPORT.md`, `PERFORMANCE_REPORT.md`,
`TEST_REPORT.md`, `AI_ENGINE.md`, `AI_PROVIDER_REPORT.md`, `WORKER_REPORT.md`,
`COST_ENGINE_REPORT.md`, plus `docs/LAUNCH.md`, `ROADMAP.md` and
`docs/DECISIONS.md` (51 recorded decisions).

Numbers below were re-measured against the codebase today, not carried forward
from the reports that first stated them.

---

> ## The one sentence that governs every score
>
> **Atheos has still never run against real infrastructure.** No database, no
> Clerk instance, no Stripe account, no AI provider key, no storage bucket. In
> twenty-one sprints, not one generation, payment, sign-up or provider call has
> executed.
>
> Everything below distinguishes **built**, **verified here**, and **proven
> against a real dependency**. Only the first two have ever happened.

---

# 1. Overall completion — **67 %**

Weighted by what it takes to charge a customer, not by feature count.

| Area                                                   | Weight | Complete | Contribution |
| ------------------------------------------------------ | ------ | -------- | ------------ |
| UI surface and design system                           | 20 %   | 92 %     | 18.4         |
| Application features (studio → admin)                  | 25 %   | 85 %     | 21.3         |
| Data model and migrations                              | 10 %   | 95 %     | 9.5          |
| Server pipeline (generation, credits, storage, worker) | 15 %   | 75 %     | 11.3         |
| Billing and identity **integration**                   | 10 %   | 30 %     | 3.0          |
| Infrastructure (provisioning, CI, deploy, scheduling)  | 10 %   | 10 %     | 1.0          |
| Testing and observability                              | 10 %   | 25 %     | 2.5          |
|                                                        |        |          | **67.0 %**   |

Up from **62 %** at the Sprint 13 audit. The eight-point gain came almost
entirely from migrations, tests and the worker — not from features, because no
features were added after Sprint 12.

The remaining 33 % is concentrated in three rows that **cannot be closed by
writing more application code**.

---

# 2. Production readiness — **40 / 100**

| Component               | Score | Why                                                            |
| ----------------------- | ----- | -------------------------------------------------------------- |
| Schema deployability    | 90    | 4 migrations, chain verified against real Postgres             |
| Configuration hygiene   | 90    | Every variable read by something; build fails on a missing one |
| Integration correctness | 60    | Two silent webhook bugs fixed; no vendor ever called           |
| Testing                 | 40    | 255 tests, 19 % coverage, no CI                                |
| Observability           | 10    | `console.error` only                                           |
| Deployment automation   | 5     | No CI, no cron, no `vercel.json`                               |
| Live infrastructure     | 0     | Unchanged since Sprint 0                                       |

Sprint 14 reported 45. **This is lower, deliberately.** That figure predated
three discoveries: the worker is built but not wired, nothing schedules it, and
the dev route group still ships. Readiness did not fall — the measurement got
more honest.

---

# 3. Infrastructure readiness — **35 / 100**

**Real:** four migrations, all applied in order to real Postgres (PGlite) and
asserted. Env layer validates at build time and fails on a missing required
variable. Security headers, cache policy and an enforcing CSP verified on a
live `next start`. Production build clean; server boots in 658 ms.

**Absent:** a provisioned database, CI, a deployment pipeline, a staging
environment, backups, monitoring, and anything that schedules the worker. There
is no `vercel.json` and no container definition.

**Sharp edge:** the last git commit is **Sprint 6**. Sprints 7–21 exist only in
the working tree.

---

# 4. AI Engine readiness — **45 / 100**

Two very different halves.

**The engine: ~85.** Provider Manager with retry-then-fallback, a circuit
breaker with a half-open probe, a normalised error contract, cost estimation,
and an eight-function facade — all tested (43 tests). The Sprint 0 provider
contract absorbed all eleven vendors **without modification**, which is the
strongest available evidence it was designed correctly.

**The adapters: ~15.** Three exist (OpenAI, Replicate, Google Gemini); eight do
not. **None has ever called its vendor.** All five Replicate model versions are
still `PLACEHOLDER_*` and rejected at submit — unfixable without an account.

|                                    | Count |
| ---------------------------------- | ----- |
| Providers in the catalogue         | 11    |
| `implemented` (reachable)          | **2** |
| `declared` (unreachable by design) | 9     |
| Adapters that have called a vendor | **0** |

---

# 5. Billing readiness — **40 / 100**

**The design is the strongest thing in the project.** An append-only ledger
with `balanceAfter` on every row and a unique `idempotencyKey`; the database
rejects a replayed grant rather than application logic somebody might forget.
Verified against real Postgres.

Sprint 21 closed the cost gap: `costMicroUsd`, `gpuTimeMs`, `imageCount`,
`videoSeconds`, `audioSeconds` are written inside the same transaction as the
status change, and daily/monthly/margin reporting is verified.

**What stops it being useful:**

- **Zero Stripe API calls, ever.** Checkout, portal, plan changes, invoices —
  all written, none executed.
- **Webhook idempotency is proven at the database level and untested against
  real Stripe.** `docs/LAUNCH.md` calls redelivering a webhook the single most
  important check in the project. It has not been done.
- **Margin is unavailable in practice.** Nine of eleven providers have no cost
  basis, so any real period reports `costComplete: false` and no ratio. That is
  correct behaviour, and it means the engine cannot yet answer the question it
  was built for.
- No tax handling, no dunning, no dispute/chargeback handling.

---

# 6. Authentication readiness — **55 / 100**

**Architecturally the second-strongest area.** Clerk 7 with custom flows;
authorisation lives with the resource, not in a middleware matcher; every
per-user query is scoped by `userId` in its `where`; mutations use `updateMany`
scoped by owner so a wrong id affects zero rows rather than someone else's.

Six duplicated `requireApiUser()` implementations were collapsed into one in
Sprint 15 — that check is now written once.

**Verified over real HTTP:** 401 on every authenticated endpoint anonymous;
404 — not 401 — across the entire admin surface regardless of method, query or
body shape.

**Absent:** nothing has ever authenticated. The Clerk webhook has never fired,
and without `CLERK_WEBHOOK_SIGNING_SECRET` a sign-up creates no user row. No
MFA, no organisations, no account deletion or data export.

---

# 7. Database readiness — **70 / 100**

**The highest score, and it is earned.**

|                                              |                                                   |
| -------------------------------------------- | ------------------------------------------------- |
| Tables                                       | 17 (16 baseline + `generation_logs`)              |
| Enums                                        | 11                                                |
| Foreign keys                                 | 22, cascade/set-null policy deliberate throughout |
| Migrations                                   | 4, chain-applied in order and asserted            |
| Behavioural assertions against real Postgres | 50+                                               |

What is proven, not argued: a replayed webhook event id is rejected by the
primary key; a reused credit `idempotencyKey` is rejected while a null one is
not; deleting a generation **nulls** its ledger row rather than removing it;
deleting a user cascades all six owned tables; `FOR UPDATE SKIP LOCKED` gives
two concurrent workers disjoint job sets with no work lost.

**Absent:** it has never been applied to a real database by Prisma's own
migration machinery. Eight of thirty `findMany` calls remain unbounded (all
bounded by their caller's already-paginated input, which is a real distinction
and not verified by anything). No `pg_trgm` search index. No backups.

---

# 8. Security readiness — **80 / 100**

Up from 66 at the audit.

**Closed:** rate limiting — the audit's most severe finding, with no mitigating
control at all — now covers **all 53 route handlers** via one gate. CSRF by
`Sec-Fetch-Site`/`Origin`, refusing requests carrying neither. CSP now
**enforcing**, not Report-Only. Upload hardening: size checked before the buffer
is allocated, and magic bytes must agree with the declared type. SSRF guard on
outbound webhooks with `redirect: "manual"`. Signed webhook delivery. An
authenticated worker trigger that 404s rather than 401s.

**A leak found in this project's own work:** admin routes parsed input _before_
the 404 check, so a malformed body returned 400 and a well-formed one 404 — two
answers is the same disclosure the rule exists to prevent. Authorisation now
runs before validation.

**Open:** the rate limiter is in-memory and per-process. `'unsafe-inline'`
remains in `script-src`. The `(dev)` route group — including `/admin-preview`,
which renders the admin interface with the gate bypassed — **still ships to
production**. No content moderation on a product that publishes generated
imagery publicly. No account deletion or export. No error tracking, so none of
the 403s and 429s now being logged can be seen.

---

# 9. Testing readiness — **40 / 100**

From **0** at the audit.

|                        |                                |
| ---------------------- | ------------------------------ |
| Tests passing          | **255** across 17 files        |
| Line coverage (scoped) | **19.31 %**                    |
| E2E                    | 97 specs; **8 known failures** |
| CI                     | **None**                       |

Scope is `lib/`, `services/`, `utils/`, `features/studio/lib/` — excluding
generated Prisma output and all UI. Measured against the whole repository it
would be lower.

**The right 19 % is covered:** rate limiter, CSRF, the guard, pricing
arithmetic, handle validation, upload sniffing, webhook signing, the SSRF
filter, the schema's constraints, the worker's claim query, and the usage
aggregation — the last four against real Postgres.

**Uncovered:** `services/community/index.ts` (955 lines), `services/projects.ts`
(742), most of `services/billing`. Every one needs a database, and Prisma
cannot be pointed at PGlite.

Eight E2E tests fail. **Four are real findings** — including a genuine
`h1 → h3` heading skip on `/studio-preview` — and were left failing rather than
weakened.

---

# 10. Performance readiness — **50 / 100**

**Done:** five raw `<img>` tags replaced with `next/image` and correct `sizes`
(the audit's biggest available win); the admin daily series moved from a
per-row JavaScript loop into `date_trunc` + `GROUP BY`, verified identical
against real Postgres; `content-visibility` on three galleries, confirmed live;
a progress bar moved from animating `width` (layout every frame) to composited
`scaleX`; 22 of 30 queries bounded.

**The honest result:** JS went **up** 5–6 kB on seven routes — `next/image`'s
runtime. The trade is sound (6 kB against image bytes 10–100× larger) and
**unmeasured**, because no fixture supplies a cover image so no `<Image>` has
ever rendered.

**Core Web Vitals: not measured.** LCP and FCP could not be obtained from the
harness; CLS reported 0 and is untrusted for the same reason; INP needs field
data. Real numbers need a database, seeded content and real image URLs.

**Open:** no thumbnails (`assets.thumbnailKey` exists and nothing writes it), no
video posters or range requests, `contains` search still a sequential scan, no
caching layer, `/settings` at 298 kB is Clerk client-SDK weight.

---

# Completed

- **Design system** — 41 UI primitives, three-layer tokens, dark mode, live gallery
- **Landing page** — 13 sections, SEO, JSON-LD, OG image generation
- **Authentication UI** — custom Clerk flows: sign-in, sign-up, OTP, reset, OAuth
- **Dashboard, Studio, Projects, Marketplace, Community, Admin** — all six product surfaces built
- **Image + video generation pipeline** — submit, poll, debit, store, refund
- **Credit ledger** — append-only, idempotent, DB-verified
- **Database schema** — 17 tables, 4 migrations, verified against real Postgres
- **Security layer** — rate limiting on all 53 handlers, CSRF, enforcing CSP, upload hardening
- **AI engine architecture** — manager, retry, circuit breaker, cost model, facade
- **Worker queue** — atomic claim, leases, retry scheduling, persisted logs, signed webhooks
- **Cost engine** — per-generation cost and units, daily/monthly/margin reporting
- **Test suite** — 255 tests, Vitest + Playwright + real-Postgres integration
- **Documentation** — 51 recorded decisions, ~4,500 lines across 17 documents

# Partially Complete

| Item                  | Built                                        | Missing                                                                       |
| --------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| **AI providers**      | Engine + 3 adapters                          | 8 adapters; **none has called a vendor**; Replicate versions are placeholders |
| **Background worker** | Queue, leases, retries, logs, webhooks       | **Not wired into `services/generation.ts`**; nothing schedules the tick       |
| **Billing**           | Ledger, checkout, portal, plans, cost engine | Zero Stripe calls; no tax, dunning or disputes; margin unavailable            |
| **Testing**           | 255 tests, real-Postgres suites              | 19 % coverage; no CI; 8 failing E2E                                           |
| **Performance**       | Images, queries, rendering                   | Unmeasured; no thumbnails; 8 unbounded queries                                |
| **Cost tracking**     | Cost, GPU time, image/video/audio units      | `gpuTimeMs` and tokens never written — no interface field to carry them       |
| **Observability**     | Persisted job logs                           | No error tracking, no metrics, no alerting                                    |

# Not Started

- **Live infrastructure** — database, Clerk, Stripe, R2, provider keys
- **CI/CD** — no pipeline, no automated checks, no deploy automation
- **Audio generation** — third modality; two voice packs catalogued as unusable
- **Organisations / teams** — no model, no membership; reporting is set-based and ready
- **Content moderation** — nothing scans generated or published imagery
- **Account deletion and data export** — cascade rules correct, nothing triggers them
- **Legal pages** — no terms, privacy, acceptable-use or takedown policy
- **Asset library** — no cross-project browsing
- **Onboarding** — no first-run experience
- **Thumbnailing** — column exists, pipeline does not
- **Backups, load testing, incident runbook, status page**

---

# The 10 highest-priority tasks before public launch

Ordered so each unblocks the next. Items 1–4 are prerequisites for _any_
launch; 5–8 are prerequisites for a _public_ one.

### 1. Commit the working tree

The last commit is **Sprint 6**. Fifteen sprints exist only on disk. One bad
`git checkout` erases everything. It is one command, and until it is done every
other item is at risk.

### 2. Provision infrastructure and run `prisma migrate deploy`

Postgres (both connection strings), Clerk, Stripe test mode, R2, one provider
key. Then apply the four migrations — **not** `migrate dev`, which would try to
create a fifth. Nothing else on this list can be verified until this exists.

### 3. Work the `docs/LAUNCH.md` first-run list

Sign up and confirm the user row _and_ signup grant. Generate against the mock
provider and confirm the debit, the R2 write and the asset row. Force a failure
and confirm exactly one refund. **Then redeliver a Stripe webhook and confirm it
grants nothing** — the single most important check in the project, proven at
the database level and never against real Stripe.

### 4. Wire the worker and schedule it

`services/generation.ts` still drives jobs from the client — the gap flagged
since Sprint 7 and the reason Sprint 20's report says "workers are complete"
would be a misreading. Cut over to `runTick`, add a cron, and **only then** is
closing the browser tab safe.

### 5. Remove the `(dev)` route group from production builds

`/admin-preview` renders the complete admin interface with the gate bypassed.
Fixture data, so no user data leaks — but it publishes the design of every
internal tool to anyone who requests the URL. Eight routes, one layout guard.

### 6. Add CI

`npm run verify` plus `npm run test:e2e` on every push. Without it the 255 tests
run only when somebody remembers, and a suite that stops passing quietly is
worse than no suite. Fix the four real E2E failures in the same pass.

### 7. Error tracking and structured logging

`console.error` is still the entire strategy. There is no way to see an attack,
a rising retry rate, a webhook failing repeatedly, or a refund storm. Every
control added in Sprints 15 and 20 logs to somewhere nobody reads.

### 8. Content moderation, account deletion and legal pages

A product that generates arbitrary imagery and publishes it to a public
indexable gallery cannot open to strangers without automated scanning and a
takedown path. GDPR erasure and portability are unimplemented — the cascade
rules are correct and nothing triggers them. No terms, no privacy policy.

### 9. Redis behind `RateLimitStore` and `HealthStore`

Both are in-memory and per-process. Behind N instances the effective rate limit
is N× the configured one, and a dead provider is discovered N times instead of
once. Both interfaces exist precisely so this is one implementation and no call
site changes.

### 10. Make at least three providers actually work

Real Replicate version hashes, a real key exercised end to end, and cost bases
for whatever runs. Until this lands the studio can only produce mock output, and
the cost engine correctly refuses to report a margin because nine of eleven
providers are unpriced.

---

## Closing assessment

Atheos is an unusually well-architected codebase with unusually thorough
documentation, and **it has never been switched on**.

Its strengths are real and unusual: the provider abstraction absorbed eleven
vendors without changing; the credit ledger's guarantees are proven against
actual Postgres rather than asserted; authorisation lives with the resource;
the 404-not-403 discipline survived three separate attempts to break it,
including one of my own.

Its weakness is singular. **Every one of the ten items above except the first
is blocked, directly or indirectly, on infrastructure that does not exist.**
That has been true since the Sprint 13 audit, and eight sprints of genuinely
valuable work have not changed it — because no amount of further building can.

The honest summary is unchanged from where it started: _a complete, coherent,
carefully-reasoned implementation that has never met reality._ The difference
now is that the schema, the security controls, the worker queue and the cost
engine have each been proven correct in isolation. What remains is to find out
whether they are correct together, and that requires a database.
