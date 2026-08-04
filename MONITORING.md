# Monitoring — Sprint 25

**Scope:** Phase 8. Error tracking, logging, analytics, performance, uptime.
**Current state: 10 / 100.**

---

## The gap, stated plainly

**There is no observability of any kind.** 30 `console.error` sites and nothing
else — no error tracker, no metrics, no alerting, no uptime check, no analytics.

This matters more here than in most products, because of what was built in
Sprints 15 and 20. Rate limiting, CSRF refusals, circuit-breaker trips, webhook
failures, refund paths and retry storms are all implemented, all correct, and
**all log to somewhere nobody reads**. Every control the security work added is
currently invisible.

Three specific things you cannot see today:

1. **A provider burning money.** A retry loop against a failing vendor is
   indistinguishable from normal operation.
2. **A webhook failing repeatedly.** Stripe retries, our handler 500s, credits
   are never granted, and the customer emails you first.
3. **The queue backing up.** Jobs stay QUEUED, the tick fails silently, and the
   first signal is a user asking where their image went.

The one bright spot: **worker job logs persist to `generation_logs`**, so
per-job history survives in the database. That is real, and it is per-job — not
a view of the system.

---

## Recommended stack

Chosen for a Vercel + Next.js + Prisma product at pre-launch scale. Everything
below has a free tier adequate for a closed beta.

| Concern                    | Recommendation                      | Why this one                                                                                                                                        |
| -------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Error tracking**         | **Sentry** (`@sentry/nextjs`)       | Best Next.js App Router support: server, client and edge in one SDK, with source maps and release tracking wired to Vercel deploys.                 |
| **Logging**                | **Axiom** or **Better Stack**       | Both have a native Vercel log drain — no code change, structured logs from day one.                                                                 |
| **Analytics**              | **Vercel Analytics** + **PostHog**  | Vercel Analytics is one line and privacy-friendly. PostHog when you need funnels — which for this product means _signup → first generation → paid_. |
| **Performance monitoring** | **Vercel Speed Insights**           | Real-user LCP/INP/CLS. `PERFORMANCE_AUDIT.md` grades performance unmeasured; this is what closes it.                                                |
| **Uptime**                 | **Better Stack** or **UptimeRobot** | External probes. A monitor hosted on the platform you are monitoring tells you nothing when the platform is down.                                   |

### Install order

Sentry first. It is the one that turns an invisible failure into a message, and
until it exists everything else is decoration.

---

## Sentry — what to configure beyond the defaults

The default install captures exceptions. These four make it useful here:

**1. Scrub the payloads that carry secrets.** `beforeSend` should drop
`authorization`, `svix-*`, `stripe-signature` headers and any body from
`/api/webhooks/*`. A webhook body contains customer PII and a signature header
is a credential.

**2. Tag by provider and job id.** Every AI failure should carry
`provider`, `modelId` and `generationId` as tags. Without them a spike in errors
tells you something is wrong; with them it tells you _Replicate is down_.

**3. Do not swallow the 404s.** The admin surface and worker tick return 404 by
design to unauthenticated callers. Those must **not** be reported as errors, or
the signal drowns. Filter on status, not on route.

**4. Wire releases to Vercel.** `SENTRY_RELEASE` from
`VERCEL_GIT_COMMIT_SHA` makes "which deploy broke this" a lookup rather than an
investigation.

---

## What to alert on

Alerts should be few enough that people read them. These five, in priority
order:

| Alert                               | Why it is first-tier                                                   |
| ----------------------------------- | ---------------------------------------------------------------------- |
| **Webhook handler returning 5xx**   | Money. A failed Stripe webhook is a customer who paid and got nothing. |
| **Queue depth rising for > 10 min** | The tick is dead, or a provider is. Both are invisible otherwise.      |
| **Refund rate spike**               | Generations failing en masse — the provider changed something.         |
| **Circuit breaker opened**          | A provider is down. You want to know before the support email.         |
| **429 rate climbing on `generate`** | Either abuse, or the rate limiter is doing its job under real load.    |

Deliberately **not** first-tier: 404s (by design), 401s (normal), and CSRF 403s
(the control working). Alerting on those trains people to ignore alerts.

---

## Health endpoint

There is no `/api/health`, and one should exist before uptime monitoring is
meaningful. Probing `/` tells you Vercel is up, which is what Vercel's own
status page already tells you.

A useful one checks the dependencies that actually fail: `SELECT 1` against
Postgres, and the worker's last successful tick timestamp. It must not require
auth, must not leak version or configuration detail, and must be excluded from
rate limiting or the monitor will trip it itself.

Adding it is a small route, and it is **not** in this sprint's scope — Sprint 25
was explicitly "no new features". Flagging it as the one piece of monitoring
infrastructure the codebase is missing rather than the vendor.

---

## Cost note

At pre-launch volume every recommendation above sits inside a free tier. The one
that will bite first is log ingestion: Vercel's function logs are verbose, and a
per-minute cron writes a line every minute forever. Set a retention policy when
you configure the drain, not after the first bill.

---

## Honest assessment

Monitoring is the **largest single gap between this codebase and a production
system**, and unlike most gaps in this project it is not blocked on
infrastructure decisions or third-party accounts — Sentry is an afternoon.

The reason it matters so much here is specific: this product spends money on
every generation. A silent failure in a normal CRUD app produces an annoyed
user. A silent failure here produces a provider bill with nobody watching it.
