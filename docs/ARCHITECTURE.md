# Architecture

How the pieces fit. For _why_ each piece was chosen, see
[`DECISIONS.md`](./DECISIONS.md).

---

## Shape of the system

```
                    ┌─────────────────────────────────────────┐
   Browser ────────▶│  Next.js 15 · App Router · React 19      │
                    │                                          │
                    │  Server Components ──▶ services/ ──▶ lib/│
                    │  Client Components ──▶ store/ (UI only)  │
                    └───────┬─────────────────────┬────────────┘
                            │                     │
              ┌─────────────┼──────────┬──────────┼───────────┐
              ▼             ▼          ▼          ▼           ▼
          ┌───────┐   ┌──────────┐ ┌───────┐ ┌────────┐ ┌──────────┐
          │ Clerk │   │ Supabase │ │Stripe │ │  R2    │ │UploadThing│
          │identity│  │ Postgres │ │billing│ │outbound│ │ inbound   │
          └───────┘   └──────────┘ └───────┘ └────────┘ └──────────┘
              │             ▲          │
              └─── webhook ─┴─ webhook ┘
                    (mirrored into our tables)
```

Clerk and Stripe own their state. Our database mirrors both, reconciled by
webhook, and never resolves a conflict in its own favour.

---

## Directory layout

Organised by **what a thing is**, not by what it is called in a framework
tutorial. The test for where something belongs is: _who is allowed to import
it?_

| Directory            | Contains                                                                                                           | May import                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `app/`               | Routes, layouts, route handlers. Thin — composition only, no logic.                                                | everything                                                          |
| `features/`          | Self-contained vertical slices (generation, library, billing). Each owns its components, hooks and server actions. | `components`, `hooks`, `lib`, `services`, `store`, `utils`, `types` |
| `components/ui/`     | shadcn/ui primitives. Owned code, edited freely.                                                                   | `lib/utils`                                                         |
| `components/layout/` | Structural primitives: `Container`, `PageHeader`, `AppShell`.                                                      | `lib/utils`                                                         |
| `components/common/` | Shared presentational components with no feature knowledge.                                                        | `lib`, `utils`                                                      |
| `services/`          | Business logic and external integrations. The only place a vendor SDK may be touched.                              | `lib`, `types`, `utils`                                             |
| `lib/`               | Configured clients and cross-cutting singletons: `prisma`, `stripe`, `r2`, `supabase`, `env`, `utils`.             | `types`                                                             |
| `hooks/`             | Reusable React hooks with no feature knowledge.                                                                    | `lib`, `store`, `utils`                                             |
| `store/`             | Zustand. Ephemeral client state only.                                                                              | `types`                                                             |
| `styles/`            | `globals.css` — the entire design system.                                                                          | —                                                                   |
| `types/`             | Types shared by more than one feature.                                                                             | generated Prisma types                                              |
| `utils/`             | Pure functions. No I/O, no imports from `lib/`.                                                                    | —                                                                   |
| `prisma/`            | Schema and migrations.                                                                                             | —                                                                   |
| `docs/`              | This.                                                                                                              | —                                                                   |

**The direction of dependency is one-way.** `app` → `features` → `services` →
`lib`. Nothing lower reaches back up. A `lib/` module that imports from
`features/` is the first symptom of a foundation turning into a ball of mud.

Feature-specific code lives with its feature. `components/` and `hooks/` at the
top level are for genuinely shared things — the moment they become a dumping
ground they stop being findable.

---

## The voice of the system: request lifecycle

A generation, once Sprint 2 exists, will move like this. Sprint 0 has built every
box it passes through except the adapters.

```
1. Server Action receives a prompt
2. requireUser()                    identity, from Clerk
3. service checks credit balance    our DB, our rule
4. INSERT generation (QUEUED)       + credit debit, one transaction
5. adapter.submit(request)          services/ai — the only vendor contact
6. store providerJobId              generation -> RUNNING
7. poll until terminal              adapter.poll(), normalised job state
8. copy output vendor URL -> R2     vendor URLs expire; ours do not
9. INSERT asset rows                keys, never absolute URLs
10. generation -> SUCCEEDED
    on failure -> FAILED + credit refund entry
```

Two things in that list are load-bearing and easy to skip:

- **Step 4 is one transaction.** The debit and the generation row commit
  together or not at all. A debit without a generation is theft; a generation
  without a debit is free inference.
- **Step 8 is not optional.** Vendors serve results from URLs that expire. Handing
  one to a user produces an asset library full of dead links a week later.

---

## Data model

Five ideas, in `prisma/schema.prisma`:

- **`users`** — mirror of Clerk, keyed on `clerkId`. Carries the cached
  `creditBalance`.
- **`credit_transactions`** — append-only ledger. The truth about credits.
  `balanceAfter` for statements, `idempotencyKey` for retry safety.
- **`generations`** — one row per request. Stores the verbatim provider
  `parameters` so a generation can be replayed exactly even after our own
  parameter mapping changes.
- **`assets`** — outputs and uploads. Stores **object keys**, never absolute
  URLs, so the CDN hostname in front of storage can change without a data
  migration. `source` records whether a file was generated or uploaded.
- **`webhook_events`** — idempotency for Stripe and Clerk. Insert the event id
  first and let the unique constraint reject duplicates.

`provider` and `model` on `generations` are **strings, not enums**. Adding a
vendor must never require a migration.

---

## The design system

`styles/globals.css` is the whole visual language, in three layers:

1. **Scales** (`@theme`) — raw values. `--color-brand-500`, `--text-2xl`,
   `--ease-spring`. Semantic-free, rarely edited.
2. **Roles** (`:root` / `.dark`) — purpose mapped onto scales. `--surface-raised`,
   `--muted-foreground`, `--destructive`.
3. **Utilities** (`@theme inline`) — roles exposed as classes.

**Components use roles, never scales.** `bg-surface`, not `bg-neutral-900`. That
single rule is what makes the theme swappable.

The shadcn/ui variable contract is implemented in layer 2, so anything added with
`npx shadcn add` inherits the theme with no modification.

---

## Conventions worth stating

**Server by default.** A component is a Server Component unless it needs state,
effects, or browser APIs. `"use client"` is a deliberate choice with a reason,
pushed as far down the tree as possible — one at the top of a page drags the
entire subtree into the bundle.

**`server-only` on anything holding a secret.** `lib/stripe.ts` and `lib/r2.ts`
import it, so an accidental client import is a build error rather than a leaked
key.

**Authorisation lives in `services/`.** Not in components, not in route handlers,
and — because Clerk owns sessions — _not_ in Supabase RLS. There is one place to
audit.

**Every async surface has three states.** Empty, loading, error. AI generation
fails often enough that a happy-path-only component is a bug, not an omission.

**`cn()` on every `className` prop.** Without `tailwind-merge`, a caller's
override and the component's default both land in the class list and stylesheet
order decides the winner.

---

## Verification

```bash
npm run verify        # typecheck + lint + format check
npm run build         # prisma generate && next build
```

Husky runs `lint-staged` on commit and `typecheck` on push. The gate exists so
that "it builds on my machine" is not a claim anyone has to make.
