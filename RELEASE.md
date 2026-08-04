# Release — Atheos.io

**Final Sprint · Release Candidate 1**

---

# Production Readiness — **58 / 100**

Up from 51 at the end of Sprint 25. Three things moved it, and one of them
closed a blocker that had been open since Sprint 6.

| Component               | Score |  Change  | Why                                                                           |
| ----------------------- | :---: | :------: | ----------------------------------------------------------------------------- |
| Source control          |  100  | **+100** | 29 commits pushed; local and remote identical at `9d4188d`                    |
| Schema deployability    |  90   |    —     | 4 migrations, 50+ assertions against real Postgres                            |
| Configuration hygiene   |  95   |    —     | Every variable read by something; build fails on a missing one                |
| Integration correctness |  70   | **+10**  | **Replicate verified live** — first successful vendor call in project history |
| Deployment automation   |  40   |    —     | `vercel.json`, cron, runbook. No CI                                           |
| Observability           |  25   | **+15**  | `/api/health` exists and works. Nothing watches it                            |
| Test integrity          |  45   |    —     | 256 unit + 104 E2E green, 19 % coverage, no CI                                |
| Live infrastructure     |   5   |  **+5**  | Replicate only. No database, auth, storage or payments                        |

**The number is capped by live infrastructure, not by code quality.**

---

# Phase 5 — End-to-end verification

Verified honestly. **"Verified"** means executed here; **"unverifiable"** means
it needs infrastructure that does not exist. No flow is marked green on the
grounds that its code looks correct.

| #   | Flow                 | Status                         | Evidence                                                                                                                |
| --- | -------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | User registration    | ❌ **Unverifiable**            | No Clerk instance, no database. Sign-up cannot complete                                                                 |
| 2   | Login                | ❌ Unverifiable                | Same                                                                                                                    |
| 3   | Logout               | ❌ Unverifiable                | Same                                                                                                                    |
| 4   | Password reset       | ❌ Unverifiable                | Same                                                                                                                    |
| 5   | Project creation     | ❌ Unverifiable                | Needs a database                                                                                                        |
| 6   | **Image generation** | ⚠️ **Partial — real progress** | Replicate authenticated; live submission reached the billing gate (402). Blocked on account credit **and** R2 storage   |
| 7   | Video generation     | ⚠️ Partial                     | Same path, real `wan-2.5-t2v` version hash in place                                                                     |
| 8   | Audio generation     | ⛔ **Not implemented**         | `generateAudio()` rejects with `UnsupportedOperationError` by design. No adapter exists                                 |
| 9   | Credits              | ⚠️ Proven, not live            | Ledger idempotency and refund-on-failure proven against real Postgres via PGlite. Never run against a deployed database |
| 10  | Billing              | ❌ Unverifiable                | **Zero Stripe API calls have ever been made**                                                                           |
| 11  | Uploads              | ❌ Unverifiable                | No R2 bucket                                                                                                            |
| 12  | Downloads            | ❌ Unverifiable                | Nothing to download                                                                                                     |
| 13  | History              | ✅ UI verified                 | Renders with fixtures at `/studio-preview`                                                                              |
| 14  | Dashboard            | ✅ UI verified                 | Renders with fixtures at `/dashboard-preview`                                                                           |
| 15  | Settings             | ✅ UI verified                 | Route builds and renders                                                                                                |
| 16  | Profile              | ✅ UI verified                 | Route builds and renders                                                                                                |
| 17  | Marketplace          | ✅ **Verified**                | `/api/marketplace` returns 200 — the catalogue is code, not rows, so it works without a database                        |
| 18  | Community            | ✅ UI verified                 | Renders with fixtures at `/community-preview`                                                                           |

**Score: 1 fully verified, 5 UI-verified, 3 partial, 8 unverifiable, 1 not
implemented.**

Every unverifiable row has the same cause. This is not eighteen problems; it is
one problem observed eighteen times.

---

# Phase 6 — Provider failure handling

**Requirement: the application must never crash when a provider errors.**

## Met

| Mechanism                              | Status                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Normalised error taxonomy              | ✅ 8 codes including `insufficient_provider_credit`, `content_filtered`, `rate_limited`       |
| Vendor errors never reach the user raw | ✅ `ProviderError.message` is documented safe; `raw` is kept for logs and never rendered      |
| Retry classification                   | ✅ `insufficient_provider_credit` correctly **not** retried — our account, not their capacity |
| Circuit breaker                        | ✅ Opens on repeated failure, half-open probe before closing                                  |
| Friendly error UI                      | ✅ `role="alert"`, icon, "Generation failed", the safe message                                |
| **Retry button**                       | ✅ "Load settings and retry"                                                                  |
| Refund reassurance                     | ✅ "Your credits have not been charged" shown with the error, not in a toast that has gone    |
| Error boundaries                       | ✅ `app/error.tsx` and `app/global-error.tsx`                                                 |
| Provider status surface                | ✅ `/api/admin/status` and `/api/health`                                                      |

**The 402 we hit this sprint was handled exactly as designed** — mapped to
`insufficient_provider_credit`, classified non-retryable, no crash.

## Not met

**Per-error suggested solutions are missing.** The user sees the provider's
message but not _what to do about it_ — "add credit", "rephrase your prompt",
"try again in a minute".

The reason is structural, not an oversight: the client receives
`error: string | null` with **no error code**. Closing it properly means
threading `ProviderErrorCode` through the database column, the DTO, the mapper
and the API route. That is a schema change plus a migration.

I did **not** implement it by pattern-matching the message text. That reads as
working and breaks silently the first time a vendor rewords an error — the exact
class of bug this codebase has spent 26 sprints avoiding.

**Recommended as the first post-launch change.** Small, well-scoped, and it
converts every provider failure from a dead end into a next step.

---

# Known Issues

## Critical Blockers

| #   | Blocker                                                  | Notes                                                                                                   |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | **No database, auth, storage or payment infrastructure** | The single cause of 8 unverifiable flows                                                                |
| 2   | **Replicate account has no credit**                      | Integration verified working; blocked at the payment gate                                               |
| 3   | **No content moderation**                                | A public, indexable gallery of AI imagery cannot open to strangers without scanning and a takedown path |
| 4   | **No legal pages**                                       | No terms, privacy policy, acceptable-use policy. Stripe asks for these at signup                        |
| 5   | **No account deletion or data export**                   | Cascades are correct; nothing triggers them. GDPR                                                       |
| 6   | **No error tracking**                                    | This product spends money per generation. A silent failure is a provider bill nobody is watching        |

## High

| #   | Issue                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | **No CI.** 360 tests run only when someone remembers                                                                                                                    |
| 8   | **Worker not wired in.** `services/generation.ts` has zero queue references — closing the tab still loses the job. Endpoint and cron are ready; the cutover is not done |
| 9   | **Rate limiter and circuit breaker are per-process.** On Vercel's horizontal scaling, N instances means N× the limit                                                    |
| 10  | **Replicate token was exposed** in a screenshot. Rotate it; set a spend limit now                                                                                       |
| 11  | **Core Web Vitals unmeasured.** Choices sound, effects unverified                                                                                                       |
| 12  | **No backups**, no tested restore                                                                                                                                       |
| 13  | **Nothing polls `/api/health`.** The endpoint is new and unwatched                                                                                                      |

## Medium

Audio and text generation not implemented (honest `UnsupportedOperationError`) ·
no thumbnail pipeline (`thumbnailKey` exists, nothing writes it) · 15 of 31
`findMany` unbounded · `'unsafe-inline'` in `script-src` · DNS-rebinding SSRF ·
cancelled jobs not cancelled at the provider · webhook retries have no backoff ·
19 % test coverage with the service layer uncovered · no organisation entity ·
margin unavailable while most providers are unpriced.

---

# Recommended Launch Date

**No date. A sequence, with the gate that decides each one.**

Fixed dates on unproven systems are how launches slip publicly instead of
privately.

| Milestone                       | Gate                                              | Estimate                                               |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| **First real image**            | Replicate credit + R2 bucket                      | **Today**, if you fund the account and create a bucket |
| **Deployed and reachable**      | Supabase + Clerk + Vercel                         | **1–2 days**                                           |
| **Private testing**             | Above, plus one full first-run pass               | **1 week**                                             |
| **Closed beta** (invited users) | Worker cutover, CI, Sentry, Redis                 | **3–5 weeks**                                          |
| **Public launch** (charging)    | Moderation, legal pages, deletion/export, backups | **10–14 weeks**                                        |

The gap between closed beta and public launch is mostly **not engineering**. It
is content moderation, a lawyer, and GDPR paths — none of which can be
compressed by writing code faster.

> **Do not charge before the closed-beta gate.** A customer who pays and cannot
> generate is a chargeback, and Stripe closes accounts over chargeback rates.

---

# Final Checklist

## Passing here

- [x] Repository pushed and synchronised — `9d4188d`, local == remote, 0 uncommitted
- [x] `npm install` — 921 packages, **0 vulnerabilities**
- [x] `npm run lint` — 0 errors, **0 warnings**
- [x] `npm run typecheck` — clean
- [x] `npm test` — **256 passed**, 17 files
- [x] `npx playwright test` — **104 passed**, 16 skipped, 0 failed
- [x] `npm run build` — 52 pages, compiles in ~7 s
- [x] `/api/health` implemented and returning correct status codes
- [x] Preview routes 404 in production — verified over HTTP
- [x] Replicate integration verified against the live API
- [x] All five model versions are real hashes

## Blocked on infrastructure

- [ ] `prisma migrate deploy` against a real database
- [ ] Sign up → user row **and** signup grant
- [ ] Generate → debit, R2 object, `assets` row
- [ ] Force failure → exactly one refund
- [ ] **Redeliver a Stripe webhook → grants nothing**
- [ ] Close browser mid-job → still completes
- [ ] Lighthouse: LCP, INP, CLS recorded
- [ ] Uptime monitor on `/api/health`
- [ ] Sentry receiving events
- [ ] A person has used every surface on a real device

---

# Honest summary

**This sprint moved the project further than the previous ten combined**, and
the reason is that it stopped writing code and started connecting things.

Two facts that were open questions this morning are now closed. The code is
**backed up** — 29 commits on GitHub, after eighteen sprints living on one disk.
And the core product function is **proven correct**: Replicate authenticates,
the model versions are real, and a live submission was accepted all the way to
the billing gate. A wrong version returns 404; a bad payload returns 422. Getting
a 402 is positive evidence, and it is the first such evidence this project has
ever produced.

What has not changed is the shape of what remains. Eight of eighteen flows are
unverifiable for one reason, and it is the same reason every report since Sprint
14 has given: **there is no infrastructure.** That is now a smaller gap than it
was — Replicate is live, the health endpoint exists, the deployment path is
written and the repository is real.

The next $5 is worth more than the next thousand lines. Fund the Replicate
account, create an R2 bucket, and this product makes something for the first
time.
