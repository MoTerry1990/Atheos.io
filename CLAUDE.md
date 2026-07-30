@AGENTS.md

# Working in this repo

Atheos.io — a premium AI creative platform. Read [`README.md`](README.md) for the
stack, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it fits together,
and [`docs/DECISIONS.md`](docs/DECISIONS.md) before questioning a choice that
looks strange. Most of them look strange for a reason that is written down.

---

## The boundaries that matter

These are not style preferences. Crossing one is a design regression, and each
has a cost that shows up months later.

**1. Vendor SDKs live only in `services/`.** Nothing outside `services/ai` may
import a provider SDK or branch on which provider is in use. The whole product is
"many vendors, one interface" — the moment a component knows it is talking to a
particular vendor, that promise is broken, and the bill arrives the day that
vendor changes its pricing or its API.

**2. Dependencies run one way.** `app` → `features` → `services` → `lib`. A
`lib/` module importing from `features/` is the first symptom of a foundation
turning into a ball of mud. `utils/` imports nothing at all.

**3. Nothing reads `process.env` except `lib/env.ts`.** Add a variable to the Zod
schema, to `.env.example`, and to the deployment environment — all three. The one
exception is `prisma.config.ts`, which runs outside the Next.js build, and it is
commented as such.

**4. Authorisation lives in `services/`.** Not in components, not in route
handlers, and _not_ in Supabase RLS — Clerk owns sessions, so the database does
not know who the caller is. There must be exactly one place to audit.

**5. Credits are append-only.** Never `UPDATE` a balance. Insert a ledger row and
write the cached `creditBalance` in the same transaction. A correction is a new
row with the opposite sign.

**6. Components use design _roles_, never raw scales.** `bg-surface`, not
`bg-neutral-900`. If the role you need does not exist, add it to
`styles/globals.css` — do not reach past the indirection, because that
indirection is the only reason the theme can change at all.

---

## Conventions

- **Server Components by default.** `"use client"` is a deliberate choice with a
  reason, pushed as far down the tree as possible. One at the top of a page drags
  the whole subtree into the bundle.
- **`server-only` in any module holding a secret**, so an accidental client
  import is a build error rather than a leaked key.
- **`cn()` on every `className` prop.** Without `tailwind-merge`, a caller's
  override and the component's default both land in the class list and stylesheet
  order picks the winner.
- **Every async surface renders empty, loading and error states.** AI generation
  fails often enough that a happy-path-only component is a bug, not an omission.
- **Feature code lives with its feature.** Top-level `components/` and `hooks/`
  are for genuinely shared things.
- **Store only what is genuinely client state.** If a value could be read from
  the database it does not belong in Zustand — a second source of truth is stale
  the moment anything changes.

---

## Before you say it is done

```bash
npm run verify   # typecheck + lint + format check
npm run build
```

Both must pass. Husky enforces this on commit and on push, so a broken build is
caught before it becomes anyone else's problem.

If you changed the Prisma schema, run `npm run db:generate` — and remember there
are **two** connection strings. `DATABASE_URL` is pooled and for runtime;
`DIRECT_URL` is a session connection and the only one migrations can use. Running
a migration through the pooler works in development and deadlocks in production.

---

## Sprint discipline

The [roadmap](ROADMAP.md) is ordered so that every sprint ships something
runnable. **Do not build ahead of it.** Scaffolding for a feature three sprints
away is code that will be rewritten before it ever runs, and it makes the current
sprint harder to review.

If something genuinely belongs earlier than planned, say so and make the case —
do not quietly widen the scope of the sprint you are in.

Current state: **Sprint 0 complete.** Foundation only, no product surface. The
known gaps are listed at the end of the README, and every one of them is
deliberate.
