# Release Candidate 1 — Sprint 24

**Goal:** review the whole application, remove duplication, fix inconsistencies
and accessibility, confirm the production build, and decide whether Atheos is a
release candidate.

**Verdict: RC1 is a code-complete release candidate and is not launchable.**

Those are two different claims and this report keeps them apart. The code builds,
typechecks, lints, and passes 256 unit tests and 104 end-to-end tests. It has
also never run against a database, an auth provider, a payment processor, an
object store, or a single AI provider key. Every sprint since 14 has said some
version of this; RC1 is where it has to be said as a launch decision rather than
a caveat.

The most useful thing this sprint produced was not a fix. It was discovering
that **three of the checks the last ten sprints have been quoting as evidence
were not checking anything.**

---

## The three tests that were not testing

This is first because it changes how the rest of this document should be read,
and how the earlier reports should be read.

### 1. The E2E suite was testing a stale build

`playwright.config.ts` carried this comment:

> `webServer` builds and starts the production server, so these run against the
> same output that would deploy, headers included.

The command was `npx next start -p 3210`. **It never built.** Playwright served
whatever happened to be left in `.next` from the last manual build.

This is the worst possible direction for a test harness to fail. Nothing goes
red. You make a fix, run the suite, watch it pass, and record the fix as
verified — against a bundle that does not contain it. It cost real time inside
this very sprint: a WCAG fix appeared to have no effect for two full runs, and
the reason was that the browser had never been served it.

Fixed to `npx next build && npx next start -p 3210`, timeout raised 120s → 300s
to cover the build. `reuseExistingServer` still short-circuits it locally.

**Every "verified against `next start`" line in Sprints 14–23 should be read as
"verified against a build made at some earlier point".** In practice they were
probably fine, because a build usually preceded the run. "Probably fine" is the
problem.

### 2. The tap-target check examined an error page

It navigated to `/`, which Clerk's dev handshake makes unloadable, found zero
controls on the resulting error page, and asserted that none of those zero
controls were undersized. Green, permanently, since Sprint 13.

It now runs across all eight preview routes, and asserts `examined > 0` before
asserting anything about sizes — so the shape of the earlier failure cannot
recur silently.

### 3. The alt-text check has never examined an image

Same cause: it pointed at `/explore`. Repointing it did not help, because
**every route in the application renders zero `<img>` elements** — measured
across all eight preview routes, all zero. Nothing has been generated yet and
every piece of artwork on the site is procedural CSS or inline SVG.

It is kept as a tripwire and sweeps every preview route, but it deliberately
does **not** assert `total > 0`; that would be a permanently red test asserting
a product decision nobody has made. The count is attached to the test result so
the day the first `<img>` ships it becomes visible. **Image accessibility is
listed below as uncovered, not as passing.**

---

## What was actually wrong with the UI, and what only looked wrong

Once the tap-target check ran against real pages, it reported 17 undersized
controls across four routes. **Fifteen of them were false positives, and the
distinction matters** — "fixing" them would have damaged the product.

### False positives: the target is not the element's box

| Pattern             | Where                                               | Element box  | Real hit area  |
| ------------------- | --------------------------------------------------- | ------------ | -------------- |
| **Stretched link**  | Project cards, marketplace item cards (13 controls) | 19–22px tall | the whole card |
| **Wrapping label**  | Checkbox and switch rows                            | 16–18px      | the whole row  |
| **`sr-only` input** | The file input behind the studio's upload button    | 1×1          | not a target   |

A card title carrying `after:absolute after:inset-0` has a `::after` covering
the entire card, so the entire card is clickable. Its own box is just the text.
Padding those to 24px would have broken every card layout in the product and
bought nothing — WCAG 2.5.8 is about the area a finger can hit, not the
element's layout box.

The check now computes the **effective** target: it follows a stretched
`::after` to its positioned ancestor, falls through to a wrapping `<label>`, and
skips 1×1 `sr-only` controls (which are hidden that way precisely so they stay
focusable — nobody taps them, the visible button does).

### The two that were real

Checkbox and switch rows measured **22px, two short of 24**. Genuine, and fixed
at the primitive rather than the call site.

A new `tap-target` utility in `styles/globals.css` adds a centred, absolutely
positioned `::before` with `min-width: 24px; min-height: 24px`. The control
still _looks_ 16px and still _occupies_ 16px of layout — only the tappable
region grows, evenly on each side. `Checkbox` and `Switch` both carry it now, so
a consumer wrapping either in a tight flex row can no longer produce a 22px
target. That is exactly how `/design-system` produced one.

---

## Duplicate code

One genuine duplicate, and it had diverged.

`formatMicroUsd` existed in both `services/ai/cost.ts` and
`services/billing/usage.ts`. Not copies — the billing version compared
`Math.abs(micro)` against the four-decimal threshold and the AI version compared
the signed value. So a refund of two dollars fifty printed with four decimal
places, while the identical charge it reversed printed with two.

The billing copy was **unused** and was also the **correct** one. Deleted it,
moved its `Math.abs` into the surviving copy beside `MICRO_USD`, dropped the now
unused import, and pinned the behaviour with a test naming the divergence.

Swept for other duplication and found none worth acting on: one `formatMoney`
(billing catalogue), no duplicated fetch wrapper (Sprint 13 consolidated it), no
duplicated error responder, no duplicated auth guard (Sprint 15 replaced six
byte-identical `requireApiUser` copies with one).

---

## Consistency, spacing, typography, accessibility

Swept and clean:

| Check                                           | Result                                                         |
| ----------------------------------------------- | -------------------------------------------------------------- |
| Hardcoded hex colours in components             | none — everything goes through tokens                          |
| Arbitrary font sizes (`text-[…]`)               | one, `text-[0.85em]` for inline code — correct, it is relative |
| Arbitrary pixel spacing                         | one, `p-[3px]` on the tabs inset — from shadcn, correct        |
| `dark:` colour overrides bypassing tokens       | none                                                           |
| Icon-only buttons without an accessible name    | none                                                           |
| Raw `<img>` instead of `next/image`             | none (there are no images at all)                              |
| Positive `tabIndex`                             | none                                                           |
| `onClick` on a non-interactive `<div>`/`<span>` | none                                                           |
| One `h1` per route, no skipped heading levels   | all 8 preview routes pass                                      |
| No horizontal overflow at 375px                 | all 8 preview routes pass                                      |

Sprints 8–23 did this work properly. RC1 found no new spacing or typography
defects, and I did not manufacture any to have something to report.

Also fixed: `test-results/` and `playwright-report/` were in neither
`.gitignore` nor `.prettierignore`, so Playwright's traces and screenshots were
tracked files and Prettier was linting a generated JSON artefact.

---

## Verification

Everything below was executed in this environment.

```
tsc --noEmit                 CLEAN
eslint . --max-warnings 0    CLEAN
prettier --check .           CLEAN
vitest run                   256 passed, 17 files, 0 failed
playwright test              104 passed, 16 skipped, 0 failed
next build                   SUCCESS — 52 pages prerendered, / remains ○ (Static)
```

The 16 skips are the `/` and `/explore` assertions across both browser projects.
They are **skipped, not deleted and not weakened** — Clerk's dev handshake 400s
both routes in a real browser with a placeholder publishable key. They run under
`E2E_CLERK_LIVE=1` against a real key. The skip reason is printed in the run
output rather than hidden.

One build warning, and it is correct behaviour: `Sitemap: could not read
community pages` — the sitemap tries Postgres, fails, and emits the static
entries rather than failing the build.

---

## Known Bugs

| #   | Bug                                                                                                                                                                                  | Severity |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 1   | **`/` and `/explore` are unloadable in a browser** with the placeholder Clerk key. Resolved by a real key; unverifiable until there is one.                                          | Blocker  |
| 2   | **The landing page has never been rendered to a human eye.** Verified structurally — markup, headings, overflow, build output. Whether it is beautiful is unknown.                   | High     |
| 3   | **Nine of eleven providers have no adapter.** Declared in the catalogue, refused by the router. Correct, and it means the product does what its marketing page says and little more. | High     |
| 4   | **No image has ever been generated.** The full path — reserve credits → queue → worker claim → provider call → store to R2 → debit — has never executed against a real provider.     | Blocker  |
| 5   | Image alt-text is **unenforced in practice** because the app renders no `<img>`. The tripwire exists; it has never fired.                                                            | Low      |

## Known Limitations

| #   | Limitation                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Core Web Vitals are unmeasured.** Sprint 16 could not obtain LCP/FCP from this harness and CLS reported zero untrustworthily. Unchanged. The choices are sound; the effects are unverified.    |
| 2   | **No database has ever been connected.** The schema and all four migrations were verified against PGlite — real Postgres in WASM — which proves the SQL and the constraints, not the deployment. |
| 3   | **The rate limiter is in-memory.** Correct for one instance, useless across several. `RateLimitStore` exists so Redis is a swap, not a rewrite.                                                  |
| 4   | **The worker has no scheduler.** `/api/worker/tick` is correct and idempotent under concurrency (proven with `FOR UPDATE SKIP LOCKED` against PGlite). Nothing calls it on a timer.              |
| 5   | **No testimonials, and no path to any** until real users exist. The section renders `null` by design.                                                                                            |
| 6   | **Stripe, Clerk and R2 webhooks are unexercised.** Signature verification is implemented and unit-tested; no real webhook has ever arrived.                                                      |
| 7   | **Token usage is not persisted** for text generations — blocked by the provider interface, which Sprint 19 was explicitly instructed not to change.                                              |
| 8   | **No component tests** for the six components added in Sprints 22–23.                                                                                                                            |

## Launch Checklist

Everything that must be true before the first external user.

- [ ] Provision Postgres; run all four migrations against it
- [ ] Real Clerk instance; replace the placeholder keys — **unblocks `/`, `/explore` and 16 skipped tests**
- [ ] Re-run the E2E suite with `E2E_CLERK_LIVE=1` and confirm all 120 pass
- [ ] At least one real provider key (Replicate or OpenAI)
- [ ] Execute one real generation end to end and confirm the ledger balances
- [ ] R2 bucket, credentials, CORS
- [ ] Stripe products, prices, webhook endpoint; one real test-mode subscription
- [ ] A scheduler calling `/api/worker/tick` (cron, queue consumer, or a long-running process)
- [ ] Redis behind `RateLimitStore` if more than one instance will run
- [ ] Lighthouse against the deployed page; record real LCP, INP and CLS
- [ ] **Have a person look at the landing page**

## Production Checklist

Things already true, listed so they are not re-done.

- [x] Production build succeeds; 52 pages prerendered; `/` static
- [x] CSP, security headers, caching headers (Sprint 14)
- [x] CSRF, rate limiting, one API guard with a deliberate check order (Sprint 15)
- [x] Admin routes 404 rather than 401 to unauthenticated callers
- [x] Append-only credit ledger with idempotency keys; P2002 means "already done"
- [x] Worker jobs claimed atomically with `FOR UPDATE SKIP LOCKED`, leased and heartbeated
- [x] Webhook signatures HMAC-signed over `timestamp.body`, verified constant-time
- [x] SSRF allowlist on webhook delivery; `redirect: "manual"`
- [x] Error boundaries and `not-found` on every route group
- [x] Sitemap, robots, canonical, OG images, JSON-LD; preview routes `noindex`
- [x] `reducedMotion="user"` respected globally
- [x] 256 unit tests, 104 E2E tests, all green
- [x] Typecheck, lint and format clean at zero warnings

---

## Honest summary

The application is finished in the sense the sprints could finish it. It is well
structured, the security posture is deliberate, the money is integers in an
append-only ledger, the worker is safe under concurrency, and the marketing page
refuses to claim more than the engine can do.

What RC1 changed is smaller than what it revealed. Two real WCAG misses fixed,
one diverged duplicate merged, some generated files stopped being tracked. Set
against that: a test harness that had been serving a stale bundle, and two
accessibility checks that had been passing on an error page for ten sprints.

That is the finding worth carrying forward. Fifteen of the seventeen tap-target
"failures" were the check being wrong, and the two real ones were only reachable
because the check was made honest first. **The gap between "the suite is green"
and "the thing works" is exactly the gap between this being a release candidate
and being a release**, and closing it needs a database, a Clerk key, a provider
key and a person's eyes — none of which exist here.
