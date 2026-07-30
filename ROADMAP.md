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
> came first so that Sprint 2's auth screens are assembled from finished
> components rather than inventing styling as they go — and so the visual
> language is decided once, not per-feature.

---

## Sprint 2 — Identity and account

_The first real user record._

- Clerk sign-in / sign-up flows and the `middleware` route matcher
- `ClerkProvider` wired into the provider composition root
- Clerk → database user sync via webhook, keyed on `clerkId`
- Session-aware server helpers (`requireUser`, `getCurrentUser`)
- Account settings shell: profile, appearance, danger zone
- Seeded free-tier credit grant on user creation

**Exit criteria:** a real person can sign up, and a row exists in our database
with their credit balance.

---

## Sprint 2 — The generation core

_The reason the product exists._

- Provider adapter interface — one contract, many vendors
- First two image providers behind it, selectable at request time
- Async job pipeline: queued → running → succeeded/failed, with progress
- Generated output written to R2, metadata to Postgres
- Credit debit on success, refund on provider failure
- Generation UI: prompt, parameters, live job state, result

**Exit criteria:** a signed-in user spends credits and gets an image they can
download.

---

## Sprint 3 — The creative workspace

- Asset library: browse, search, filter, tag, delete
- Collections and simple project grouping
- UploadThing intake for user-supplied source material
- Image-to-image and reference-driven generation
- Bulk actions and export

**Exit criteria:** a user's work persists and is findable a week later.

---

## Sprint 4 — Video and audio

- Video providers behind the same adapter interface
- Audio and voice providers behind the same adapter interface
- Long-running job handling: polling, resumability, timeouts
- Media playback, thumbnailing, and R2 range-request delivery
- Per-modality credit pricing

**Exit criteria:** the three modalities share one pipeline, one library, one
credit ledger.

---

## Sprint 5 — Billing

- Stripe products, prices, and the credit-pack catalogue
- Checkout and customer portal
- Subscription lifecycle via webhooks — Stripe is the source of truth
- Usage metering, quota enforcement, overage handling
- Invoices and billing history

**Exit criteria:** money moves, and a failed payment correctly downgrades access.

---

## Sprint 6 — The premium surface

- Marketing landing page and pricing page
- Onboarding and empty states
- Motion pass: page transitions, generation choreography
- SEO, Open Graph, sitemap, structured data
- Performance budget enforced in CI

**Exit criteria:** the product looks like what it charges for.

---

## Sprint 7 — Scale and operations

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
