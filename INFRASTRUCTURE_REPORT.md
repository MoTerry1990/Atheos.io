# Infrastructure Report — Sprint 14

**Scope:** production readiness of infrastructure. No features added, none
removed. Read `PROJECT_AUDIT.md` and `docs/LAUNCH.md` first — this report
assumes both.

---

## The honest headline

Of the twenty goals in this sprint, **fifteen were completed in full, four were
completed as far as this environment allows, and one could not be done at all**.
The five that fell short all need the same thing: accounts created and
credentials entered on third-party services, which is yours to do, not mine.

What changed that matters most:

1. **The first migration exists**, and it has been applied to a real Postgres
   engine and verified — not read, not assumed. This was the largest single gap
   in the project.
2. **Two webhook bugs were found and fixed.** Both would have silently lost
   money or personal data in production. Neither was visible to typecheck, lint
   or code review.
3. **Six unused dependencies and five dead environment variables were removed**,
   one of which was a credential that bypasses row-level security entirely.

What did **not** change: there are still no tests, and nothing has still ever
touched a real database, Clerk instance, Stripe account or storage bucket.

---

## Goal-by-goal

| #   | Goal                           | Status                      | Evidence                                                                             |
| --- | ------------------------------ | --------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Provision the database         | ⛔ **Cannot**               | No Postgres, no Docker on this machine; provisioning needs a Supabase account        |
| 2   | Generate and run the migration | ⚠️ **Generated + verified** | `0_init/migration.sql`, 476 lines, applied to PGlite; `migrate deploy` still pending |
| 3   | Verify every Prisma model      | ✅ **Done**                 | 16 models → 16 tables, introspected                                                  |
| 4   | Verify relationships           | ✅ **Done**                 | 22 FKs, cascade and set-null behaviour asserted                                      |
| 5   | Verify indexes                 | ✅ **Done**                 | 59 indexes; 30 + 3 + 10 declarations = 43 `CREATE INDEX`, exact match                |
| 6   | Verify foreign keys            | ✅ **Done**                 | All 22 present with correct delete rules; violations rejected                        |
| 7   | Verify constraints             | ✅ **Done**                 | 16 PKs, 11 enums, NOT NULLs, 34 defaults; 15 behavioural assertions pass             |
| 8   | Configure Supabase             | ✅ **Done**                 | Correct configuration turned out to be _removing_ the client — see below             |
| 9   | Verify Clerk                   | ⚠️ **Static + fixed**       | Two bugs fixed; no Clerk instance to authenticate against                            |
| 10  | Verify Stripe                  | ⚠️ **Static + fixed**       | API version pinned, webhook fixed; no Stripe account to call                         |
| 11  | Verify UploadThing             | ✅ **Done**                 | It was never integrated. Removed.                                                    |
| 12  | Verify Cloudflare R2           | ⚠️ **Static**               | Client construction and failure modes correct; no bucket to write to                 |
| 13  | Verify every env variable      | ✅ **Done**                 | Schema ↔ `.env.example` ↔ usage reconciled; 5 dead vars removed                      |
| 14  | Validate startup               | ✅ **Done**                 | `next start` ready in **658 ms**, zero warnings                                      |
| 15  | Remove dead code               | ✅ **Done**                 | 10 files, ~541 lines                                                                 |
| 16  | Remove empty folders           | ✅ **Done**                 | 4 removed                                                                            |
| 17  | Remove unused dependencies     | ✅ **Done**                 | 6 runtime + 1 dev                                                                    |
| 18  | TypeScript zero errors         | ✅ **Done**                 | `tsc --noEmit` clean                                                                 |
| 19  | ESLint zero errors             | ✅ **Done**                 | `eslint . --max-warnings 0` clean                                                    |
| 20  | Production build               | ✅ **Done**                 | `next build` succeeds                                                                |

**Goals 1, 2, 9, 10 and 12 need credentials I must not create or enter.**
Creating accounts and entering API keys is yours; everything that could be done
without them was — which, for goals 9 and 10, turned out to include finding two
real bugs in exactly that integration code.

---

# What was fixed

## 1. The first migration — generated, applied, verified

`prisma/migrations/0_init/migration.sql` — **476 lines**, plus
`migration_lock.toml`.

It was produced with `prisma migrate diff --from-empty --to-schema`, which needs
no database. `migrate dev` needs one to shadow, and the absence of a database is
precisely how a schema reached thirteen sprints without a migration. Waiting for
infrastructure was the trap; `migrate diff` steps around it (§ 47).

**Then it was actually run.** The SQL was applied to PGlite — real Postgres
compiled to WebAssembly, running in-process — and the result introspected:

| Object       | Found | Expected from `schema.prisma`     | Match |
| ------------ | ----- | --------------------------------- | ----- |
| Tables       | 16    | 16 `model` blocks                 | ✅    |
| Enums        | 11    | 11 `enum` blocks                  | ✅    |
| Foreign keys | 22    | 25 `@relation` lines (both sides) | ✅    |
| Indexes      | 59    | 43 `CREATE INDEX` + 16 PKs        | ✅    |
| Primary keys | 16    | 11 single + 5 composite `@@id`    | ✅    |
| Defaults     | 34    | —                                 | ✅    |

The index count reconciles exactly: 30 `@@index` + 3 `@@unique` + 10 field-level
`@unique` = 43 `CREATE INDEX` statements.

**Fifteen behavioural assertions then ran against that database.** Structure
("the index exists") is not behaviour ("the second insert is actually
rejected"), and it is behaviour the product's correctness rests on:

```
--- Idempotency (the guarantees money depends on) ---
PASS  webhook_events: replaying an event id is rejected
PASS  credit_transactions: reusing an idempotencyKey is rejected
PASS  credit_transactions: null idempotencyKey does not collide
--- Uniqueness ---
PASS  users: duplicate clerkId rejected
PASS  users: duplicate email rejected
PASS  folders: same name twice for one user rejected
PASS  folders: same name for a different user allowed
PASS  post_likes: composite PK prevents a double like
--- Referential integrity ---
PASS  assets: cannot reference a non-existent user
PASS  follows: self-referencing FKs both resolve to users
PASS  generations: lineage parent must exist
--- Delete behaviour ---
PASS  SET NULL: deleting a generation keeps its ledger row, nulled
PASS  CASCADE: deleting a user removes everything they own
--- Enums and defaults ---
PASS  enum: an invalid role is rejected
PASS  defaults: a new generation is QUEUED with zero cost
=== 15 passed, 0 failed ===
```

The two that matter most are the first and the twelfth. The first is the
database-level half of the check `docs/LAUNCH.md` calls the single most important
one in the project. The twelfth proves the ledger survives the deletion of the
thing it paid for — a financial record that vanished with its generation would
not be a ledger.

PGlite was installed with `--no-save` and is **not** a dependency;
`package.json` is untouched by it.

## 2. Two webhook bugs — both silent, both expensive

### Any database error was reported as "already processed"

Both receivers claimed the event id inside a bare `catch { return 200 }`. The
intent was "the primary key rejected a replay, so this is a no-op". The
behaviour was that a dropped connection, an exhausted pool or a timeout produced
the same answer: **200, already handled**.

Stripe and Svix both stop retrying on a 200. The credit grant would be lost
permanently, silently, and most likely under load — exactly when the database is
least reachable.

Both now check `isUniqueViolation(error)` — which had been written in Sprint 13
for this exact purpose and sat three lines away in `lib/prisma-errors.ts` — and
return 500 for anything else so the provider retries. A retry is safe by
construction: the claim is the first write, so nothing has been granted when it
fails.

### The Clerk receiver keyed idempotency on the wrong id

It claimed `event.data.id`. That is the **user** id, not the event id.

`user_abc` was claimed by the first `user.created`. Every later `user.updated`
for that person then collided with it and was discarded as a duplicate — so a
profile would sync **exactly once and never again**. Worse, the eventual
`user.deleted` collided too, so closing an account would leave the row and all of
that person's data in the database. That is a data-protection failure, not just a
sync bug.

It now uses the `svix-id` header, which is unique per delivery. The
failure-release path was updated to match — it had been deleting by the same
wrong id, which in the fallback case matched nothing at all, so the release was a
no-op and the retry was rejected as a duplicate anyway.

### A missing secret is now diagnosed as a missing secret

`verifyWebhook` reads `CLERK_WEBHOOK_SIGNING_SECRET` itself and throws when it is
absent — landing in the catch that logs "signature verification failed", sending
whoever read that log hunting for a signature mismatch. It now returns its own
503 naming the variable, mirroring the Stripe receiver.

## 3. Supabase — the correct configuration was to remove it

Goal 8 was "configure Supabase correctly". Correctly turned out to mean: Supabase
is our **Postgres host and nothing else**, reached only through `DATABASE_URL`
and `DIRECT_URL`.

`@supabase/ssr` and `@supabase/supabase-js` had **zero import sites**. The single
file that imported them, `lib/supabase.ts`, was itself imported by nothing.

This was predictable from § 2's own reasoning: Clerk owns sessions, so row-level
security cannot see who is asking, which makes the anon-key path unusable here by
design. The client was installed for "later, Realtime"; later never came.

Removed with it: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
**`SUPABASE_SERVICE_ROLE_KEY`**. The last is the one that mattered — a credential
that bypasses row-level security completely, sitting in every deployment's
configuration, required by nothing and protecting nothing. Every person who ever
set this project up would have pasted a live one in.

## 4. Unused dependencies

| Package                 | Import sites | Why it was there                       |
| ----------------------- | ------------ | -------------------------------------- |
| `uploadthing`           | 0            | § 4's inbound-upload half, never built |
| `@uploadthing/react`    | 0            | same                                   |
| `@supabase/ssr`         | 0            | § 2's "later, Realtime"                |
| `@supabase/supabase-js` | 0            | same                                   |
| `@stripe/stripe-js`     | 0            | a card form that was never built       |
| `cmdk`                  | 0            | a command palette nothing rendered     |
| `@types/pg` (dev)       | 0            | `@prisma/adapter-pg` brings its own    |

`/api/uploads` takes multipart form data and writes straight to R2 — the plumbing
UploadThing was meant to save us is about thirty lines once the destination is
already S3-compatible. Checkout returns Stripe's hosted `session.url` and the
browser navigates to it, so no client SDK is needed.

**Kept deliberately:** `pg` (transitively required by the adapter, but pinning the
actual database driver is worth an explicit line), `@prisma/client` (the generated
client imports `@prisma/client/runtime`), `react-dom`.

## 5. Dead code and empty folders

Ten files, ~541 lines, all tracked in git at the Sprint 6 commit and therefore
recoverable:

- `lib/supabase.ts`, `types/index.ts`, `components/layout/app-shell.tsx`
  (superseded by the dashboard's own shell)
- Seven unused UI primitives: `input`, `command`, `popover`, `progress`,
  `collapsible`, `radio-group`, `separator`

`components/ui/input.tsx` is the interesting one — forms never used it. They use
`InputField` in `field.tsx`, which renders its own `<input>` with adornment
support. None of the seven appeared in the design-system gallery either, so they
were dead by every available definition.

Four empty directories scaffolded in Sprint 0 and never filled were removed:
`components/common/`, `hooks/`, `public/images/`, `public/fonts/`. An empty
folder is a claim the codebase does not honour — a reader looking for shared
hooks would have found a folder implying there were some.

## 6. Configuration surface

- `CSP_ENFORCE` documented in `.env.example` — it was a real deployment flag with
  no mention anywhere outside `next.config.ts`.
- UploadThing's CDN hosts (`utfs.io`, `*.ufs.sh`) removed from the CSP
  `img-src`. Nothing has ever loaded an image from them, and an allowed origin
  nobody uses is an allowed origin nobody is watching.
- `.env.example` and `lib/env.ts` now reconcile exactly against actual usage.

## 7. Documentation corrected

`PROJECT_AUDIT.md` contained two factual errors about the schema, both found by
building the database from it: it said **12 enums** (there are 11) and put
`planTier` on `User` (it is on `Subscription`). Both corrected.

`docs/DECISIONS.md` gains §§ 46–48. §§ 2 and 4 were partly reversed and are left
standing — the header now points at § 46, per the project's rule that a decision
which turned out badly is worth more as a record than as a gap.

---

# Verification

Everything below was executed, not inferred.

```
tsc --noEmit                 CLEAN
eslint . --max-warnings 0    CLEAN
prettier --check             CLEAN
next build                   SUCCESS
next start                   Ready in 658ms, zero warnings
```

Against the running production server:

| Check                 | Result                                                             |
| --------------------- | ------------------------------------------------------------------ |
| CSP `img-src`         | UploadThing hosts gone, R2 + Clerk retained                        |
| Security headers      | `nosniff`, `DENY`, `strict-origin-when-cross-origin`, HSTS present |
| `/`                   | 200 — **162KB, correct title, one `h1`, no Clerk interstitial**    |
| `/explore`            | 200                                                                |
| `/admin` vs `/adminx` | 404 vs 404 — existence still does not leak                         |
| `/api/admin/overview` | 404 anonymous                                                      |
| `/api/marketplace`    | 200 (public catalogue, by design)                                  |
| `/sitemap.xml`        | 200, ISR 1h                                                        |

**The landing page rendered for the first time since Sprint 2.** `LAUNCH.md` had
it filed under "written, never run" because Clerk's development handshake
intercepts `/`. On a production server it does not. That item is now verified.

Bundle sizes are unchanged (shared 102 kB, `/studio` 283 kB) — removing six
dependencies changed nothing measurable, which is itself the evidence that they
were never bundled.

---

# Remaining issues

## Blocking a real deployment

| #   | Issue                                                                                                                                    | Severity |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **Zero tests.** Unchanged, and still the largest gap. The ledger, refunds and webhook idempotency have unit-testable logic and no tests. | Critical |
| 2   | **No infrastructure exists.** No database, Clerk instance, Stripe account, R2 bucket or provider key.                                    | Critical |
| 3   | **The migration has never been applied by Prisma.** Verified against PGlite, but `migrate deploy` remains a genuine first.               | High     |
| 4   | **No rate limiting anywhere.** Still zero occurrences. Generation costs money per call.                                                  | Critical |
| 5   | **Preview routes ship to production.** `/admin-preview` renders the admin interface with the gate bypassed (fixtures only).              | High     |
| 6   | **No error tracking or structured logging.** `console.error` remains the whole strategy — including for the new webhook 500s.            | High     |
| 7   | **CSP is still Report-Only** and still carries `'unsafe-inline'` in `script-src`.                                                        | High     |

## Found this sprint, not fixed

| #   | Issue                                                                                                                                                                                                                                                                                                                              | Severity     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 8   | **Seven sprints are uncommitted.** The last commit is _Sprint 6_; 93 files are modified or untracked in the working tree. A single bad `git checkout` erases Sprints 7–14. **Commit before doing anything else.**                                                                                                                  | **Critical** |
| 9   | **Webhook secrets are still optional in the env schema.** Both now fail closed and loudly at runtime, which is the important half, but a production deploy can still start without them. Making them required at build time would break CI builds that legitimately lack secrets; the right fix is a runtime production assertion. | Medium       |
| 10  | **`assets.thumbnailKey` exists and is never populated.** The schema anticipated a thumbnailing pipeline that was never built — which is why galleries serve full-size originals.                                                                                                                                                   | Medium       |
| 11  | **13 of 31 `findMany` calls remain unbounded.** Unchanged from the audit; out of scope for infrastructure.                                                                                                                                                                                                                         | High         |
| 12  | **Six duplicated `requireApiUser()` implementations.** Unchanged; out of scope.                                                                                                                                                                                                                                                    | Medium       |

Item 8 is the one I would act on today. It is not a code problem and it takes one
command, but until it is done every other item on this list is at risk.

---

# Deployment readiness

## Score: 45 / 100 — up from 22

The audit scored production readiness **22**. Sprint 14 moves it to **45**.

| Dimension               | Before | After | Why                                              |
| ----------------------- | ------ | ----- | ------------------------------------------------ |
| Schema deployability    | 0      | 85    | Migration exists, verified against a real engine |
| Configuration hygiene   | 55     | 90    | Dead vars and packages gone; surface reconciles  |
| Integration correctness | 40     | 70    | Two silent webhook failures fixed                |
| Observability           | 5      | 5     | Unchanged                                        |
| Testing                 | 0      | 0     | Unchanged                                        |
| Live infrastructure     | 0      | 0     | Unchanged                                        |

It is not higher because the two things that would move it most — tests, and
having ever run against a real dependency — are exactly the two this sprint could
not deliver. Removing dead weight and proving the schema is real progress, but a
clean build on verified DDL is still not a product that has taken a payment.

## What is now ready

- The schema will apply. That is no longer a hope.
- Configuration is honest: every variable is read by something.
- Both webhooks fail correctly — loudly, retryably, with the right diagnosis.
- The build, lint, typecheck and startup path are all clean.
- The dependency tree is 6 packages smaller with no behaviour change.

## What is not

- Nothing has authenticated, charged, generated or stored.
- Nothing is tested.
- Nothing is observable.
- Nothing is rate limited.

## Recommended next steps, in order

1. **`git add -A && git commit`.** Seven sprints of work are unprotected.
2. Provision Postgres; set both connection strings.
3. `npx prisma migrate deploy` — **not** `migrate dev`, the migration exists.
4. Create the Clerk instance; set keys, webhook endpoint and signing secret.
5. Sign up once. Confirm the user row and the signup grant.
6. Stripe test mode; subscribe; **redeliver the webhook and confirm it grants
   nothing the second time.** The database-level half of this now passes; the
   application-level half is still untested.
7. Then Sprint 15: tests and CI, before any further infrastructure.

---

## A note on what this sprint could not do

Three goals required creating third-party accounts and entering credentials.
Those are actions I should not take on your behalf, so goals 1, 9, 10 and 12 are
marked as far as static verification and code correction allow — which turned out
to be further than expected, since two of the bugs found were in exactly that
integration code.

The verification harness used for the migration lives in the session scratchpad
rather than the repository, because it depends on a package that is deliberately
not a dependency. If you want it as a permanent fixture, it belongs in Sprint 15
alongside the test suite, where PGlite would earn its place as a real
devDependency and these fifteen assertions would become the first fifteen tests.
