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
arrives with the library in Sprint 7, since there is nowhere to manage
collections yet.

---

## Sprint 7 — The creative workspace

- Asset library: browse, search, filter, tag, delete
- Collections and simple project grouping
- UploadThing intake for user-supplied source material
- Bulk actions and export

**Exit criteria:** a user's work persists and is findable a week later.

---

## Sprint 8 — Video and audio

- Video providers behind the same adapter interface
- Audio and voice providers behind the same adapter interface
- Long-running job handling: polling, resumability, timeouts
- Media playback, thumbnailing, and R2 range-request delivery
- Per-modality credit pricing

**Exit criteria:** the three modalities share one pipeline, one library, one
credit ledger.

---

## Sprint 9 — Billing

- Stripe products, prices, and the credit-pack catalogue
- Checkout and customer portal
- Subscription lifecycle via webhooks — Stripe is the source of truth
- Usage metering, quota enforcement, overage handling
- Invoices and billing history

**Exit criteria:** money moves, and a failed payment correctly downgrades access.

---

## Sprint 10 — Polish and performance

- Onboarding and first-run experience
- Motion pass: page transitions, generation choreography
- Landing-page revision against real usage data
- Core Web Vitals and a performance budget enforced in CI
- Accessibility audit with a screen reader, not just a linter

**Exit criteria:** the product looks like what it charges for.

---

## Sprint 11 — Scale and operations

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
