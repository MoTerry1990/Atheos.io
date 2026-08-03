# Atheos.io

A premium AI creative platform. Generate images, video, audio and creative assets
across multiple AI providers from one interface.

**Status: Sprint 0 — foundation.** No product surface exists yet. This repository
currently contains the scaffolding everything else will be built on: routing,
design system, data model, service clients and the tooling gate.

---

## Stack

| Layer        | Choice                                                        |
| ------------ | ------------------------------------------------------------- |
| Framework    | Next.js 15 (App Router) · React 19 · TypeScript strict        |
| Styling      | Tailwind CSS v4 (CSS-first) · shadcn/ui · Motion              |
| Identity     | Clerk                                                         |
| Database     | Supabase PostgreSQL · Prisma 7 (pg driver adapter)            |
| Billing      | Stripe                                                        |
| Storage      | Cloudflare R2 (generated output) · UploadThing (user uploads) |
| Client state | Zustand                                                       |
| Tooling      | ESLint 9 · Prettier · Husky · lint-staged                     |

Every one of these choices is justified — including the ones that look
redundant, like two storage systems — in [`docs/DECISIONS.md`](docs/DECISIONS.md).

---

## Getting started

Requires **Node.js 20+** (developed on 24 LTS).

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `.env.local`. Only five variables are required to boot:
`NEXT_PUBLIC_APP_URL`, `DATABASE_URL`, `DIRECT_URL`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and
`STRIPE_SECRET_KEY`. The rest are needed by the sprint that uses them. Every
variable is documented inline in `.env.example`.

```bash
npm run db:generate
npm run dev
```

The app runs at http://localhost:3000.

> **Note on configuration.** A missing or malformed environment variable fails
> the **build**, by name, rather than surfacing later as an unauthenticated
> request. That is deliberate — see `lib/env.ts`.

---

## Scripts

| Command                           | Does                                               |
| --------------------------------- | -------------------------------------------------- |
| `npm run dev`                     | Dev server with Turbopack                          |
| `npm run build`                   | `prisma generate` then a production build          |
| `npm run verify`                  | Typecheck, lint, and format check — the full gate  |
| `npm run lint` / `lint:fix`       | ESLint                                             |
| `npm run format` / `format:check` | Prettier                                           |
| `npm run typecheck`               | `tsc --noEmit`                                     |
| `npm run db:migrate`              | Create and apply a migration (dev)                 |
| `npm run db:deploy`               | Apply migrations (production)                      |
| `npm run db:studio`               | Prisma Studio                                      |
| `npm run db:push`                 | Push schema without a migration (prototyping only) |

Husky runs `lint-staged` on commit and `typecheck` on push.

---

## Layout

```
app/          routes and layouts — composition only, no logic
features/     vertical slices; each owns its components and actions
components/   ui (shadcn) · layout (Container, PageHeader, AppShell) · common
services/     business logic and integrations — the only place a vendor SDK lives
lib/          configured clients: prisma, stripe, r2, supabase, env, utils
hooks/        shared React hooks
store/        Zustand — ephemeral client state only
styles/       globals.css — the entire design system
types/        types shared across features
utils/        pure functions, no I/O
prisma/       schema and migrations
docs/         architecture and decisions
```

Dependencies run one way: `app` → `features` → `services` → `lib`. Nothing lower
reaches back up.

---

## The three rules

**1. Providers are replaceable.** Nothing outside `services/ai` may import a
vendor SDK or branch on which provider is in use. The product's value _is_ that
seam; if a feature knows who it is talking to, the abstraction has failed.

**2. External systems own their state.** Clerk owns identity, Stripe owns
billing. Our tables mirror them via webhook and never resolve a conflict in their
own favour.

**3. Credits are a ledger, not a number.** `credit_transactions` is append-only.
A correction is a new row with the opposite sign, never an edit.

---

## Documentation

|                                                |                                                        |
| ---------------------------------------------- | ------------------------------------------------------ |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the pieces fit, directory rules, request lifecycle |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)       | Every Sprint 0 decision, why, and what it costs        |
| [`ROADMAP.md`](ROADMAP.md)                     | Sprints 0–11 and what is deliberately deferred         |
| [`CLAUDE.md`](CLAUDE.md)                       | Working agreements for AI-assisted development         |

---

## Known gaps in Sprint 0

Stated so they read as decisions rather than oversights:

- **`ClerkProvider` and auth middleware are not wired.** They land in Sprint 1
  with the auth surface. Wiring a provider that throws without live credentials
  is a worse foundation than one honest gap.
- **No Content-Security-Policy.** Needs the real origin list for Clerk, Stripe,
  each AI provider and the R2 hostname. Still open as of Sprint 7 — it lands
  with the operational hardening in Sprint 11, where the production origins are
  actually known.
- **No tests.** There is no behaviour to test yet, and tests over scaffolding
  calcify it. They arrive with the credit ledger in Sprint 2.
- **No migration has been run.** The schema validates and the client generates;
  `npm run db:migrate` needs a real database.
