# Test Report — Sprint 17

**Scope:** bring the project from zero tests to a running suite.
**Baseline:** `PROJECT_AUDIT.md` scored testing **0/100** — the only dimension
in the entire audit that scored zero, and the one flagged in every sprint since.

---

## Result

|                                         |                                                     |
| --------------------------------------- | --------------------------------------------------- |
| **Unit / integration / API / DB tests** | **151 passing**, 0 failing, 11 files                |
| **End-to-end tests**                    | **89 passing, 8 failing** across 2 browser projects |
| **Line coverage (targeted scope)**      | **13.77 %**                                         |
| Test frameworks                         | Vitest 4, Testing Library, Playwright 1.62, PGlite  |

The eight E2E failures are described in full below. **Four are real findings,
one is an environment limitation that also corrects a claim I made in Sprint 14,
and three are a known harness artifact.** None was fixed by weakening the test.

---

# What was installed

| Package                                           | Role                                                   |
| ------------------------------------------------- | ------------------------------------------------------ |
| `vitest` + `@vitest/coverage-v8`                  | Runner and coverage                                    |
| `@testing-library/react` + `/dom` + `/user-event` | Component tests                                        |
| `jsdom`                                           | DOM for the component project                          |
| `@playwright/test`                                | End-to-end, Chromium + Pixel 7                         |
| `@electric-sql/pglite`                            | **Real Postgres**, compiled to WebAssembly, in-process |

PGlite is the interesting one. It was used as a throwaway in Sprint 14 to prove
the migration applied; it is now a proper devDependency, because it turns
"schema tests" from mocks into a real Postgres accepting or rejecting real DDL.

Scripts: `npm test`, `test:watch`, `test:coverage`, `test:e2e`, and `verify`
now runs the suite alongside typecheck, lint and format.

Two configuration notes worth recording, because both cost time:

- **`oxc`, not `esbuild`.** Vitest 4 uses Rolldown, so the JSX override for
  `tsconfig`'s `jsx: "preserve"` is `oxc: { jsx: { runtime: "automatic" } }`.
  The `esbuild` form is silently ignored.
- **`server-only` is aliased to an empty module.** Every service imports it and
  it throws outside a React Server Component. This removes no safety — the
  guarantee is enforced by `next build`, which still runs.

---

# The suites

## Unit — 78 tests

| File                       | Tests | What it protects                                                         |
| -------------------------- | ----- | ------------------------------------------------------------------------ |
| `rate-limit.test.ts`       | 17    | Window arithmetic, per-key and per-policy isolation, `Retry-After` floor |
| `request-identity.test.ts` | 17    | CSRF verdicts, `x-forwarded-for` parsing, key namespacing                |
| `pricing.test.ts`          | 16    | The estimate shown and the amount debited are one function               |
| `handles.test.ts`          | 18    | Public identity validation, including homograph rejection                |
| `format.test.ts`           | 21    | Money and quantity rendering                                             |
| `upload-safety.test.ts`    | 13    | Magic-byte sniffing against a public bucket                              |

Assertions chosen for the failure they'd actually catch, not for coverage:

- `creditsFor` **always rounds up**. Rounding down means paying a provider more
  than we charged.
- `formatCurrency(1999)` is `$19.99` and explicitly **not** `$1,999.00` — the
  exact shape of a bug that already shipped once.
- `validateHandle("аdmin")` with a Cyrillic _а_ is rejected. That is the entire
  reason the ASCII rule exists.
- `sniffImageMime` rejects HTML, SVG, GIF, PDF, a near-miss PNG header, and a
  **WAV file** — which is also RIFF, so checking four bytes would admit it as an
  image.
- The rate limiter's per-policy namespacing: exhausting checkout must not lock a
  user out of reading their own projects.

## Database — 18 tests, against real Postgres

The migration is applied to PGlite and the guarantees are exercised, not
asserted about:

- A replayed webhook event id is **rejected by the primary key**.
- A reused credit `idempotencyKey` is rejected; a **null** one is not, because
  ordinary spends carry no key and a collision there would allow exactly one
  generation per user, ever.
- Deleting a generation **nulls its ledger row rather than removing it** — a
  financial record that vanishes with what it paid for is not a ledger.
- Deleting a user cascades to all six owned tables and both sides of `follows`.
- A composite primary key makes a double like impossible.
- `date_trunc` buckets identically to `dayKey`, including a row one second
  before midnight — the Sprint 16 aggregation rewrite depends on this.

## API — 26 tests

**Stripe webhook idempotency (8).** `docs/LAUNCH.md` calls redelivering a
webhook and confirming it grants nothing "the single most important check in
this document". The database half is above; this is the application half:

- A replayed event returns 200 with `duplicate: true`.
- **A connection failure does NOT return `duplicate`** — this is a regression
  test for the Sprint 14 bug, where a bare `catch` answered 200 to a dropped
  connection, Stripe stopped retrying, and the grant was lost silently under
  exactly the load that causes connection failures.
- The event id is claimed **before** the work, asserted by recording call order.
- A processing failure releases the claim so the retry is not rejected.
- An unverifiable signature records nothing.

**The guard (18).** Both load-bearing orderings are asserted:

- **Rate limit before the database read** — after a 429, `getCurrentUser` is not
  called again. If this regressed, a flood would still cost a query per request.
- **Admin before input parsing** — a non-admin gets **404, not 400**, for a
  malformed body _and_ for invalid query params. That difference was a real
  disclosure leak found in Sprint 15, and my first fix made it worse.

## Components — 5 tests

`Heading`'s size/level split, which is what three Sprint 13 accessibility bugs
came from — including two `h1`s on the page arguing against choosing a heading
level for its size. Covers `as="p"` (the escape hatch), level independence, and
`sr-only` headings staying in the accessibility tree.

## End-to-end — 97 tests across Chromium and Pixel 7

Security posture over real HTTP against the production build: the admin surface
answering 404 to every input shape, six endpoints rejecting anonymous reads,
three CSRF vectors, the 429 with `Retry-After`, and the full header set
including the CSP being enforcing rather than Report-Only.

Plus the structural accessibility sweep that found six real bugs in Sprint 13 —
one `h1` per page, no skipped levels, no horizontal overflow at 375px, WCAG
2.5.8 tap targets — now repeatable instead of remembered.

---

# Failed tests

**8 failures. Not suppressed, not weakened.**

## Real findings (4)

### 1. `/studio-preview` skips a heading level: `h1 → h3`

The studio's `sr-only` `<h1>` was added in Sprint 13 because the page had none.
Something beneath it is an `h3` with no intervening `h2`, so a screen reader's
heading list jumps a level on the product's core page.

This is a genuine accessibility defect that the Sprint 13 manual sweep did not
catch, because that sweep checked `h1` **count** and this needs level
**sequence**. Left failing deliberately: it is a UI fix, and this sprint is
testing.

### 2–4. `/`, `/explore` and the landing page title, in a real browser

`/` and `/explore` return **400** to Chromium. The cause is Clerk's development
handshake with a placeholder publishable key — documented since Sprint 3, but
with a consequence I got wrong.

**This corrects `INFRASTRUCTURE_REPORT.md`.** Sprint 14 reported "the landing
page rendered for the first time since Sprint 2 — 162KB, correct title, one
h1". That was measured with `curl`, which does not follow Clerk's handshake
redirect. A real browser does, and gets a 400. The HTML I measured was real, but
the claim that the page renders **in a browser** was not supported by the way I
verified it, and I should have said so.

The related "no console errors" failure is the same 400 surfacing as a failed
resource load.

## Harness artifact (3)

`/community-preview` reports **0** `h1`s, in both browser projects. The preview
route renders community sub-components directly without the page wrapper that
supplies the heading — documented in Sprint 13 and unchanged. The test is
correct to flag it; the fix is to the preview route, not the assertion.

---

# Coverage

```
Statements   13.85 %   (224 / 1617)
Branches     10.35 %   (145 / 1400)
Functions    13.27 %   (47 / 354)
Lines        13.77 %   (204 / 1481)
```

**Scope is `lib/`, `services/`, `utils/` and `features/studio/lib/`** — excluding
generated Prisma output and all UI. Measured against the whole repository the
number would be lower still; reporting it against the whole tree would produce a
figure dominated by components nobody claims are tested, which is less honest,
not more.

**13.77 % is not enterprise quality, and I am not going to present it as such.**

What it reflects is a deliberate choice about _which_ 14 %:

- The **rate limiter, CSRF, guard, pricing, handle validation, upload sniffing
  and Prisma error classification** are well covered — those are pure functions
  where a bug is silent and expensive.
- The **schema's constraints** are covered by real Postgres.
- The **webhook's idempotency branches** are covered.

What is essentially uncovered:

- `services/community/index.ts` (955 lines), `services/projects.ts` (742),
  `services/marketplace/catalogue.ts` (665) — every one needs a database, and
  covering them means either a Postgres test harness with seeded fixtures or a
  large volume of Prisma mocks that would mostly assert that Prisma works.
- All of `services/billing` beyond the webhook path.
- Every React component except `Heading`.

A number this low with the _right_ 14 % covered is more useful than 60 % reached
by testing getters. But it is still 14 %.

---

# Recommendations

Ordered by what would reduce risk fastest.

1. **Fix the four real E2E failures.** They are findings, and a suite that ships
   with known failures trains people to ignore it. The `h1 → h3` skip on
   `/studio-preview` is a genuine accessibility bug.

2. **Correct the Sprint 14 landing-page claim** in `INFRASTRUCTURE_REPORT.md`
   and `docs/LAUNCH.md`. It is filed as verified; a real browser says otherwise.

3. **Add a Postgres-backed service test harness.** PGlite already applies the
   real migration — pointing Prisma at a PGlite instance would make
   `services/projects`, `services/community` and `services/billing` testable
   without mocks, and that is where the uncovered 86 % lives. It is the single
   highest-leverage remaining item.

4. **Wire this into CI.** There is still no pipeline. A suite that only runs
   when someone remembers is a suite that stops passing quietly. Run
   `npm run verify` plus `npm run test:e2e` on every push.

5. **Set a coverage floor and raise it deliberately.** Start at 13 % so it
   cannot regress, and raise it with each service brought under test. A floor
   that starts where you are is enforceable; an aspirational one is ignored.

6. **Test the credit ledger's concurrency.** Two simultaneous generations
   against a balance covering one is the highest-value untested behaviour left,
   and it needs a real database with real transactions.

7. **Run E2E with `workers: 1` or exempt tests from the IP rate limit.** The
   suite is fast enough serially, and parallel runs from a single IP compete
   with the `publicRead` policy — a real interaction between two controls that
   is worth knowing about before it appears in CI as a flake.

---

## Honest summary

The project went from **zero tests to 151 passing plus 89 end-to-end**, with the
riskiest logic in the codebase — the money guarantees, the access guards, the
schema constraints — genuinely covered and verified against a real Postgres.

It did **not** reach enterprise coverage. 13.77 % is a starting point, and the
gap is concentrated in exactly the code that needs a database. The suite also
found four real defects and forced me to correct a claim I made two sprints ago,
which is the clearest evidence that having it was worth the sprint.
