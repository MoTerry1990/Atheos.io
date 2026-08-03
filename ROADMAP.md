# Atheos.io — Roadmap

A premium AI creative platform: images, video, audio and creative assets from
multiple AI providers behind one interface.

The ordering principle is **every sprint ships something that can be run in
production**. No sprint exists purely to prepare for another one; each closes
with a working vertical slice, even if it is narrow.

---

## Sprint 0 — Foundation ✅

_No product surface. Nothing user-facing. The scaffolding everything else stands on._

- Next.js 15 (App Router) · React 19 · TypeScript strict
- Tailwind CSS v4 with a CSS-first design system · shadcn/ui · Motion
- ESLint · Prettier · Husky · lint-staged · path aliases
- Typed, validated environment layer — misconfiguration fails the build
- Service clients wired: Clerk, Supabase, Prisma/PostgreSQL, Stripe,
  UploadThing, Cloudflare R2
- Data model: users, generations, assets, credits, subscriptions
- Dark mode, typography, spacing, colour, animation, breakpoints
- Reusable layout primitives
- Production config: security headers, image policy, strict builds

**Exit criteria:** `npm run build` passes clean, `npm run lint` and
`npm run typecheck` pass, a commit is blocked by Husky when they don't.

---

## Sprint 1 — Design system ✅

_Every surface the product will ever be built from._

- Foundations: typography, colour, spacing, elevation, gradients, motion, icons
- Controls: buttons, inputs and `Field`, cards, badges, dropdowns, selects
- Overlays: dialog, alert dialog, sheet, popover, tooltip
- Data: table with a mobile card layout, pagination
- Feedback: spinners, progress, skeletons, toasts, empty and error states
- Navigation: sidebar with mobile drawer, top bar, nav, breadcrumbs
- Live gallery at `/design-system`, plus `docs/DESIGN-SYSTEM.md`

**Exit criteria:** every component renders in both themes, verified at 375px with
no horizontal overflow, and both themes measured against WCAG AA.

> Reordered from the original plan, which had identity here. The design system
> came first so that the auth screens are assembled from finished
> components rather than inventing styling as they go — and so the visual
> language is decided once, not per-feature.

---

## Sprint 2 — Landing page ✅

_The first thing anyone sees._

- Thirteen sections: nav, hero, animated background, trusted by, AI showcase,
  features, how it works, templates, gallery, pricing, FAQ, footer
- Motion throughout — orchestrated hero entrance, scroll reveals, sliding tab
  and billing pills, animated FAQ accordion
- CSS-only animated background: aurora, drifting orbs, masked grid, grain
- SEO: full metadata, canonical, generated OG image, sitemap, robots, and
  Organization / WebSite / SoftwareApplication / FAQPage structured data
- One content module — the FAQ renders as both accordion and JSON-LD from a
  single source, so structured data cannot drift from the page

**Exit criteria:** zero console errors, no horizontal overflow at 375px, every
tap target ≥ 24px, one `h1`, and a clean production build.

> Reordered again: identity moves to Sprint 3. The landing page is what makes
> the product explicable, and it needs the design system that Sprint 1 built —
> whereas auth needs neither.

**Honesty constraints held during this sprint**, recorded because they will be
under pressure later: no invented customer logos, no fabricated usage metrics,
no `aggregateRating` in structured data without real reviews, and no stock
imagery presented as model output. The gallery says on the page that its
artwork is procedural.

---

## Sprint 3 — Authentication ✅

_The first real user record._

- Custom sign-in, sign-up, verify-email, forgot-password and reset-password
  screens built on Clerk 7 signals, plus OAuth and an SSO callback
- `ClerkProvider` in the composition root, themed with our design tokens
- **Resource-based** authorisation — `requireUserId()` / `requireUser()` at each
  protected surface, not a middleware path matcher
- Clerk → Postgres user sync via a signature-verified, idempotent webhook, with
  the 200-credit signup grant written in the same transaction as the ledger entry
- Account area: profile, avatar upload, theme, notification preferences, and a
  type-to-confirm delete

**Exit criteria:** protected routes redirect signed-out users to sign-in with the
destination preserved; unsigned webhook posts are rejected with 400; typecheck,
lint and production build all clean.

> **Not verified end-to-end.** These flows are typechecked and render correctly,
> but no sign-up has actually been completed — that needs a real Clerk instance,
> and this repository has only a structurally-valid placeholder key. First task
> with live credentials: run one signup, one OAuth login, one password reset, and
> confirm the webhook creates the user row and the credit ledger entry.

**Deferred deliberately:** MFA and enterprise SSO. Both are supported by the same
API but each is a flow with its own screens; accounts with MFA get an explicit
"not wired up yet" message rather than a silent failure.

---

## Sprint 4 — Dashboard ✅

_The room the product happens in._

- App shell: sidebar with mobile drawer, top navigation, credit pill,
  notifications menu with unread state
- Workspace header with animated counters, five quick actions
- Credits card, storage ring with per-kind breakdown
- Recent projects grid, merged activity timeline
- Real Prisma queries in `services/dashboard.ts`, batched into one transaction
- A `DashboardData` contract shared by the service and a fixture set, so
  `DashboardView` is a pure function of its data

**Exit criteria:** no horizontal overflow at 375px, every tap target ≥ 24px,
empty and pending states designed rather than defaulted, clean build.

> Reordered again — the generation core moves to Sprint 5. The dashboard is
> where generation results will land, so building the container first means
> Sprint 5 has somewhere to put its output.

**The verification split matters more than the components.** The dashboard needs
a database and a Clerk session, neither of which exists here, so the UI would
otherwise be unverifiable. Splitting data access from presentation and adding
`/dashboard-preview` (fixtures, three states, `noindex`) means the real
components were actually rendered and measured rather than only typechecked.
That is what caught the 59px mobile overflow.

**Still unverified:** every Prisma query in `services/dashboard.ts`. They
typecheck against the generated client, but no query has been run. First task
with a live database: load the dashboard for a seeded account and confirm the
aggregates, the activity merge ordering and the storage breakdown.

---

## Sprint 5 — AI Studio ✅

_The core product, as interface and state._

- Composer: model picker, prompt editor with templates, negative prompt,
  reference upload with per-image strength, style presets, camera controls,
  aspect ratio, size, outputs, creativity, seed with lock
- Results: preview panel, live queue, history, working downloads
- `store/studio-store.ts` — params (persisted), queue (ephemeral), history
  (persisted, capped)
- Capability-driven rendering: every control comes from the selected model's
  declared `ModelCapabilities`, and `reconcileParams` repairs settings the new
  model cannot honour

**Exit criteria:** the job lifecycle reaches every state, the queue is never
persisted, switching models repairs invalid params, no overflow at 375px.

> **No AI provider is connected, and the interface says so.** A banner states it,
> outputs are obviously procedural, and downloaded files carry a stamp. The
> models in the catalog are fictional on purpose — naming a real vendor would
> advertise an integration that does not exist.

`features/studio/lib/local-runner.ts` drives the lifecycle on timers so the
queue, progress, failure and history states can actually be reached and
reviewed. It fails one job in eight, because the failure path is the one a
happy-path demo never exercises. **Sprint 6 deletes that file** and replaces it
with a server-side pipeline; the `StudioJob` shape the components consume does
not change.

---

## Sprint 6 — AI image generation ✅

_The studio, connected to something real._

- Provider contract extended with **operations**: text-to-image, image-to-image,
  upscale, background removal, variations
- Three adapters behind it — Replicate (all five operations), OpenAI
  (generation and edits), and an explicitly labelled mock
- `services/ai/registry.ts` selects providers by configured credentials; adding
  a token makes its models appear with no deploy and no feature flag
- Server pipeline: credit debit and generation row in one transaction, provider
  call outside it, outputs copied into R2, idempotent refund on failure
- `POST /api/generations`, `GET|DELETE /api/generations/[id]`
- Studio wired to the server; `local-runner.ts` deleted
- Derived operations offered from a finished result, with `parentId` lineage

**Exit criteria:** unauthenticated API calls return 401 JSON, invalid input
returns field-level 400s, the studio degrades to a readable error rather than
crashing, and typecheck, lint and build are clean.

> **Not verified end to end.** The pipeline needs a database, a Clerk session
> and R2 credentials, none of which exist in this environment. Every code path
> is typechecked and the API contract is exercised, but no generation has
> actually run. First task with real infrastructure: one submit against the mock
> provider, confirming the ledger debits, the asset lands in R2 and a forced
> failure refunds exactly once.

**The mock provider is the fallback, not a peer.** When no credentials are
configured the registry offers it so the whole pipeline stays reviewable —
credits, storage, refunds and error states all execute for real. The moment a
real provider is configured the mock disappears entirely, and the studio shows a
banner whenever it is active. Its output is an SVG with "Mock provider — not AI
generated" rendered into the image itself.

**Replicate model versions are placeholders.** Replicate pins models by version
hash; ours are marked `PLACEHOLDER` and rejected at submit with a clear message.
Inventing plausible-looking hashes would have failed as an opaque 422 instead.

**Known limitation:** the client is the job runner. Each poll advances the
generation, so closing the tab mid-run leaves a job at RUNNING until the user
returns. A scheduled reconciler belongs with the operational work in Sprint 11.

**Project saving** is complete server-side — a `collectionId` on the request
files results into a collection as they are stored. The UI for choosing one
arrives in Sprint 7.

---

## Sprint 7 — AI video generation ✅

_The same pipeline, one modality wider._

- Provider contract extended with **text-to-video** and **image-to-video**.
  Nothing above `services/ai` learned a new shape: capabilities gained
  `durations` and `cameraMotions`, the request gained `durationSeconds` and
  `cameraMotion`, and the queue, ledger and storage path are unchanged
- Replicate video adapter and a mock video model whose runs are long enough to
  exercise the indeterminate-progress and resumption paths
- `services/ai/motion.ts` — one camera-motion vocabulary shared by every video
  adapter, because the phrases are prompt text
- **The operation is derived, not chosen.** Model modality plus the presence of
  a reference determines it; the composer states what it derived rather than
  adding a mode switch for something it already knows
- Duration and camera-motion controls, rendered from declared capabilities.
  Duration is buttons, not a slider — models accept specific lengths
- `services/ai/pricing.ts` — one cost function imported by both the composer's
  estimate and the server's debit, so they cannot drift. Video scales linearly
  from the shortest declared clip
- `POST /api/uploads` — references now reach storage, which is what makes
  image-to-image and image-to-video possible at all. Uploaded on drop, not at
  submit
- Video playback in the preview, branching on the asset's own MIME type
- `GET /api/assets/[id]/download` — ownership check, then a redirect to a
  presigned URL carrying the attachment header. The bytes never pass through us
- **Resumable polling.** The bootstrap splits the server's generations by status
  and re-attaches to anything unfinished. With images a closed tab was a few
  seconds of exposure; with a two-minute clip it is the normal case
- `GET|POST /api/collections` and `POST /api/collections/[id]/assets`, with a
  save-to-project picker beside every finished result

**Exit criteria:** typecheck, lint and production build clean; the video
composer, playback, downloads and the project picker exercised in a browser at
375px and 1280px.

> **Verified against fixtures, not a provider.** There is still no database,
> Clerk instance or R2 bucket in this environment. `/studio-preview` seeds the
> store directly so the video path can be played and clicked — that is how the
> modality switch, the duration pricing and the `<video>` branch were confirmed.
> The API routes were exercised only to the point of their 401s. First task with
> real infrastructure: one video generation end to end.

**Known limitation, unchanged:** the client is still the job runner. Resumption
narrows the window — a job stalls only while nobody has the studio open — but a
scheduled reconciler is still the real fix, and still belongs in Sprint 11.

---

## Sprint 8 — Project management ✅

_Somewhere for the work to live._

- **Folders**, flat by design (§ 22). Deleting one unfiles its projects rather
  than deleting them, enforced by `onDelete: SetNull` in the schema
- **Create, rename, duplicate, archive, delete.** Duplicate copies memberships,
  not files, and generates a free name because `(userId, name)` is unique
- **Archive is not delete** (§ 23). Archiving hides a project everywhere but the
  Archived view; deleting removes the project and keeps every generation inside
  it, which the confirmation dialog states with a count
- **Search** across name, description and tags, debounced and abortable
- **Recent**, driven by `lastOpenedAt` rather than `updatedAt` — a bulk archive
  is not someone opening a project
- **Favourites**, optimistic because it is the one control people click twice
- **Auto Save** (§ 24) — `useAutosave` with a five-state machine, a flush on
  unmount, and no overlapping writes. The indicator never claims "Saved" before
  the request resolves
- **Project metadata**: description, notes, tags, accent hue, cover image, plus
  derived item count and total size
- `services/projects.ts`, `/api/projects`, `/api/projects/[id]`,
  `/api/projects/[id]/duplicate`, `/api/projects/[id]/assets`, `/api/folders`,
  `/api/folders/[id]`
- Projects graduated from a disabled nav item to a real destination

**Exit criteria:** typecheck, lint and production build clean; every action
exercised in a browser at 375px and 1280px.

> **Verified against a fixture backend, not a database.** There is still no
> Postgres, Clerk instance or R2 bucket here, so the projects client was made
> injectable (§ 25) and `/projects-preview` wires the real components to an
> in-memory implementation. Every interaction listed above was clicked. The API
> routes were exercised only to their 401s, and **the migration has not been
> run** — `prisma generate` succeeds, `prisma migrate dev` needs a database.

**Found by clicking it, not by typechecking it:** the folder-delete confirmation
promised to unfile two projects while the result reported three, because the
dialog used the rail's visible count and archived projects move too. Folders now
carry both counts.

---

## Sprint 9 — Billing ✅

_Money, and the discipline that comes with it._

- **Plan catalogue**, split in two (§ 29): `catalogue.ts` holds tiers, amounts
  and allowances with no `env`; `plans.ts` adds the Stripe price ids and is
  server-only. The landing page derives from the first, so it can no longer
  advertise a price checkout does not charge
- **Checkout** for subscriptions and one-off credit packs, hosted by Stripe —
  card details never touch our origin
- **Stripe billing portal** for cards, tax ids and receipts
- **Webhook** (§ 26) — signature-verified, idempotent twice over, and the
  **only** place a credit is granted or a plan changes. Nothing is granted on
  the success redirect
- **Credits**: allowance granted per paid invoice (twelve months at once on a
  yearly plan), packs fulfilled on `checkout.session.completed`
- **Upgrade now, downgrade at the period end** (§ 27). A downgrade never
  removes what has already been paid for, and is the only one of the two that
  asks for confirmation
- **`PAST_DUE` still entitles** (§ 28). Access stops at `UNPAID`, after every
  Stripe retry has failed
- **Invoices** live from Stripe; **billing history** from the credit ledger,
  which also covers everything that never touched a card
- **Usage** over the billing period — net of refunds, broken down by modality
  and by model
- `PlanTier`, `BillingInterval`, `scheduledTier`, and `stripeCustomerId` moved
  onto `User` so a pack-only buyer needs no fake subscription row

**Exit criteria:** typecheck, lint and production build clean; every billing
state exercised in a browser at 375px and 1280px; unauthenticated requests
rejected before any configuration is disclosed.

> **Verified against a fixture backend, not Stripe.** No Stripe account, no
> database. `/billing-preview` runs the real `BillingScreen` against an
> in-memory implementation with five scenarios — free, subscribed, past due,
> cancelling, unconfigured. Upgrade, downgrade, cancel and resume were all
> clicked. Checkout in the preview **refuses** rather than redirecting
> somewhere: a fixture that pretended to take a payment would be teaching the
> wrong thing.
>
> **No money has moved.** The migration has not been run either. First tasks
> with real infrastructure: `prisma migrate deploy`, then `stripe listen` and
> one test-mode subscription end to end — confirming the allowance is granted
> once, and exactly once, when the invoice webhook is redelivered.

**Found by looking at it:** the credit-pack line quoted "120.00¢ per credit" for
a credit costing 1.2¢ — `amount` is already in minor units and was being
multiplied by 100 again. Also fixed: the checkout routes ran their
configuration check _before_ authentication, so an unauthenticated caller was
told which environment variables our deployment was missing.

---

## Sprint 10 — Marketplace ✅

_Somewhere to get more than the built-ins._

- **Five item kinds**: templates, prompt packs, style packs, characters and
  voice packs, each with a discriminated payload rather than a bag of optional
  fields
- **Catalogue in code** (§ 30), like the AI model registry — thirteen items that
  exist on a fresh database with no seed step. Only favourites and installs are
  rows
- **Everything is first-party and says so** (§ 31). No invented publishers, no
  ratings, no download counts. Cards show what is inside — "12 prompts",
  "6 styles" — because that is a fact we actually have
- **Voice packs are catalogued and marked unusable.** Audio does not exist yet;
  a listing that says why beats one that quietly is not there
- **Search** across title, summary, description and tags; **categories** as a
  closed list so the filter row cannot drift; **favourites** and **downloads**
  as views on the same grid
- **The detail sheet shows everything before installing** (§ 32) — every prompt,
  every style fragment, every trait. Extends Sprint 5's "presets are visible
  text" rule to somebody else's text
- **Installs are snapshots**, so editing a pack in the repository cannot change
  work already built on it — it raises an "Update available" badge instead
- **Wired into the studio**: installed prompts join the Templates menu grouped
  under their pack name, installed styles join the preset chips with namespaced
  ids, and characters insert their anchor **into the prompt field** where it
  stays editable
- `/api/marketplace` is public; favouriting and downloading require an account

**Exit criteria:** typecheck, lint and production build clean; browse, search,
categories, favourites, downloads, install and the studio integration all
exercised in a browser at 375px and 1280px.

> **Verified against the real catalogue.** Unusually for this project, the data
> here is not invented — the catalogue is code, so `/marketplace-preview`
> browses exactly what production would. Only favourites and installs are held
> in memory, because those are the only parts that need a database. The
> migration for `marketplace_favorites` and `marketplace_installs` **has not
> been run**.

**Two bugs found by measuring rather than looking.** The item card's click
overlay had no `z-index`, so it painted beneath the siblings that followed it —
the middle of the card was dead and only the 22px title strip was clickable.
And the design system's dialog and sheet close buttons have been 16×16 since
Sprint 1, below WCAG 2.5.8's 24px minimum; both are now 24×24, which fixes every
dialog and sheet in the app.

---

## Sprint 11 — Community ✅

_Somewhere for the work to be seen._

- **Nothing is public unless somebody published it** (§ 33). A `Post` is a
  decision, not a flag on an asset. Sharing a project does not publish what is
  inside it — the shared view intersects with what was published, as a join
  condition rather than a filter anyone has to remember
- **Public profiles at `/u/{handle}`**, opt-in. Signing up creates no handle;
  deriving one from an email would publish a page about somebody who never
  asked. Handles are ASCII, lower-cased and reserved-checked (§ 35)
- **Gallery** with recent, trending, featured and following, cursor-paginated
- **Trending is computed and may be empty** (§ 34). Likes then comments then
  recency, within seven days. It does not fall back to "recent" wearing a flame
  icon
- **Featured is editorial** — a timestamp we set, on posts and creators, never
  derived from popularity. Empty until somebody has been featured, and the panel
  says why
- **Likes, comments and follows**, with counts denormalised and written in the
  same transaction as the rows they count (§ 36)
- **Deleted comments leave a tombstone**; the body is stripped on the way out
- **Reporting says a person will look**, because there is no automated
  moderation and implying otherwise would be worse than no button
- **Publishing from the studio**, with the caption, the image and the prompt as
  three separate decisions
- `/api/community/*` — reads public, every write authenticated

**Exit criteria:** typecheck, lint and production build clean; the populated,
empty and signed-out states all exercised in a browser at 375px and 1280px.

> **Verified against fixtures.** Community is the only surface whose content
> comes from other people, and there are none — no database, no users, nothing
> published. `/community-preview` runs the real components against an in-memory
> backend with three scenarios. Publish itself refuses there rather than
> pretending, since there are no assets to publish.
>
> The public API routes return **500 in this environment**, and the cause is
> `ECONNREFUSED` — there is no Postgres. The response body is a generic
> sentence with no Prisma internals, which is the part that was actually
> checked. Writes correctly return 401.

**Fixed while verifying:** the profile's website link was an 18px tap target,
below WCAG 2.5.8's 24px — the fourth time this codebase has made that exact
miss, after the marketing footer, the tag chips and the dialog close buttons.

---

## Sprint 12 — Admin dashboard ✅

_The tooling for running it, and the discipline that has to come with it._

- **Two independent grants** (§ 37). `ADMIN_USER_IDS` is the root of trust and
  is checked without touching the database; `User.role` lets a bootstrap admin
  grant access without a deploy. Nobody can change their own role
- **Absence is 404** (§ 38), for the API and — after a correction found by
  probing — for the page. `/admin` is now indistinguishable from a typo
- **Three gates**: the layout, the page, and `requireAdmin()` inside every
  service function. Protection lives with the resource
- **Everything is audited** (§ 39), append-only, in the same transaction as the
  change — **including reads**, because opening a support view is a disclosure
  and a write-only log cannot say who looked
- **Credit adjustments go through the ledger** (§ 40) with a caller-supplied
  idempotency key, a required written reason, a hard floor at zero and a preview
  of the resulting balance
- **Analytics** counted, never estimated. "Credits outstanding" is labelled a
  liability; "recorded revenue" is labelled approximate, because it is
  reconstructed from our ledger rather than reconciled with Stripe
- **Moderation** — the queue Sprint 11 promised a human for. Oldest first, and
  dismissing is recorded too
- **System status** distinguishes _verified_ from _configuration only_, because
  "we just queried it" and "the variable is set" are different guarantees

**Exit criteria:** the gate holds for anonymous callers on every route;
typecheck, lint and production build clean; the dashboard exercised at 375px and
1280px.

> **The gate was verified for real, not against fixtures.** Every
> `/api/admin/*` route returns 404 signed out, and `/admin` returns 404 while
> `/studio` returns 307 — so the route's existence no longer leaks. What could
> **not** be tested here is a signed-in non-admin, which needs a Clerk session;
> that path is `isAdmin()` returning false and is shared with the anonymous one.
>
> The dashboard itself is fixture-backed. `/admin-preview` renders the real
> components and says plainly that it bypasses the gate.

**Fixed while verifying:** the `/admin` page returned 307 rather than 404,
contradicting the rule its own API followed. And Sonner's toast close button was
a 16px target — the last place in the app that WCAG 2.5.8 miss survived, after
the footer, the tag chips, the dialog and sheet buttons and the profile link.

---

## Sprint 13 — Launch preparation ✅ — **Project Alpha complete**

_Nothing new. Everything already there, made ready — and an honest account of
what "ready" does and does not mean._

- **Refactor** (§ 41). Six copies of the same `request<T>()` collapsed into
  `lib/http.ts`; three error responders into `lib/api-response.ts`, keyed on a
  **structural** `DomainError` rather than a base class retrofitted across five
  sprints of independent services
- **Error boundaries** (§ 42) — there were none. `error.tsx` calls `reset()`,
  not a reload, so an unsaved prompt and a polling generation survive; it shows
  the `digest` because that string is the only link between what the user saw
  and what the server logged. `global-error.tsx` imports **nothing** from the
  design system, because it only renders when the root layout is what broke
- **`not-found.tsx` says nothing about why**, keeping § 38's 404-not-403 rule
  intact at the last place it could have leaked
- **Loading states** for every route that waits on a database, each skeleton
  shaped like its destination rather than a generic spinner
- **CSP, at last** (§ 43) — deferred since Sprint 0. Report-Only by default with
  `CSP_ENFORCE=1` as the deliberate flip, because a first-deploy enforced policy
  that blocks the Stripe iframe is discovered by a customer who cannot pay
- **Caching by route class**: `/api/*` never cached, static assets immutable for
  a year, preview routes a day and `noindex`
- **SEO**: a sitemap that queries real posts and profiles and degrades to static
  on failure (§ 44); OpenGraph and Twitter cards on every public page, with the
  post image emitted only when there genuinely is one
- **Accessibility sweep** across every reachable page — one `h1` each, no
  skipped levels, no overflow at 375px
- **Launch checklist** (§ 45) — `docs/LAUNCH.md`, sorted into verified /
  written-never-run / not-built, opening with what has never executed

**Exit criteria:** typecheck, lint, format and production build clean; headers
and cache policy observed on a real `next start`; heading structure and overflow
checked at 375px and 1280px on every reachable page.

**Fixed while verifying:** `/design-system` had **two** `h1`s — in the very
section arguing against choosing a heading level for its size. Its typography
specimens now use `as="p"`, which meant extending `Heading`'s `as` union to
allow it, because without an escape hatch the only way to get the size was to
misuse the tag. `/studio` and `/p/[slug]` had **no** `h1` at all — the product's
core page and a public, indexable one. Four card titles were `h3` under an `h1`,
and two rail labels were `h2`s preceding the page heading in DOM order.

> **Read `docs/LAUNCH.md` before deploying anything.** The build is clean and
> the interface has been exercised at two breakpoints against fixtures. Nothing
> here has ever touched a real database, Clerk instance, Stripe account,
> provider key or bucket; there are no tests; and no migration has ever been
> generated. A clean build is not readiness, and the checklist exists so nobody
> mistakes the one for the other.

---

## Sprint 14 — Production readiness: infrastructure ✅

_No features. The audit's two largest gaps were "no migration" and "nothing has
ever run"; one of them is now closed._

- **The first migration exists** (§ 47) — `prisma/migrations/0_init/`, 476 lines
  of SQL, generated offline with `migrate diff` because waiting for a database
  to exist is exactly how a schema reaches thirteen sprints without one
- **It was applied to a real Postgres engine and introspected**: 16 tables, 11
  enums, 22 foreign keys, 59 indexes, 16 primary keys — reconciling exactly
  against 16 models, 11 enums and 30 + 3 + 10 index declarations
- **15 behavioural assertions pass** against that database — replayed webhook id
  rejected, reused credit `idempotencyKey` rejected, null one allowed, ledger
  rows survive their generation as `SET NULL`, user deletion cascades, composite
  PK makes a double like impossible
- **Two webhook bugs fixed** (§ 48). Both receivers treated _any_ database error
  as "already processed" and returned 200, which stops the provider retrying and
  loses the grant silently. And Clerk's claimed `event.data.id` — the **user**
  id — so a profile synced once and never again, and `user.deleted` was dropped
  as a duplicate, leaving personal data undeleted after account closure
- **Six unused dependencies removed** (§ 46): `uploadthing`,
  `@uploadthing/react`, `@supabase/ssr`, `@supabase/supabase-js`,
  `@stripe/stripe-js`, `cmdk` — zero import sites between them
- **Five dead environment variables removed**, including
  `SUPABASE_SERVICE_ROLE_KEY`: a credential that bypasses row-level security
  entirely, sitting in every deployment's configuration, used by nothing
- **Ten dead files and four empty directories deleted**; UploadThing's CDN hosts
  dropped from the CSP `img-src`

**Exit criteria:** typecheck, lint, format and production build clean; server
boots in 658ms with no warnings; security headers, admin 404s and route
responses verified against `next start`.

> **The landing page rendered for the first time since Sprint 2.** It had been
> unverifiable because Clerk's dev handshake intercepts `/` — on the production
> server it returns 162KB of real HTML, correct title, exactly one `h1`, no
> interstitial.

**Still true after this sprint:** there are no tests, nothing has touched a real
database, Clerk instance, Stripe account or bucket, and the migration has never
been applied by Prisma's own migration machinery.

---

## Sprint 15 — Security hardening ✅

_No features. The audit's most severe finding was "no rate limiting anywhere";
it is closed, and four other Critical/High findings with it._

- **Rate limiting, everywhere** (§ 49). Eight named policies from `generate`
  (12/min — the only endpoint that spends credits and provider quota) up to
  `read` (300/min). **52 of 52 route handlers gated; no unlimited path remains**
- **One gate** — CSRF → session → rate limit → user row → admin → input. The
  order is the design: the limit is enforced on a _local_ session read, before
  anything touches Postgres
- **The six `requireApiUser()` copies became one** (§ 49) and **stayed in the
  service layer**. A guard protects one route; a service function is reachable
  from routes, Server Actions and the caller nobody has written yet
- **CSRF** (§ 51) via `Sec-Fetch-Site` then `Origin`. A request with neither
  header is **refused** — a same-origin `fetch` always sends one, so something
  with neither is not our UI and has no business holding a session cookie
- **The CSP now enforces.** Sprint 13 shipped it Report-Only pending evidence
  that could never arrive — nothing has been deployed, so it was measuring an
  empty room. `base-uri` tightened `'self'` → `'none'`
- **Response allowlists** (`lib/api-output.ts`) — Zod object schemas strip
  unknown keys, so a route cannot emit a field it did not declare

**Fixed while verifying:** uploads called `arrayBuffer()` **before** any size
check — the 10MB limit was real and enforced after the whole file was in memory,
so a 2GB upload was memory exhaustion that our own check politely rejected too
late. The declared MIME type was also the only type check, on files served from
a public bucket; magic bytes must now agree.

**Found and fixed in this sprint's own work** (§ 50): admin routes parsed input
_before_ the 404 check, so a malformed body returned 400 and a well-formed one
404 — two answers is the disclosure the 404 rule exists to prevent. My first
guard made it worse (401 before the service could 404). Caught by requesting
every admin route four ways and confirming the answers were byte-identical.

**Exit criteria:** typecheck, lint, format and build clean; rate limiter, CSRF,
admin-404 discipline and input bounds all verified against `next start`.

> **The limiter is in-memory and per-process.** Correct on one server; behind N
> instances the effective limit is N times the configured one. There is no Redis
> here. `RateLimitStore` exists so swapping one in changes no call site — that
> is the production fix and it is the first item in `SECURITY_REPORT.md`.

**Still true:** there are no tests. Every claim in `SECURITY_REPORT.md` rests on
manual checks run once. The guards are now what stands between a signed-in user
and our provider bill, and nothing prevents the next change from removing one.

---

## Still ahead, in no fixed order

Sprint content is set at the start of each sprint, not here — this list twice
predicted the wrong one. What is left, as of Sprint 13:

- **A first migration, and then tests.** In that order, and before anything
  else on this list. Sixteen models exist only in `schema.prisma`, and the
  credit ledger, the refund path and the webhook idempotency that the whole
  billing design rests on have never been executed even once

- **Audio and voice**, behind the same adapter interface the other two use.
  Two voice packs are already catalogued and marked unusable until it exists
- **Asset library** — browse, search, filter and delete across every project,
  rather than only from inside one
- **Third-party publishing** — the marketplace catalogue is code and
  first-party by design (§§ 30–31); opening it needs an items table, a
  submission flow, moderation and a revenue split
- **Bulk actions and export**
- **Thumbnailing and range-request delivery**, so a grid of clips does not pull
  full files

The two sections below were planned in Sprint 0 and have not been built.
They are deliberately unnumbered: sprint order is set when a sprint is
sent, and numbering them here has already produced two Sprint 10s.

---

## Polish and performance — not built

- Onboarding and first-run experience
- Motion pass: page transitions, generation choreography
- Landing-page revision against real usage data
- Core Web Vitals and a performance budget enforced in CI
- Accessibility audit with a screen reader. Sprint 13 checked structure —
  headings, labels, tap targets, overflow — which is what can be checked without
  one. Nobody has listened to this product

**Exit criteria:** the product looks like what it charges for.

---

## Scale and operations — not built

- Rate limiting and abuse prevention
- Provider failover and circuit breaking
- Observability: structured logs, traces, error tracking, cost-per-generation
- Caching and CDN policy
- Backups, migrations runbook, incident playbook
- Load testing against real provider latency

**Exit criteria:** a provider outage degrades the product instead of breaking it.

---

## Deliberately deferred

Named so they are decisions rather than oversights:

| Deferred                     | Until                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| Teams and shared workspaces  | there is demand from paying single users                    |
| Public gallery and sharing   | moderation is budgeted for — it is a content-safety surface |
| Mobile apps                  | the web product retains                                     |
| Self-serve API for customers | our own provider abstraction has stopped changing           |
| Fine-tuning / custom models  | unit economics of inference are understood                  |
| i18n                         | a second market is chosen deliberately                      |

---

## Standing constraints

- **Providers are replaceable.** Nothing outside `services/ai` may import a
  vendor SDK. If a feature knows which provider it is talking to, the
  abstraction has failed.
- **Money and identity have single sources of truth.** Stripe owns billing
  state, Clerk owns identity; our database mirrors both and never contradicts
  them.
- **No user-facing surface without an empty state, a loading state, and an
  error state.** AI generation fails often enough that this is not optional.
