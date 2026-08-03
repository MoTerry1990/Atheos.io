# Atheos.io — Engineering Audit

**Audited at:** end of Sprint 13 ("Project Alpha complete"), before Sprint 14.
**Scope:** the whole repository at `C:\Users\mauri\Projects\atheos`.
**Method:** static inspection of every source file, the Prisma schema, the build
output, and the verification evidence recorded during Sprints 0–13.

> **The single fact that governs every score below.** Atheos has never been run
> against real infrastructure — no database, no Clerk instance, no Stripe
> account, no AI provider key, no object storage. There are **no tests** and
> **no migrations have ever been generated**. Everything server-side is code
> that typechecks and has never executed.
>
> This audit therefore distinguishes throughout between **written**, **verified
> in a browser against fixtures**, and **proven against a real dependency**.
> Only the first two have ever happened here.

> **Superseded in part by Sprint 14.** See `INFRASTRUCTURE_REPORT.md`. The
> migration gap is closed: `prisma/migrations/0_init/` now exists and its SQL
> has been applied to a real Postgres engine and verified. Two factual errors in
> this document were also corrected — the schema has **11** enums, not 12, and
> `planTier` is on `Subscription`, not `User`. Everything else below still
> stands, including the absence of tests.

**Size:** 289 source files, 42,869 lines (TS/TSX/CSS/Prisma, excluding generated
Prisma client and `node_modules`). ~1,900 lines of committed documentation.

---

# Executive Summary

## Scoring rubric

Scores are 0–100, where **100 = production-grade for a paying SaaS product**,
not "good relative to a prototype." A score of 0 means the discipline is
entirely absent. Higher is better in every row, including Technical Debt (where
a high score means _little_ debt).

| Dimension                | Score    | One-line justification                                                                    |
| ------------------------ | -------- | ----------------------------------------------------------------------------------------- |
| **Overall completion**   | **62 %** | Feature surface largely written; runtime entirely unproven                                |
| **Production readiness** | **22**   | Clean build and headers, but zero execution, zero tests, no migration, no observability   |
| **Architecture**         | **88**   | Genuinely strong layering, provider abstraction and ledger design                         |
| **UI / UX**              | **82**   | Complete design system, every state covered, verified at two breakpoints                  |
| **Security**             | **66**   | Good authorisation model and honest failure modes; no rate limiting, nothing pen-tested   |
| **Scalability**          | **45**   | Good indexes and cursor pagination, but 13 unbounded queries and no background worker     |
| **Code quality**         | **84**   | Strict TS, zero lint warnings, exceptional comments; some duplication and two large files |
| **Technical debt**       | **62**   | Debt is unusually well _documented_ — but the money code is the untested part             |
| **Performance**          | **55**   | Reasonable shared bundle; heavy studio route, no image pipeline, unbounded queries        |
| **Accessibility**        | **80**   | Structurally swept and fixed; never tested with an actual screen reader                   |
| **SEO**                  | **78**   | Metadata, ISR sitemap, robots, OG images, JSON-LD — but the landing page is unverified    |
| **Testing**              | **0**    | Zero test files of any kind                                                               |

## Overall completion — how 62 % is derived

Completion is weighted by _what it takes to charge a customer_, not by feature
count.

| Area                                        | Weight | Complete | Contribution |
| ------------------------------------------- | ------ | -------- | ------------ |
| UI surface and design system                | 20 %   | 92 %     | 18.4         |
| Application features (studio → admin)       | 25 %   | 85 %     | 21.3         |
| Data model and schema                       | 10 %   | 90 %     | 9.0          |
| Server pipeline (generation, credits, R2)   | 15 %   | 70 %     | 10.5         |
| Billing and identity integration            | 10 %   | 25 %     | 2.5          |
| Infrastructure (migrations, deploy, config) | 10 %   | 5 %      | 0.5          |
| Testing and observability                   | 10 %   | 0 %      | 0.0          |
|                                             |        |          | **62.2 %**   |

The last three rows are where the remaining 38 % lives, and they are the rows
that cannot be finished by writing more UI.

## The five things that matter most

1. **No migration exists.** Twenty-eight models and enums live only in
   `schema.prisma`. Nothing has been applied to a database, ever.
2. **No tests exist.** In a codebase whose correctness argument rests on an
   append-only ledger, idempotent webhooks and refund-exactly-once.
3. **No rate limiting anywhere.** Zero occurrences across the codebase. Every
   endpoint that costs money — generation, checkout, uploads — is unthrottled.
4. **No background worker.** The browser is the job runner. A closed tab stops
   a generation advancing until someone reopens the studio.
5. **`services/community/index.ts` is 955 lines** and
   `services/marketplace/catalogue.ts` is 665 — the two files most likely to
   need a second pair of eyes are the two hardest to read.

---

# Folder Structure

Every directory in the repository, and why it exists.

## Root

| Folder        | Why it exists                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `app/`        | Next.js App Router. Routing, layouts, and the HTTP boundary only — no business logic.                                           |
| `components/` | Presentational components with no feature knowledge. Anything here must be usable by any feature.                               |
| `features/`   | Feature-scoped UI, types and client API wrappers. A feature may import `components/`, never another feature.                    |
| `services/`   | Server-only business logic and data access. **Every authorisation check lives here.** Marked `import "server-only"`.            |
| `lib/`        | Cross-cutting infrastructure: env, Prisma client, auth helpers, HTTP client, R2, Stripe, Supabase, error mapping.               |
| `store/`      | Zustand client stores for state that must survive navigation (studio parameters and queue, UI chrome).                          |
| `hooks/`      | Intended home for shared React hooks. **Currently empty** — hooks ended up feature-local instead.                               |
| `utils/`      | Pure functions with no dependencies. One file: `format.ts`.                                                                     |
| `types/`      | Cross-cutting TypeScript types not owned by a feature.                                                                          |
| `providers/`  | React context providers composed once in the root layout (Clerk, theme, motion).                                                |
| `styles/`     | `globals.css` — the Tailwind v4 `@theme` block, i.e. the entire design-token layer. There is no `tailwind.config.js` by design. |
| `prisma/`     | `schema.prisma`. **No `migrations/` subdirectory exists.**                                                                      |
| `public/`     | Statically served assets.                                                                                                       |
| `docs/`       | Architecture, decisions, design system, launch checklist.                                                                       |
| `.husky/`     | Git hooks — `lint-staged` on commit.                                                                                            |
| `.claude/`    | Agent configuration for this repository.                                                                                        |

## `app/` — route groups

Route groups (parentheses) exist to give sections **different layouts without
changing URLs**. That is the whole reason there are six of them.

| Folder             | Why it exists                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/(marketing)/` | The public landing page. Its own layout: no app chrome, no auth requirement.                                                                                                                             |
| `app/(auth)/`      | Sign-in, sign-up, verification, password reset, SSO callback. A centred card layout with no navigation, so a half-authenticated user cannot wander.                                                      |
| `app/(app)/`       | The authenticated product. Its layout calls `requireUserId()` — **this is the gate**, so a new page inherits protection by existing here rather than by remembering.                                     |
| `app/(community)/` | Public community pages (`/explore`, `/u/[handle]`, `/p/[slug]`). Separate from `(app)` because they are indexable and readable signed out.                                                               |
| `app/(admin)/`     | The admin dashboard. Split into its own group in Sprint 12 specifically so `/admin` returns **404** rather than the `(app)` layout's 307 — a 307 leaked its existence.                                   |
| `app/(dev)/`       | Fixture-backed preview routes and the design-system gallery. Excluded from the Clerk middleware matcher and `noindex`ed. This is the only way anything server-dependent has ever been seen in a browser. |
| `app/api/`         | Route handlers. Thin: parse, validate with Zod, delegate to `services/`, map errors. No business logic.                                                                                                  |

## `app/api/` — endpoint groups

| Folder                      | Why it exists                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `api/admin/`                | Overview, users, credits, moderation, audit, status. Every route 404s to non-admins.                         |
| `api/assets/[id]/download/` | Redirects to a presigned R2 URL after an ownership check, rather than proxying bytes.                        |
| `api/billing/`              | Checkout, portal, subscription changes, and the billing summary.                                             |
| `api/collections/`          | The studio's project picker. Kept at this URL because renaming it would be churn with a regression attached. |
| `api/community/`            | Posts, comments, likes, follows, profiles, creators, publish.                                                |
| `api/folders/`              | Project folder CRUD.                                                                                         |
| `api/generations/`          | Submit and poll. The polling endpoint is what makes the client the job runner.                               |
| `api/marketplace/`          | Browse, detail, installed items.                                                                             |
| `api/projects/`             | Project CRUD, assets, duplicate.                                                                             |
| `api/uploads/`              | Reference-image ingest.                                                                                      |
| `api/webhooks/`             | `clerk/` and `stripe/`. Both signature-verified; both idempotent via `WebhookEvent`.                         |

## `features/` — one folder per product area

`account`, `admin`, `auth`, `billing`, `community`, `dashboard`, `marketing`,
`marketplace`, `projects`, `studio`. Each contains `components/`, and where it
talks to the server, a `lib/` with `api.ts` (typed fetch wrappers) and
`api-context.tsx`.

**`api-context.tsx` exists in five features for one reason:** it makes the API
module injectable so a preview route can substitute fixtures. Without it,
nothing server-backed could ever have been rendered in this environment. The
default is always the real module.

`features/studio/data/` holds the model catalogue and presets — static content,
separated from logic so it can be edited without touching code.

## `services/` — subfolders

| Folder                   | Why it exists                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `services/ai/`           | The provider abstraction. `types.ts` is the contract, `registry.ts` picks providers by configuration. |
| `services/ai/providers/` | One adapter per vendor. **Nothing outside this folder may import a vendor SDK.**                      |
| `services/admin/`        | Auth, analytics, users, moderation, status — split because it is the highest-privilege code.          |
| `services/billing/`      | Catalogue, plans, checkout, subscription, credits, reporting.                                         |
| `services/community/`    | Profiles, posts, social graph, handles.                                                               |
| `services/marketplace/`  | The first-party catalogue (code, not data) and install/favourite logic.                               |
| `services/storage/`      | R2 asset writes, presigned downloads, and the storage-configured check.                               |

## Empty directories — a real finding

`components/common/`, `hooks/`, `public/images/` and `public/fonts/` were
scaffolded in Sprint 0 and **are still empty**. They are not harmful, but they
advertise a structure that does not exist: a reader looking for shared hooks
will find a folder implying there are some.

`public/dev/` contains exactly one file, `fixture-clip.webm`, used by preview
routes.

---

# Technology Stack

Versions are the declared ranges in `package.json`.

## Framework and language

| Technology | Version  | Purpose                                                                                                                                |
| ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js    | ^15.5.22 | App Router, Server Components, route handlers, middleware. Pinned to 15 deliberately — 16 was current at scaffold and was rolled back. |
| React      | 19.2.4   | Exact-pinned, not a range, because RSC behaviour is version-sensitive.                                                                 |
| React DOM  | 19.2.4   | Renderer.                                                                                                                              |
| TypeScript | ^5       | `strict: true` throughout.                                                                                                             |
| Turbopack  | bundled  | Dev bundler (`next dev --turbopack`).                                                                                                  |

## Styling and UI

| Technology               | Version         | Purpose                                                                        |
| ------------------------ | --------------- | ------------------------------------------------------------------------------ |
| Tailwind CSS             | ^4              | CSS-first configuration. All tokens live in `styles/globals.css` `@theme`.     |
| @tailwindcss/postcss     | ^4              | PostCSS integration.                                                           |
| radix-ui                 | ^1.6.7          | Unstyled accessible primitives behind the `components/ui` layer.               |
| class-variance-authority | ^0.7.1          | Typed component variants.                                                      |
| clsx + tailwind-merge    | ^2.1.1 / ^3.6.0 | `cn()` — conditional classes with conflict resolution.                         |
| lucide-react             | ^1.28.0         | Icon set.                                                                      |
| motion                   | ^12.43.0        | Animation (Framer Motion v12). Wrapped by `MotionConfig reducedMotion="user"`. |
| next-themes              | ^0.4.6          | Dark/light with no flash of wrong theme.                                       |
| sonner                   | ^2.0.7          | Toasts.                                                                        |
| cmdk                     | ^1.1.1          | Command palette.                                                               |
| tw-animate-css           | ^1.4.0          | Animation utilities for Tailwind v4.                                           |

## Data and backend

| Technology            | Version  | Purpose                                                                          |
| --------------------- | -------- | -------------------------------------------------------------------------------- |
| Prisma                | ^7.9.1   | ORM and migration tool. `prisma-client` generator; config in `prisma.config.ts`. |
| @prisma/adapter-pg    | ^7.9.1   | Driver adapter — required for the pooled/direct connection split.                |
| pg                    | ^8.22.0  | PostgreSQL driver.                                                               |
| @supabase/supabase-js | ^2.111.0 | Managed Postgres host. **Not** used for auth. RLS cannot see Clerk sessions.     |
| @supabase/ssr         | ^0.12.4  | Server-side Supabase client.                                                     |
| zod                   | ^4.4.3   | Runtime validation at every trust boundary.                                      |
| @t3-oss/env-nextjs    | ^0.13.11 | Build-time env validation and the server/client type split.                      |

## Identity, payments, storage

| Technology                       | Version         | Purpose                                                     |
| -------------------------------- | --------------- | ----------------------------------------------------------- |
| @clerk/nextjs                    | ^7.6.3          | Authentication. Signals API — errors returned, not thrown.  |
| stripe                           | ^22.4.0         | Server SDK: checkout, portal, subscriptions, webhooks.      |
| @stripe/stripe-js                | ^9.12.1         | Client redirect to Checkout.                                |
| @aws-sdk/client-s3               | ^3.1098.0       | Cloudflare R2 via the S3 API — chosen for zero egress cost. |
| @aws-sdk/s3-request-presigner    | ^3.1098.0       | Presigned download URLs with `ResponseContentDisposition`.  |
| uploadthing / @uploadthing/react | ^7.7.4 / ^7.3.3 | Inbound user uploads (the browser half of storage).         |

## Client state

| Technology | Version | Purpose                                                                    |
| ---------- | ------- | -------------------------------------------------------------------------- |
| zustand    | ^5.0.14 | Studio parameters, queue and history; UI chrome. `persist` + `partialize`. |

## Tooling

| Technology                  | Version  | Purpose                                            |
| --------------------------- | -------- | -------------------------------------------------- |
| ESLint                      | ^9       | Flat config via `FlatCompat` shim.                 |
| eslint-config-next          | ^15.5.22 | Next.js rules.                                     |
| eslint-config-prettier      | ^10.1.8  | Disables formatting rules.                         |
| Prettier                    | ^3.9.6   | Formatting.                                        |
| prettier-plugin-tailwindcss | ^0.8.1   | Class ordering.                                    |
| Husky                       | ^9.1.7   | Git hooks.                                         |
| lint-staged                 | ^17.2.0  | Pre-commit lint/format, including `prisma format`. |
| dotenv                      | ^17.4.2  | Loads env for Prisma CLI.                          |

## Security overrides

`package.json` pins transitive dependencies: `postcss ^8.5.25`, `sharp ^0.35.3`,
`brace-expansion ^5.0.8`. `allowScripts` explicitly allowlists the five packages
permitted to run install scripts.

## Notably absent

**No test framework.** No Vitest, Jest, Playwright, Testing Library, or MSW.
**No error tracking** (Sentry or equivalent). **No rate limiter.** **No queue.**
**No logger** — `console.error` is the entire logging strategy.

---

# Pages

28 `page.tsx` files. "Complete" below means _the UI is finished and its data
path is written_; it does not mean it has ever run against a real backend.

## Complete

| Route                     | Notes                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` (marketing)           | Landing page — hero, showcase, features, templates, gallery, pricing, FAQ, footer. **Never rendered in a browser since Sprint 2** (Clerk's dev handshake intercepts `/`). |
| `/sign-in/[[...sign-in]]` | Custom Clerk flow, not the drop-in component.                                                                                                                             |
| `/sign-up/[[...sign-up]]` | Custom flow with OTP verification.                                                                                                                                        |
| `/verify-email`           | OTP entry.                                                                                                                                                                |
| `/forgot-password`        | Reset request.                                                                                                                                                            |
| `/reset-password`         | Reset completion.                                                                                                                                                         |
| `/sso-callback`           | OAuth landing.                                                                                                                                                            |
| `/dashboard`              | Workspace header, quick actions, credits, storage, recent projects, activity.                                                                                             |
| `/studio`                 | The core product. Composer, model picker, presets, camera, preview, queue, history, save-to-project.                                                                      |
| `/projects`               | Folder rail, search, recent, favourites, archive.                                                                                                                         |
| `/projects/[id]`          | Detail with autosaving metadata.                                                                                                                                          |
| `/marketplace`            | Browse, categories, search, favourites, install.                                                                                                                          |
| `/settings`               | Account settings hub.                                                                                                                                                     |
| `/settings/profile`       | Profile form and avatar upload.                                                                                                                                           |
| `/settings/billing`       | Plans, credits, invoices, usage, upgrade/downgrade.                                                                                                                       |
| `/profile`                | Public-profile settings (handle, bio, visibility).                                                                                                                        |
| `/explore`                | Community gallery with trending and featured.                                                                                                                             |
| `/u/[handle]`             | Public profile. Has `generateMetadata` with canonical + OG.                                                                                                               |
| `/p/[slug]`               | Public post. OG image emitted only when the asset really is an image.                                                                                                     |
| `/admin`                  | Analytics, users, credits, revenue, subscriptions, moderation, support, status.                                                                                           |

## Incomplete

| Route           | What is missing                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/studio`       | Audio modality is absent — the UI offers image and video only. Replicate model versions are `PLACEHOLDER` and rejected at submit, so no real model can be selected today. |
| `/marketplace`  | Voice packs install and then do nothing, because audio generation does not exist. The page says so.                                                                       |
| `/explore`      | Trending returns empty by design when nothing is published; featured creators is editorial and blank. Correct behaviour, but the page has never been seen with content.   |
| `/admin`        | "Reports" in the Sprint 12 brief became the moderation queue plus audit log. There is no report _builder_ or export.                                                      |
| `/` (marketing) | Content is real but unvalidated — no customer logos, no metrics, no testimonials, by the project's honesty constraint. Also literally unrendered.                         |

## Missing

| Route                     | Why it should exist                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/assets` (asset library) | Browse, search, filter and delete generated assets across all projects. Today assets are reachable only from inside one project. Named as missing since Sprint 8. |
| `/onboarding`             | Nothing greets a new user. They land on an empty dashboard with no first-run path.                                                                                |
| `/pricing`                | Pricing exists only as a landing-page section; there is no standalone, linkable, indexable pricing page.                                                          |
| Legal pages               | No terms, privacy policy, acceptable-use or DMCA/takedown page. A product with a public gallery and payments cannot launch without these.                         |
| `/support` or `/help`     | The admin side has support tooling; the customer side has no contact route.                                                                                       |
| `/settings/api`           | No customer-facing API, so no key management. Deliberately deferred.                                                                                              |

## Development-only routes

`/design-system`, `/dashboard-preview`, `/studio-preview`, `/projects-preview`,
`/billing-preview`, `/marketplace-preview`, `/community-preview`,
`/admin-preview`. All `noindex`, all excluded from the Clerk matcher, all
fixture-backed. **These must be removed or gated before a public launch** —
`/admin-preview` in particular renders the admin dashboard with the gate bypassed.
It uses fixtures, so it discloses no real data, but it discloses the entire admin
interface design to anyone who requests the URL.

---

# Components

## `components/ui/` — 41 primitives

`accordion`, `alert-dialog`, `avatar`, `badge`, `breadcrumb`, `button`, `card`,
`checkbox`, `collapsible`, `command`, `counter`, `data-table`, `dialog`,
`dropdown-menu`, `field`, `icon`, `input`, `label`, `loading`, `motion`,
`pagination`, `popover`, `progress`, `radio-group`, `scroll-area`, `select`,
`separator`, `sheet`, `skeleton`, `slider`, `sonner`, `stack`, `state`, `switch`,
`table`, `tabs`, `textarea`, `toggle`, `toggle-group`, `tooltip`, `typography`.

Non-obvious ones worth knowing:

- **`typography`** — `Heading` separates `size` from `as`, so visual weight never
  dictates heading level. Sprint 13 extended `as` to accept `"p" | "div"` after
  finding the design-system page had two `h1`s.
- **`state`** — empty / error / loading states as one component, because the
  project rule is that no surface ships without all three.
- **`stack`** — layout primitives (`Stack`, `Row`, `Grid`) so spacing comes from
  tokens rather than ad-hoc margins.
- **`motion`** — animation wrappers that respect `prefers-reduced-motion`.
- **`counter`** — animated numerals with tabular figures so digits do not jitter.
- **`icon`** — normalises Lucide sizing against the type scale.
- **`data-table`** — sorting and selection over the plain `table` primitive.

## `components/layout/` — 7

`app-shell`, `breadcrumbs`, `container`, `nav`, `page-header`, `sidebar`,
`top-bar`.

## Feature components — 78

**account (5):** `avatar-upload`, `danger-zone`, `notification-settings`,
`profile-form`, `theme-settings`.

**admin (2):** `admin-dashboard` (698 lines), `credit-dialog`.

**auth (8):** `auth-shell`, `forgot-password-form`, `oauth-buttons`, `otp-input`,
`password-field`, `reset-password-form`, `sign-in-form`, `sign-up-form`,
`verify-email-form`.

**billing (3):** `billing-screen` (635 lines), `plan-card`, `usage-panel`.

**community (6):** `explore`, `post-tile`, `post-view`, `profile-settings`,
`profile-view`, `publish-dialog`.

**dashboard (9):** `activity-feed`, `app-shell`, `credits-card`,
`dashboard-view`, `notifications-menu`, `quick-actions`, `recent-projects`,
`storage-card`, `workspace-header`.

**marketing (14):** `ai-showcase`, `animated-background`, `artwork`, `faq`,
`features`, `gallery`, `hero`, `how-it-works`, `pricing`, `section`,
`site-footer`, `site-header`, `structured-data`, `templates`, `trusted-by`.

**marketplace (3):** `item-card`, `item-detail`, `marketplace-browser`.

**projects (6):** `folder-rail`, `name-dialog`, `project-card`, `project-detail`,
`projects-browser`, `save-indicator`.

**studio (12):** `model-picker`, `output-actions`, `output-settings`,
`output-tile`, `preview-panel`, `prompt-editor`, `queue-and-history`,
`reference-upload`, `save-to-project`, `studio-workspace`, `style-and-camera`,
`video-settings`.

## Providers — 4

`clerk-provider`, `theme-provider`, `motion-provider`, and `index` which
composes them.

## Reusability observation

The `components/ui` layer is genuinely feature-agnostic and reused widely — that
part of the architecture holds. But `components/common/` is empty, and several
patterns that _are_ duplicated across features (the card-with-overlay-link
pattern in `project-card` and `item-card`; the async list + search + filter shell
in `projects-browser` and `marketplace-browser`) were never lifted. That is the
folder's missing content.

---

# Features

## Complete

| Feature                | Notes                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design system          | Three-layer tokens, oklch colour, dark mode inverting elevation, documented in `docs/DESIGN-SYSTEM.md` and a live gallery.                                                             |
| Landing page           | All sections built with real (non-fabricated) content.                                                                                                                                 |
| Authentication UI      | Custom Clerk flows for sign-in, sign-up, OTP, reset, OAuth.                                                                                                                            |
| Account settings       | Profile, avatar, theme, notifications, danger zone.                                                                                                                                    |
| Dashboard              | Metrics, quick actions, recent projects, activity feed.                                                                                                                                |
| Studio (image + video) | Text-to-image, image-to-image, variations, upscale, background removal, text-to-video, image-to-video, duration, camera motion, negative prompts, queue, progress, downloads, history. |
| Project management     | Create, rename, delete, duplicate, archive, folders, search, recent, favourites, autosave, metadata.                                                                                   |
| Marketplace            | Templates, prompt packs, style packs, characters, voice packs, search, categories, favourites, installs — wired into the studio.                                                       |
| Community              | Public profiles, gallery, likes, comments, collections, followers, trending, featured.                                                                                                 |
| Admin dashboard        | Analytics, users, credits, revenue, subscriptions, moderation, support, system status, audit log.                                                                                      |
| Error handling         | Three boundaries, per-route loading states, domain errors mapped to HTTP consistently.                                                                                                 |
| SEO                    | Metadata, ISR sitemap, robots, OG image generation, JSON-LD.                                                                                                                           |

## Partial

| Feature                 | What works                                                                                                     | What does not                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AI generation**       | Full pipeline written: submit, poll, debit, store, refund. Exercised end-to-end against the **mock** provider. | Never run against a real provider. All Replicate versions are `PLACEHOLDER` and rejected at submit. OpenAI adapter supports one model (`gpt-image-1`). |
| **Billing**             | Plans, checkout, portal, upgrade, downgrade, invoices, usage, credit packs, webhook handling — all written.    | Not one Stripe call has been made. Idempotency is designed but unproven, which is the highest-risk unknown in the project.                             |
| **Identity sync**       | Clerk webhook creates the user row and the signup grant in one transaction.                                    | Never fired. Without `CLERK_WEBHOOK_SIGNING_SECRET`, sign-ups silently create no user row.                                                             |
| **Job execution**       | Resumable polling survives a reload.                                                                           | The client is the runner. A closed tab stalls the job indefinitely. No reconciler.                                                                     |
| **Storage**             | R2 writes and presigned downloads written; ownership checked.                                                  | Never written a byte. No thumbnailing, no range requests, no lifecycle policy.                                                                         |
| **Moderation**          | Queue, oldest-first, dismiss-with-reason, audited.                                                             | No automated content scanning of any kind on a product that generates and publishes images publicly.                                                   |
| **Admin authorisation** | Verified 404 for anonymous callers on every route.                                                             | The signed-in-non-admin path has never been exercised.                                                                                                 |

## Missing

| Feature                       | Impact                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Audio / voice generation**  | Third modality named in the product concept. Two voice packs are catalogued and marked unusable.                                 |
| **Asset library**             | No cross-project asset browsing, searching or deletion.                                                                          |
| **Third-party publishing**    | The marketplace is first-party and code-defined. Opening it needs an items table, submission flow, moderation and revenue split. |
| **Bulk actions / export**     | No multi-select, no bulk download, no account data export (a GDPR concern).                                                      |
| **Teams / shared workspaces** | Deliberately deferred until single-user demand exists.                                                                           |
| **Onboarding**                | No first-run experience at all.                                                                                                  |
| **Notifications**             | The dashboard has a notifications menu; nothing generates notifications.                                                         |
| **Rate limiting**             | Absent everywhere.                                                                                                               |
| **Observability**             | No error tracking, no structured logs, no metrics, no cost-per-generation.                                                       |

---

# Database

## Schema overview

`prisma/schema.prisma` — 630 lines, **16 models and 11 enums**, PostgreSQL,
accessed through the `pg` driver adapter.

## Tables (models)

| Model                 | Purpose                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`                | Mirror of Clerk identity plus product state: `creditBalance`, `role`, `handle`, profile and follower-count fields. `planTier` lives on `Subscription`, not here. |
| `Subscription`        | Mirror of Stripe subscription state. Stripe is the source of truth.                                                                                              |
| `CreditTransaction`   | **Append-only ledger.** Every balance change, with `balanceAfter` and an optional unique `idempotencyKey`.                                                       |
| `Generation`          | One AI request: provider, model, operation, status, params, cost, `providerJobId`, self-referencing lineage.                                                     |
| `Asset`               | An output or upload: `storageKey`, `mimeType`, `kind`, `source`, `checksum`, soft-delete via `deletedAt`.                                                        |
| `Folder`              | Project organisation. Unique `(userId, name)`.                                                                                                                   |
| `Collection`          | A project. Named `Collection` in storage, "project" in the product language.                                                                                     |
| `CollectionAsset`     | Join table, composite primary key `(collectionId, assetId)`.                                                                                                     |
| `AdminAuditLog`       | Append-only record of every admin action, **including reads**.                                                                                                   |
| `Post`                | A published community post.                                                                                                                                      |
| `PostLike`            | Composite PK `(postId, userId)` — the schema makes double-liking impossible.                                                                                     |
| `Comment`             | Threaded on a post, with `reportedAt` for moderation.                                                                                                            |
| `Follow`              | Social graph. Composite PK `(followerId, followingId)`, dual named relations.                                                                                    |
| `MarketplaceFavorite` | Composite PK `(userId, itemSlug)` — slug, not FK, because the catalogue is code.                                                                                 |
| `MarketplaceInstall`  | Composite PK `(userId, itemSlug)`, plus `kind` for filtering.                                                                                                    |
| `WebhookEvent`        | Idempotency ledger for Clerk and Stripe. Insert-first; the unique constraint rejects replays.                                                                    |

## Enums

`BillingInterval`, `SubscriptionStatus`, `PlanTier`, `CreditReason`, `Modality`,
`GenerationOperation`, `GenerationStatus`, `AssetKind`, `AssetSource`, `Role`,
`MarketplaceKind`.

## Relationships

25 declared relations. The delete policy is deliberate and consistent:

- **`onDelete: Cascade`** — everything owned by a user (subscriptions, credit
  transactions, generations, assets, folders, collections, posts, likes,
  comments, follows, marketplace rows). Deleting a user removes their data.
- **`onDelete: SetNull`** — cross-entity references that must **survive** the
  deletion of the other side: `CreditTransaction.generation`,
  `Asset.generation`, `Generation.parent`, `Collection.folder`. This is what
  keeps the ledger readable after a generation is removed, and it is the right
  call: a financial record that disappears with the thing it paid for is not a
  ledger.
- **Self-referencing:** `Generation` ↔ `Generation` (`GenerationLineage`) for
  variations and upscales; `User` ↔ `User` via `Follow` with named
  `"Following"` / `"Followers"` relations.

## Indexes

**37 declared** `@@index`, `@@unique` and composite `@@id` entries. The pattern
is consistently `(userId, <sort key>)` for per-user lists, which is correct for
every query the services actually issue.

| Model                 | Indexes                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `User`                | `createdAt`                                                                                                                      |
| `Subscription`        | `status`, `currentPeriodEnd`                                                                                                     |
| `CreditTransaction`   | `(userId, createdAt)`                                                                                                            |
| `Generation`          | `(userId, createdAt)`, `status`, `(provider, providerJobId)`, `parentId`                                                         |
| `Asset`               | `(userId, createdAt)`, `generationId`, `checksum`                                                                                |
| `Folder`              | unique `(userId, name)`                                                                                                          |
| `Collection`          | unique `(userId, name)`, unique `(userId, publicSlug)`, `(userId, lastOpenedAt)`, `(userId, archivedAt)`, `folderId`, `sharedAt` |
| `CollectionAsset`     | PK `(collectionId, assetId)`, index `assetId`                                                                                    |
| `AdminAuditLog`       | `(actorId, createdAt)`, `(subjectType, subjectId)`, `(action, createdAt)`                                                        |
| `Post`                | `publishedAt`, `(userId, publishedAt)`, `featuredAt`                                                                             |
| `PostLike`            | PK `(postId, userId)`, `(userId, createdAt)`, `(postId, createdAt)`                                                              |
| `Comment`             | `(postId, createdAt)`, `reportedAt`                                                                                              |
| `Follow`              | PK `(followerId, followingId)`, `(followingId, createdAt)`                                                                       |
| `MarketplaceFavorite` | PK `(userId, itemSlug)`, `(userId, createdAt)`                                                                                   |
| `MarketplaceInstall`  | PK `(userId, itemSlug)`, `(userId, kind)`                                                                                        |
| `WebhookEvent`        | `(source, processedAt)`                                                                                                          |

### Index gaps

- **`User.handle`** — public profile lookup is `/u/[handle]`, a per-request query
  on every profile page view. It has a unique constraint (implying an index) but
  no explicit composite for the "profiles with published posts" query the sitemap
  runs.
- **Trending** ranks by like counts over a recent window. There is no index that
  serves that directly; it will do work proportional to recent likes. Fine at
  zero posts, not fine at a million.
- **Full-text search.** Project and marketplace search are `contains` filters,
  which cannot use a B-tree index. At scale these become sequential scans. A
  `pg_trgm` GIN index or a `tsvector` column is the fix, and neither exists.

## Missing migrations

**This is the most serious infrastructure gap in the project.**

- `prisma/migrations/` **does not exist**. Not empty — absent.
- Zero migrations have ever been generated or applied.
- `prisma generate` has run many times (the client is in `lib/generated/prisma`);
  `prisma migrate` has never run at all.
- Every Prisma query in `services/` typechecks against a generated client and has
  never reached a database.

The consequence is not merely "run a command before deploying." It is that the
schema has never been validated by Postgres: no constraint, no default, no
enum, no cascade rule, and no index in this file has ever been proven to be
accepted, let alone correct. `npx prisma migrate dev --name initial` should be
the very next command executed on this project, and its generated SQL should be
read line by line.

---

# Authentication

## Current status

**Provider:** Clerk 7 (`@clerk/nextjs ^7.6.3`), using the signals API — errors
are _returned_, not thrown, and `finalize()` replaces `setActive`.

**Written and complete:**

- Custom sign-in, sign-up, email OTP verification, password reset, OAuth and SSO
  callback screens — not the drop-in component, so the flows match the design
  system.
- `middleware.ts` establishes session context and records the pathname for
  post-sign-in redirect. It performs **no route protection**, deliberately.
- `lib/auth.ts` exposes `getUserId`, `requireUserId`, `getClerkUser`,
  `getCurrentUser`, `requireUser`.
- `app/(app)/layout.tsx` calls `requireUserId()`, so pages inherit protection by
  location rather than by a matcher pattern.
- Every service module gates itself: a private `requireApiUser()` throws a
  domain error with status 401.
- `api/webhooks/clerk` verifies the signature and creates the user row plus the
  signup credit grant in one transaction, idempotent via `WebhookEvent`.

**The authorisation model is the strongest part of this codebase.** Clerk 7
deprecated middleware route protection because path matching is a _model_ of the
route tree that drifts from the router. This project responded correctly: it
moved protection to the resource. Every query in `services/projects.ts` carries
`userId` in its `where` clause, and mutations use `updateMany` scoped by
`userId` rather than `update` by id — so a wrong id affects zero rows instead of
someone else's.

## Verified

- Anonymous requests to authenticated API routes return **401**.
- Anonymous requests to `/admin` and every `/api/admin/*` route return **404**,
  while `/studio` returns 307 — so the admin route's existence does not leak.

## Missing work

| Gap                                                                                                                                                                                                                                                     | Severity |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Nothing has ever authenticated.** No sign-up, sign-in, OAuth or reset has executed against a Clerk instance.                                                                                                                                          | Critical |
| **The webhook has never fired.** If `CLERK_WEBHOOK_SIGNING_SECRET` is unset, `lib/env.ts` treats it as optional — sign-ups will succeed in Clerk and create **no user row**, and the failure is silent. This should arguably be required in production. | Critical |
| **The signed-in non-admin path is untested.** It shares `isAdmin()` with the verified anonymous path, but sharing a code path is an argument, not evidence.                                                                                             | High     |
| **No rate limiting on auth endpoints.** Credential stuffing and password-reset spam are unthrottled. Clerk provides some protection on its own hosted endpoints, but the custom flows and our webhook receiver have none.                               | High     |
| **No session-revocation story.** Nothing invalidates our mirrored state when Clerk revokes a session mid-request.                                                                                                                                       | Medium   |
| **No MFA, no organisations.** Clerk supports both; neither is wired up.                                                                                                                                                                                 | Medium   |
| **6× duplicated `requireApiUser()`** across `projects`, `collections`, `generation`, `billing/checkout`, `community`, `marketplace`. Six copies of the security-critical entry check.                                                                   | Medium   |

---

# Stripe

## Current implementation

**SDK:** `stripe ^22.4.0` server-side, `@stripe/stripe-js ^9.12.1` client-side.
**Files:** `lib/stripe.ts`, `services/billing/` (catalogue, plans, checkout,
subscription, credits, reporting), `app/api/billing/*`,
`app/api/webhooks/stripe`.

**Catalogue.** Four plan prices (Studio/Scale × monthly/yearly) and three credit
packs (1,000 / 5,000 / 20,000), each behind an optional env var. A plan whose
price id is missing is displayed but not purchasable, and asking for it fails
with a message naming the variable — the app builds and runs with billing
entirely unconfigured.

**Flows written:** Checkout session creation, billing portal, subscription
upgrade (immediate, prorated) and downgrade (scheduled to period end, nothing
removed early), invoice listing, usage reporting, billing history.

## Webhook status

`app/api/webhooks/stripe/route.ts`:

- Signature verified with `STRIPE_WEBHOOK_SECRET` before the body is parsed.
  Confirmed in this environment: an unsigned request is refused, not processed.
- Idempotent via the `WebhookEvent` table, keyed on Stripe's event id.
  Insert-first, and the unique constraint rejects the duplicate — the database
  is the guard, not application logic someone might forget.
- Grants are written as `CreditTransaction` rows with a deterministic
  `idempotencyKey`, so a replayed event grants nothing.

**Status: written, never fired.** Not one Stripe event has been received.

## Subscriptions

`Subscription` mirrors Stripe: `status`, `planTier`, `interval`,
`currentPeriodEnd`, `cancelAtPeriodEnd`, indexed on `status` and
`currentPeriodEnd`. The stated rule is that **Stripe is the source of truth** and
our table is a mirror — when they disagree, Stripe wins.

## Credits

The strongest design decision in the project, and the least verified.

- `credit_transactions` is **insert-only**. `User.creditBalance` is a cached sum
  written in the same transaction as the entry that changed it.
- Every row carries `balanceAfter`, so a statement renders without replaying
  history.
- `idempotencyKey` is unique. A P2002 violation means "already done", and is
  treated as success rather than failure.
- Refunds use `idempotencyKey = refund:{generationId}` — exactly-once by
  construction.
- Admin adjustments write a `MANUAL_ADJUSTMENT` row inside a transaction with the
  balance update and the audit row. Never a bare `UPDATE`. Balances cannot go
  negative; adjustments are capped at 1,000,000.

## Missing work

| Gap                                                                                                                                                                                                                                                                        | Severity |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Zero Stripe API calls have ever been made.** Checkout, portal, plan change, invoice retrieval — all unexecuted.                                                                                                                                                          | Critical |
| **Webhook idempotency is unproven.** The design is right; nothing has demonstrated it. Redelivering a `checkout.session.completed` from the Stripe dashboard and confirming it grants **nothing** the second time is the single most valuable test this project could run. | Critical |
| **No tests around the ledger.** Balance arithmetic, refund-once, negative-balance guard, cap — all unverified.                                                                                                                                                             | Critical |
| **No handling for disputes or chargebacks.** `charge.dispute.created` is not handled. A disputed payment leaves granted credits in place.                                                                                                                                  | High     |
| **No dunning / failed-payment flow.** `invoice.payment_failed` has no user-facing consequence.                                                                                                                                                                             | High     |
| **Revenue reporting is reconstructed from our ledger**, not reconciled with Stripe, and is labelled approximate in the admin UI. Correct labelling, but it means there is no reconciliation job.                                                                           | Medium   |
| **No tax handling.** No Stripe Tax, no VAT/GST collection. A blocker for EU/UK sales.                                                                                                                                                                                      | High     |
| **No proration preview.** The upgrade flow charges immediately without showing the amount first.                                                                                                                                                                           | Medium   |

---

# AI Providers

## Architecture

The abstraction is defined in `services/ai/types.ts` (229 lines) and resolved by
`services/ai/registry.ts`.

**The contract.** Every provider implements `AIProvider`: `id`, `isConfigured()`,
`listModels()`, submit, and poll. Generation is **submit-then-poll**, not
request-response, because AI jobs outlive an HTTP request. Errors are normalised
into `ProviderError` so the pipeline never branches on a vendor's error shape.

**The rule.** Nothing outside `services/ai/providers/` may import a vendor SDK.
If a feature knows which provider it is talking to, the abstraction has failed.
This rule holds across the codebase today.

**Selection by configuration.** `REAL_PROVIDERS` is filtered by
`isConfigured()`. If any real provider has a key, only real providers are
offered. If none does, the registry returns the mock **alone** — the mock never
sits alongside real models where a user could pick it by accident, and
`isUsingMockProvider()` exists so the interface can say so out loud.

**Pricing** lives in `services/ai/pricing.ts`, imported by both the studio (for
the pre-flight estimate) and the pipeline (for the debit), so the number shown
and the number charged are the same function.

## Supported

Operations declared by the contract: `text-to-image`, `image-to-image`,
`variations`, `upscale`, `remove-background`, `text-to-video`,
`image-to-video`. Modalities: `IMAGE`, `VIDEO`. `AUDIO` exists in the schema
enum but has no provider, no models and no UI.

## Integrated

| Provider      | Status                                                                                                                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mock**      | Fully working and the only one ever executed. Stamps its output "not AI generated" and triggers a studio banner. This is what made the whole pipeline verifiable without a key.                                                                                             |
| **Replicate** | Adapter complete (390 lines) — submit, poll, five models across image and video. **All five `version` hashes are `PLACEHOLDER_*` and rejected at submit** with a clear error rather than sent to the API. Unusable until real hashes are supplied from a Replicate account. |
| **OpenAI**    | Adapter complete (236 lines). One model, `gpt-image-1`, supporting text-to-image, image-to-image and variations. Enabled by `OPENAI_API_KEY`. Never called.                                                                                                                 |

## Pending

| Item                        | Notes                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Real Replicate versions** | Five placeholder hashes. Blocks every Replicate model, including all video.                                  |
| **Audio provider**          | No adapter, no models, no UI. The third modality of the product concept.                                     |
| **Provider failover**       | If a provider is down, the request fails. No circuit breaker, no second choice.                              |
| **Cost tracking**           | We price in credits but never record what a generation cost _us_. Unit economics are unmeasurable.           |
| **Model capability drift**  | The catalogue is hand-maintained. Nothing detects a model being deprecated upstream.                         |
| **Content safety**          | No prompt filtering, no output moderation, on a product that publishes generated images to a public gallery. |

---

# Security Review

## Strengths, stated first because they are real

- **Authorisation lives with the resource**, not in a middleware matcher. This
  is the correct architecture and it is applied consistently.
- **Every per-user query is scoped by `userId` in the `where` clause**, and
  mutations use `updateMany` scoped by owner rather than `update` by id.
- **Both webhooks verify signatures** before parsing, and are idempotent through
  a database constraint rather than application logic.
- **404 rather than 403** for the admin surface, verified end-to-end for
  anonymous callers.
- **Admin actions are audited, including reads**, in the same transaction as the
  change, with a required written reason.
- **The env layer enforces the server/client split in the type system**, so a
  secret cannot be imported into a client component.
- **The download route checks ownership** even though the bucket is public,
  specifically to avoid becoming a signing oracle.
- **Security headers ship**: CSP (Report-Only), `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Strict-Transport-Security`.

## Potential vulnerabilities

| #   | Finding                                                                                                                                                                                                                                                                                                                                | Severity     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | **No rate limiting anywhere.** Zero occurrences in the codebase. Generation costs money per call; checkout creates Stripe objects; uploads consume storage; auth endpoints are brute-forceable. A single authenticated user can exhaust their credits, our provider quota and our storage in a loop.                                   | **Critical** |
| 2   | **CSP is Report-Only and includes `'unsafe-inline'` in `script-src`.** Report-Only blocks nothing at all, and `unsafe-inline` would substantially weaken it even when enforced. The nonce-based fix requires per-request header generation in middleware.                                                                              | High         |
| 3   | **`CLERK_WEBHOOK_SIGNING_SECRET` is optional.** If unset in production, sign-ups create no user row and fail silently. Same for `STRIPE_WEBHOOK_SECRET`: without it the billing webhook cannot verify, so either it rejects everything or — worse, if ever changed — accepts anything.                                                 | High         |
| 4   | **Preview routes are publicly reachable in production.** `/admin-preview` renders the complete admin interface with the gate bypassed. Fixture data only, so no real disclosure, but it publishes the design of every internal tool. They are excluded from the Clerk matcher, which means they are excluded from session context too. | High         |
| 5   | **No content moderation on generation or publishing.** Users can generate arbitrary imagery and publish it to a public, indexable gallery with no automated scanning. This is a legal and platform-safety exposure, not merely a product gap.                                                                                          | High         |
| 6   | **No account data export or deletion flow.** Cascade rules exist in the schema, but nothing in the product triggers them. GDPR/CCPA erasure and portability are unimplemented.                                                                                                                                                         | High         |
| 7   | **Public object storage.** R2 objects are served from a public base URL and protected only by unguessable keys. The download route checks ownership; the direct URL does not. Anyone who obtains a URL keeps access forever — there is no expiry on the public path.                                                                   | Medium       |
| 8   | **`SUPABASE_SERVICE_ROLE_KEY` is present and RLS is unusable.** The key bypasses row-level security, and Clerk sessions are invisible to Postgres, so RLS provides no defence in depth. The service layer is the _only_ thing standing between a query and someone else's data.                                                        | Medium       |
| 9   | **No CSRF protection beyond same-origin defaults.** Route handlers accept JSON `POST` from any origin the CORS default permits. No origin check, no CSRF token.                                                                                                                                                                        | Medium       |
| 10  | **Search inputs go into Prisma `contains` filters.** Prisma parameterises, so this is not injection — but the queries are unbounded and unindexed, making them a cheap denial-of-service vector.                                                                                                                                       | Medium       |
| 11  | **`console.error` is the entire logging strategy.** There is no way to detect an attack in progress, and no alerting on repeated 401s, failed webhook verifications or refund storms.                                                                                                                                                  | Medium       |
| 12  | **No dependency scanning in CI** — indeed no CI at all. The `overrides` block shows manual patching of `postcss`, `sharp` and `brace-expansion`, which is diligent but unrepeatable.                                                                                                                                                   | Medium       |
| 13  | **Six duplicated `requireApiUser()` implementations.** A fix or hardening applied to one will not reach the other five.                                                                                                                                                                                                                | Medium       |
| 14  | **Comment content is user-generated and rendered.** React escapes by default so this is likely safe, but there is no explicit sanitisation policy and no test asserting it.                                                                                                                                                            | Low          |

## Recommendations, in priority order

1. **Add rate limiting before anything else ships.** Per-user and per-IP, on
   generation, uploads, checkout, comments, follows and auth. Upstash Redis or
   an equivalent; a middleware wrapper applied at the service entry point so it
   cannot be forgotten on a new route.
2. **Make both webhook secrets required in production.** Change the env schema
   to demand them when `NODE_ENV === "production"`.
3. **Remove or authenticate the `(dev)` route group in production builds.**
   Gate on `NODE_ENV !== "production"` at the layout level.
4. **Move the CSP to enforcing with nonces.** Generate a per-request nonce in
   middleware, drop `'unsafe-inline'`, then flip `CSP_ENFORCE=1` after watching
   reports.
5. **Collapse the six `requireApiUser()` copies** into one exported helper that
   throws a shared error type. Security-critical code should exist once.
6. **Add content moderation** on generation input and on publish. At minimum a
   provider-side safety filter plus a report-and-review path (the moderation
   queue already exists to receive it).
7. **Implement account deletion and export.** The cascade rules are already
   correct; the product needs to be able to trigger them.
8. **Add error tracking and structured logging** with alerting on auth failures,
   webhook verification failures and refund volume.
9. **Add CI** running typecheck, lint, format, build and `npm audit` on every
   push.

---

# Performance Review

## Measured

From the production build (`next build`):

| Metric                 | Value             |
| ---------------------- | ----------------- |
| Shared First Load JS   | **102 kB**        |
| Largest chunk          | 54.2 kB           |
| Middleware             | **90.9 kB**       |
| `/settings`            | 298 kB First Load |
| `/studio-preview`      | 290 kB            |
| `/studio`              | 283 kB            |
| `/design-system`       | 268 kB            |
| `/projects`            | 200 kB            |
| Typical community page | ~150 kB           |
| Compile time           | ~6 s              |

102 kB shared is respectable for a React 19 app with Clerk. **283 kB on
`/studio` is not** — that is the page users spend all their time on, and it is
the second-heaviest route in the app.

## Potential bottlenecks

| #   | Bottleneck                                                                                                                                                                                                                                                                                                                                              | Impact   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **13 of 31 `findMany` calls have no `take`.** Unbounded in `services/projects.ts` (4 of 5), `services/marketplace/index.ts` (3 of 3), `services/admin/analytics.ts` (4 of 4), `services/collections.ts` (2 of 2). A user with 5,000 projects loads all 5,000 rows into memory and ships them in one JSON response.                                      | **High** |
| 2   | **Client-driven job polling.** Every in-flight generation is an interval firing HTTP requests from the browser. Ten concurrent jobs is ten polling loops per user, each hitting the database. There is no server-side push and no backoff beyond what the client implements.                                                                            | High     |
| 3   | **`contains` search is a sequential scan.** Project and marketplace search cannot use a B-tree index. It is free at 100 rows and pathological at 100,000.                                                                                                                                                                                               | High     |
| 4   | **No image pipeline.** `next/image` is deliberately disabled for assets (asset hosts are per-deployment, so `remotePatterns` cannot be known at build time), so every gallery renders full-size originals with a raw `<img>`. A grid of 24 posts can pull tens of megabytes. There is no thumbnailing, no responsive `srcset`, no AVIF/WebP conversion. | **High** |
| 5   | **No video thumbnails or range requests.** Video tiles load whole files to show a first frame.                                                                                                                                                                                                                                                          | High     |
| 6   | **Middleware is 90.9 kB and runs on nearly every request.** Clerk's cost is unavoidable, but the matcher currently includes far more than it needs to.                                                                                                                                                                                                  | Medium   |
| 7   | **Trending has no supporting index.** Ranking by recent like volume will scan.                                                                                                                                                                                                                                                                          | Medium   |
| 8   | **`services/community/index.ts` runs 8 `findMany` calls**, several with nested relation counts. Post lists with author, like count, comment count and viewer-liked state are a classic N+1 shape unless every one is a single aggregate query.                                                                                                          | Medium   |
| 9   | **No caching layer at all.** No Redis, no `unstable_cache`, no React `cache()`. The marketplace catalogue is static code and still re-derived per request.                                                                                                                                                                                              | Medium   |
| 10  | **The admin dashboard is one 698-line component** issuing several analytics aggregates. It will be the slowest page in the product.                                                                                                                                                                                                                     | Medium   |
| 11  | **No connection-pool tuning.** The pooled URL is configured but no pool size is set for serverless concurrency.                                                                                                                                                                                                                                         | Low      |

## Optimization opportunities

**Immediate, cheap, high return**

1. Add `take` to every unbounded `findMany`, with cursor pagination where the
   list can genuinely be long. Community already does this correctly — copy the
   pattern to projects, marketplace and collections.
2. Add a `pg_trgm` GIN index (or a `tsvector` column) for project and
   marketplace search.
3. Add an index supporting the trending query.

**Medium effort, largest user-visible win**

4. **Build a thumbnailing pipeline.** Generate a small WebP/AVIF derivative on
   asset write and serve it in every grid. This is the single biggest
   improvement available to perceived performance, and it also cuts R2 transfer.
5. Add `poster` images and range-request delivery for video.
6. Code-split the studio. Camera controls, video settings, advanced parameters
   and reference upload can all be dynamically imported — they are not needed on
   first paint.

**Structural**

7. **Move job execution server-side.** A worker plus a reconciler removes the
   polling load, fixes the closed-tab failure, and lets the client subscribe
   instead of poll.
8. Cache the marketplace catalogue and plan catalogue in module scope — they are
   static.
9. Narrow the middleware matcher to routes that genuinely need session context.
10. Add a performance budget to CI so route weight cannot silently grow.

---

# Code Quality

## Architecture review

**The layering is genuinely good and consistently enforced:**

```
app/          routing + HTTP boundary only
  ↓
features/     feature UI, no cross-feature imports
  ↓
components/   presentational, feature-agnostic
  ↓
services/     server-only business logic + authorisation
  ↓
lib/          infrastructure (env, prisma, auth, http, r2, stripe)
```

Verified properties:

- Route handlers are thin — parse, validate with Zod, delegate, map errors.
  `app/api/projects/route.ts` is 96 lines including a 20-line explanatory
  comment, and contains no business logic.
- `services/` files all carry `import "server-only"`, so a client import is a
  build error rather than a leak.
- No vendor SDK is imported outside `services/ai/providers/`.
- Errors are domain objects (`ProjectError`, `BillingError`, …) with `message`,
  `status` and `code`, mapped to HTTP in exactly one place.
- The `api-context.tsx` injection pattern in five features is a legitimately
  clever answer to "how do you verify UI with no backend", and it caught real
  bugs a typecheck never would.

**Documentation is exceptional and unusual.** Nearly every non-trivial file opens
with a comment explaining _why_, and `docs/DECISIONS.md` records 45 decisions in
a strict decision → why → cost format. This is the highest-value artefact in the
repository.

## Duplicate code

Sprint 13 collapsed six copies of `request<T>()` and three error responders. The
same exercise was not finished:

| Duplication                                      | Count | Notes                                                                                                                                                     |
| ------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`requireApiUser()`**                           | **6** | `projects`, `collections`, `generation`, `billing/checkout`, `community`, `marketplace`. Identical shape, six different error classes. Security-critical. |
| **`api-context.tsx`**                            | 5     | Near-identical React context boilerplate per feature. Justifiable — the types differ — but a generic factory would remove ~200 lines.                     |
| **Card-with-overlay-link pattern**               | 2     | `project-card.tsx` and `item-card.tsx` implement the same `after:absolute inset-0` technique, including the same z-index bug fixed twice.                 |
| **Browser shell (search + filter + async list)** | 2     | `projects-browser.tsx` (467 lines) and `marketplace-browser.tsx` (368 lines) share a great deal of structure.                                             |
| **Domain error classes**                         | 6     | Each declares `message`/`status`/`code` independently. `lib/api-response.ts` already treats them structurally; a shared base would remove the repetition. |

## Files that are too large

| File                                              | Lines | Concern                                                                         |
| ------------------------------------------------- | ----- | ------------------------------------------------------------------------------- |
| `services/community/index.ts`                     | 955   | Profiles, posts, likes, comments, follows, trending and featured in one module. |
| `services/projects.ts`                            | 742   | 11 exported functions plus folder management.                                   |
| `features/admin/components/admin-dashboard.tsx`   | 698   | Nine dashboard sections in one client component.                                |
| `services/marketplace/catalogue.ts`               | 665   | Mostly data, which is defensible.                                               |
| `features/billing/components/billing-screen.tsx`  | 635   | Plans, credits, invoices, usage and both plan-change flows.                     |
| `services/generation.ts`                          | 526   | The pipeline. Complex by nature, but this is the code most needing review.      |
| `features/studio/components/studio-workspace.tsx` | 518   | The core page.                                                                  |

## Refactoring suggestions, ordered by value

1. **Extract one shared `requireApiUser()`** into `lib/auth.ts` throwing a shared
   `AuthError`. Six copies of an authorisation check is the highest-risk
   duplication in the codebase.
2. **Introduce a `DomainError` base class** and let the six error types extend
   it. `lib/api-response.ts` currently uses structural typing precisely to avoid
   this refactor — a decision documented as a trade-off, and worth revisiting now
   that the shape has proven stable.
3. **Split `services/community/index.ts`** into `posts.ts`, `social.ts` and
   `discovery.ts`, mirroring how `services/admin/` and `services/billing/` are
   already organised. Those two are the models to follow.
4. **Split `admin-dashboard.tsx`** into one component per section.
5. **Extract the overlay-link card** into `components/common/` — the folder that
   exists for exactly this and is empty.
6. **Extract a `useBrowser` hook or `<BrowserShell>`** shared by the projects and
   marketplace browsers.
7. **Generalise `api-context.tsx`** into a typed factory.
8. **Delete the empty directories** (`hooks/`, `public/images/`, `public/fonts/`)
   or fill them. An empty folder is a claim the codebase does not honour.

## What raises quality that is often absent

- `strict: true`, zero `any` escapes found, zero lint warnings at
  `--max-warnings 0`.
- Pre-commit hooks running lint, format and `prisma format`.
- A `verify` script chaining typecheck, lint and format check.
- Comments that explain _why_, including comments that record bugs previously
  fixed at that spot so they are not reintroduced.

---

# Testing

## Unit tests

**None.** Zero files match `*.test.ts`, `*.test.tsx`, `*.spec.ts` or
`*.spec.tsx`. No test framework is installed.

Highest-value targets, in order:

1. `services/billing/credits.ts` — grant, debit, refund, idempotency, negative
   guard, cap.
2. `services/ai/pricing.ts` — the estimate and the debit must agree; a pure
   function and trivially testable.
3. `services/community/handles.ts` — handle normalisation and reservation.
4. `utils/format.ts` — relative time, byte and currency formatting. The
   "120.00¢ per credit" bug found in Sprint 9 was exactly this kind of error.
5. `lib/prisma-errors.ts` — P2002/P2025 classification, which the ledger's
   correctness depends on.
6. `features/studio/lib/job-mapper.ts` and `dto.ts` — pure mapping.

## Integration tests

**None.** Nothing exercises a route handler, a service against a database, or a
webhook end to end.

Highest-value targets:

1. **Stripe webhook replay** — deliver the same event twice, assert exactly one
   grant. This is the most important test in the project.
2. **Clerk webhook** — user row plus signup grant in one transaction; replay
   grants nothing.
3. **Generation refund** — force a failure, assert exactly one refund.
4. **Ownership isolation** — user A cannot read, update or delete any of user
   B's projects, assets, folders or posts, across every route.
5. **Admin gate for a signed-in non-admin** — currently the largest untested
   authorisation path.
6. **Concurrent credit spend** — two simultaneous generations against a balance
   that only covers one.

A Postgres container plus `prisma migrate deploy` makes all of these runnable;
the blocker is that no migration exists.

## E2E tests

**None.** No Playwright, no Cypress.

The manual browser verification performed each sprint against fixture-backed
preview routes is real evidence and it caught genuine bugs — a 59px overflow, a
dead card centre, a double-mounted panel, 16px close buttons, several heading
errors. But it is manual, unrepeatable, and covers only what fixtures can reach.

Minimum useful E2E suite once infrastructure exists: sign-up → verify →
dashboard; generate → wait → download; subscribe → verify credits → cancel;
publish → view public post → unpublish.

## Coverage

**0 %.** Not "low" — none.

There is no coverage tooling, no CI, and no threshold. Every claim about this
codebase's behaviour rests on the compiler, careful reading, and manual browser
checks against fixtures.

**Score: 0/100.** No other dimension in this audit scores zero, and no amount of
architectural quality compensates. A ledger whose correctness argument is
"the design is right" is a ledger nobody has checked.

---

# Deployment

## Current readiness

**Ready:**

- Production build compiles clean: `tsc --noEmit`, `eslint --max-warnings 0`,
  `prettier --check`, `next build`.
- Security headers verified on a real `next start` response.
- Cache policy verified: `/api/*` returns
  `no-store, no-cache, must-revalidate, private`; `/_next/static/*` immutable for
  a year; `/dev/*` one day plus `X-Robots-Tag: noindex`.
- Error boundaries and per-route loading states exist.
- `sitemap.xml` regenerates hourly via ISR rather than freezing at build.
- `lib/env.ts` fails the build on a missing required variable, naming it.
- Optional variables degrade honestly and say so in the interface.
- `.env.example` documents every variable with what breaks without it.

**Not ready:**

- **No migration exists.** Nothing can be deployed to a database.
- **No CI/CD.** No pipeline, no automated checks on push, no deploy automation.
- **No staging environment.**
- **No monitoring, alerting or error tracking.**
- **No backup or restore procedure.**
- **No incident runbook.**
- **Preview routes are publicly reachable** and would ship as-is.
- **CSP is Report-Only**, so it enforces nothing.
- **No load testing** against real provider latency.

## Missing infrastructure

| Component            | Status  | Notes                                                            |
| -------------------- | ------- | ---------------------------------------------------------------- |
| PostgreSQL           | Missing | Two connection strings needed — pooled (6543) and direct (5432). |
| Migrations           | Missing | Directory does not exist.                                        |
| Clerk instance       | Missing | Plus webhook endpoint and signing secret.                        |
| Stripe account       | Missing | Plus 7 price ids and a webhook endpoint.                         |
| R2 bucket            | Missing | Plus a public base URL.                                          |
| AI provider key      | Missing | Plus real Replicate version hashes.                              |
| Redis / rate limiter | Missing | Required before public traffic.                                  |
| Background worker    | Missing | Required to fix the closed-tab failure.                          |
| Error tracking       | Missing | Sentry or equivalent.                                            |
| CI pipeline          | Missing | Typecheck, lint, format, build, audit.                           |
| Staging              | Missing | Migrations must be applied somewhere before production.          |
| Backups              | Missing | Automated snapshots plus a _tested_ restore.                     |
| Status page          | Missing | The admin dashboard has system status; customers have nothing.   |

## Recommended deployment order

Each step is a prerequisite for the next. Do not reorder.

**Phase 1 — make it runnable at all**

1. Provision Postgres; set `DATABASE_URL` (pooled) and `DIRECT_URL` (direct).
2. `npx prisma migrate dev --name initial`. **Read the generated SQL.**
3. Apply to a staging database with `prisma migrate deploy`.
4. Create the Clerk instance; set keys, webhook endpoint and signing secret.
5. Set `ADMIN_USER_IDS` to your own Clerk user id.
6. Deploy to staging. Sign up. Confirm the user row and the signup grant exist.

**Phase 2 — prove the money code**

7. Stripe test mode: seven prices, `stripe listen` forwarding to the webhook.
8. Subscribe. Confirm exactly one `SUBSCRIPTION_GRANT`.
9. **Redeliver that webhook from the dashboard. Confirm it grants nothing.** If
   this fails, stop and fix it before anything else.
10. Upgrade, then downgrade. Confirm proration and period-end scheduling.
11. R2 bucket and public URL. Generate once against the mock provider; confirm
    the debit, the write and the asset row.
12. Force a failure; confirm exactly one refund.

**Phase 3 — make it safe to expose**

13. Add rate limiting on generation, uploads, checkout, comments and auth.
14. Gate or remove the `(dev)` route group in production.
15. Make both webhook secrets required when `NODE_ENV === "production"`.
16. Add error tracking and structured logging with alerts.
17. Add CI: typecheck, lint, format, build, `npm audit`.
18. Move the CSP to nonces and set `CSP_ENFORCE=1` after reading reports.

**Phase 4 — make it real**

19. Real AI provider key and real Replicate version hashes. Generate for real.
20. Write the integration tests listed above; wire them into CI.
21. Configure backups and **test a restore**.
22. Load test against real provider latency.
23. Add legal pages and account deletion/export.

**Phase 5 — production**

24. Apply migrations to production.
25. Deploy with all variables set.
26. Register both webhook endpoints in live mode.
27. Work the checklist in `docs/LAUNCH.md` against production.
28. Open to a small closed group before public traffic.

---

# Roadmap

## What should be built next

The ordering principle: **nothing new until the existing code has been proven to
run.** Thirteen sprints produced a large, coherent, well-reasoned codebase in
which no server-side line has ever executed. Sprint 14 should not add a feature.

### Sprint 14 — Make it run (highest priority)

1. Generate and apply the first migration.
2. Provision Postgres, Clerk, Stripe test mode, R2.
3. Execute the `docs/LAUNCH.md` first-run checklist end to end.
4. Fix whatever it uncovers — and it will uncover things, because 42,869 lines
   have never met a database.

**Exit criterion:** a real user can sign up, generate against the mock provider,
subscribe in test mode, and have every credit movement explained by the ledger.

### Sprint 15 — Prove it (equal priority)

1. Install Vitest; unit-test the ledger, pricing, handles, formatting and Prisma
   error classification.
2. Integration tests against a Postgres container: webhook replay, refund-once,
   ownership isolation, admin gate for a signed-in non-admin.
3. Playwright covering the four critical journeys.
4. CI running all of it, plus typecheck, lint, format, build and audit.

**Exit criterion:** the webhook-replay test passes, and it is impossible to merge
a change that breaks it.

### Sprint 16 — Make it safe

1. Rate limiting everywhere it costs money.
2. Gate the `(dev)` routes out of production.
3. Require webhook secrets in production.
4. CSP with nonces, enforcing.
5. Error tracking, structured logging, alerting.
6. Content moderation on generation and publish.
7. Account deletion and data export.
8. Legal pages.

**Exit criterion:** the product could be shown to a stranger without a lawyer
objecting.

### Sprint 17 — Make it fast

1. `take` and cursor pagination on all 13 unbounded queries.
2. Thumbnailing pipeline plus responsive images — the biggest single UX win
   available.
3. Video posters and range requests.
4. `pg_trgm` search indexes; a trending index.
5. Code-split the studio.
6. Background worker plus reconciler, replacing client polling.

**Exit criterion:** a gallery of 24 posts loads in under a second on a phone.

### Sprint 18 and beyond — Make it complete

- Audio and voice generation, behind the same adapter interface. This unblocks
  the two voice packs already sitting in the marketplace marked unusable.
- The asset library.
- Onboarding and first-run experience.
- Real Replicate version hashes and provider failover.
- Cost-per-generation tracking, so unit economics become measurable.
- Third-party marketplace publishing.
- Teams and shared workspaces.

## The honest summary

Atheos is an unusually well-architected codebase with an unusually well-documented
set of decisions, and it has never been switched on. Its weaknesses are not
design weaknesses — the layering, the provider abstraction, the append-only
ledger, the resource-scoped authorisation and the 404-not-403 discipline are all
things most shipped products get wrong.

Its weakness is that **none of it has been tested by reality**, and the two
gaps that follow from that — no migrations, no tests — are precisely the two
that no amount of further building will close. Sprints 14 and 15 are not
optional preliminaries to the roadmap. They _are_ the roadmap.
