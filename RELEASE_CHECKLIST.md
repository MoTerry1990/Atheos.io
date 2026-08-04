# Release Checklist — Atheos.io

**Sprint 25 · Release Candidate 1**

Two columns, deliberately. **"Passes here"** means it was executed in the
development environment today. **"Ready for production"** means it would work
against real infrastructure. A green left column and a red right column is the
honest picture of this project, and collapsing them into one tick is how a
launch goes wrong.

---

## Code quality

| Check                  | Passes here | Ready for production | Evidence                       |
| ---------------------- | ----------- | -------------------- | ------------------------------ |
| **Build passes**       | ✅          | ⚠️ needs env vars    | `next build` — 9.2 s, 52 pages |
| **TypeScript passes**  | ✅          | ✅                   | `tsc --noEmit` clean           |
| **ESLint passes**      | ✅          | ✅                   | 0 errors, **0 warnings**       |
| **Prettier passes**    | ✅          | ✅                   | `--check` clean                |
| **Unit tests pass**    | ✅          | ✅                   | **256 passed**, 17 files       |
| **E2E tests pass**     | ✅          | ⚠️ 16 skipped        | **104 passed**, 0 failed       |
| **No vulnerabilities** | ✅          | ✅                   | `npm audit --omit=dev` → 0     |
| **No unused packages** | ✅          | ✅                   | 22 runtime deps, all reachable |
| **CI running these**   | ❌          | ❌                   | **No `.github/workflows`**     |

The 16 E2E skips are `/` and `/explore` under a placeholder Clerk key. A real
key resolves them — re-run with `E2E_CLERK_LIVE=1` and expect 120 passing.

---

## Infrastructure

| Check                       | Ready | Notes                                                                                                                                                                                                                                             |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Database ready**          | ⚠️    | Schema excellent — 17 tables, 4 migrations, 50+ assertions against real Postgres. **No instance provisioned.** Never touched by `migrate deploy`.                                                                                                 |
| **Migrations ready**        | ✅    | Four, chain-verified, index count reconciles exactly (48 = 35+3+10)                                                                                                                                                                               |
| **Backups**                 | ❌    | None, no tested restore                                                                                                                                                                                                                           |
| **Clerk ready**             | ⚠️    | Code correct and HTTP-verified. **No instance.** Placeholder key.                                                                                                                                                                                 |
| **Stripe ready**            | ⚠️    | Full lifecycle written. **Zero API calls ever made.**                                                                                                                                                                                             |
| **AI providers configured** | ⚠️    | **Replicate now authenticates and all five model versions are real.** A live submission reached Replicate's billing gate (HTTP 402), which proves token, version and payload are all correct. No image generated yet — the account has no credit. |
| **Storage configured**      | ❌    | R2 client correct. **No bucket.**                                                                                                                                                                                                                 |
| **Worker scheduled**        | ⚠️    | `vercel.json` cron added, GET handler added. **Never run.** Requires Vercel Pro for per-minute.                                                                                                                                                   |
| **Env vars documented**     | ✅    | `ENVIRONMENT_TEMPLATE.md` — 30 variables, purpose, required, example, location                                                                                                                                                                    |
| **Env vars set**            | ❌    | Nowhere. No deployment environment exists.                                                                                                                                                                                                        |
| **Deployment instructions** | ✅    | `DEPLOYMENT.md` — 7 steps, checklist, rollback plan                                                                                                                                                                                               |
| **Repository pushed**       | ⚠️    | Remote configured; push needs interactive auth                                                                                                                                                                                                    |

---

## Security

| Check                    | Ready | Notes                                                          |
| ------------------------ | ----- | -------------------------------------------------------------- |
| Authentication           | ✅    | Clerk 7, no home-grown session handling                        |
| Authorization            | ✅    | Lives with the resource; admin root of trust is an env var     |
| Rate limiting            | ⚠️    | All handlers covered; **in-memory, per-process**               |
| Input validation         | ✅    | Zod through one gate; multipart validated harder than JSON     |
| CSRF                     | ✅    | Refuses requests carrying neither header                       |
| XSS                      | ✅    | One audited `dangerouslySetInnerHTML`, no `eval`               |
| CORS                     | ✅    | None set — same-origin only, correct                           |
| Cookies                  | ✅    | App sets none; Clerk owns them                                 |
| Headers                  | ✅    | Enforcing CSP, HSTS preload, full set                          |
| **Preview routes gated** | ✅    | **Closed this sprint** — 404 in production, verified over HTTP |
| Content moderation       | ❌    | **Launch blocker for a public gallery**                        |
| Account deletion/export  | ❌    | **GDPR blocker**                                               |
| Legal pages              | ❌    | **Launch blocker**                                             |
| Error tracking           | ❌    | `console.error` only                                           |

---

## Known issues

### Blockers — cannot launch publicly

| #   | Issue                                                                                            |
| --- | ------------------------------------------------------------------------------------------------ |
| 1   | **No infrastructure provisioned.** Database, Clerk, Stripe, R2, provider keys — none exist.      |
| 2   | **No adapter has ever called a vendor.** The product's core function is unproven.                |
| 3   | **No content moderation** on a product that publishes generated imagery to an indexable gallery. |
| 4   | **No legal pages** — no terms, privacy policy, acceptable-use policy or takedown path.           |
| 5   | **No account deletion or data export.** Cascades are correct; nothing triggers them.             |
| 6   | **No error tracking.** A silent failure here produces a provider bill nobody is watching.        |

### High — launch degraded or risky

| #   | Issue                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | **No CI.** 360 tests run only when somebody remembers.                                                                                                                                                                    |
| 8   | **Worker not wired in.** `services/generation.ts` has zero references to the queue — generation is still client-driven, so closing the tab still loses the job. The cron and endpoint are ready; the cutover is not done. |
| 9   | **Rate limiter is per-process** — on Vercel's horizontal scaling, N instances means N× the limit.                                                                                                                         |
| 10  | **Replicate model versions are `PLACEHOLDER_*`** and rejected at submit. Unfixable without an account.                                                                                                                    |
| 11  | **Core Web Vitals unmeasured.** Choices are sound; effects unverified.                                                                                                                                                    |
| 12  | **The product has never been seen by a person.** Verified through markup and geometry, never by eye.                                                                                                                      |
| 13  | **Backups do not exist**, and no restore has been tested.                                                                                                                                                                 |

### Medium

15 of 31 `findMany` calls unbounded · no thumbnail pipeline (`thumbnailKey`
exists, nothing writes it) · `'unsafe-inline'` in `script-src` · DNS-rebinding
SSRF open · cancelled jobs not cancelled at the provider · webhook retries have
no backoff · R2 objects protected only by unguessable keys · service-layer test
coverage near zero (19.07 % lines overall) · no organisation entity · margin
unavailable while 9 of 11 providers are unpriced · `gpuTimeMs` and token columns
never written · no component tests for six Sprint 22–23 components.

### Low

Fixed 5-minute lease for every job · panel resizing desktop-only · alt-text
tripwire has never examined an image (the app ships zero `<img>`) · no `pg_trgm`
index · five unused `create-next-app` scaffold SVGs · 310 KB fixture clip ships
to production but is only reachable from routes that now 404 · `engines.node` is
a floor, not a pin.

---

## Sign-off gates

Nothing below may be ticked from this environment. Each requires infrastructure.

- [ ] `prisma migrate deploy` applied all four migrations to a real database
- [ ] Sign up once → `users` row **and** signup credit grant both present
- [ ] Generate once → debit, R2 object and `assets` row all present
- [ ] Force a failure → **exactly one** refund
- [ ] Subscribe in Stripe test mode → plan and grant applied
- [ ] **Redeliver that Stripe webhook → it grants nothing the second time**
- [ ] Cron fires and drains the queue
- [ ] Close the browser mid-generation → it still completes
- [ ] `/design-system` and `/admin-preview` return 404 in production
- [ ] Lighthouse run; LCP, INP, CLS recorded
- [ ] Sentry receiving events
- [ ] A person has used every surface on a real device

The sixth is the one to insist on. It is proven at the database level by a
unique constraint and has never been proven against real Stripe, and it is the
difference between a billing system and a way to give away credits.
