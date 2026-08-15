# Frontend Audit — Atheos.io

**Date:** 2026-08-14
**Scope:** public marketing surface only. The authenticated Studio, provider
adapters, workers, billing, migrations and auth configuration were read but not
touched.
**Reference build:** `https://atheos-io.vercel.app/`, commit `64a1b0a`.

Every bug below was **reproduced against production**, not inferred from
reading. Where a claim could not be verified it is marked as unverified.

---

# Executive Summary

| Measure             | Score      | Basis                                                                                                                                                                        |
| ------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend completion | **~70%**   | Every section exists and renders; three of them are wired to the wrong destination and one is functionally dead.                                                             |
| Homepage quality    | **6 / 10** | Strong visual identity and honest copy. Wrong ordering — infrastructure and roadmap outrank product demonstration.                                                           |
| Navigation quality  | **3 / 10** | Both auth entry points and the primary hero CTA go to `#pricing`. A visitor who wants to sign up cannot, from the homepage.                                                  |
| Mobile readiness    | **7 / 10** | Layouts are responsive throughout and the auth video is correctly gated to desktop. Untested at real viewport sizes this sprint.                                             |
| Performance risk    | **6 / 10** | `hero.mp4` is 1.28 MB and autoplays. `auth.mp4` is 3.34 MB (desktop-gated). No LCP measurement has ever been taken.                                                          |
| Accessibility       | **7 / 10** | Roles, `aria-selected`, `aria-controls` and live regions are used correctly. Undermined by the tab panel not actually changing, which makes `aria-controls` a false promise. |

**The single most damaging finding:** the homepage has no working path to
sign-up. Header "Sign in", header "Get started" and the hero's primary CTA all
resolve to `#pricing`, an anchor on the same page.

---

# Current Architecture

**Framework and routing.** Next.js 15.5.22, App Router, React 19.2.4,
TypeScript strict, Turbopack. Route groups: `app/(marketing)`, `app/(app)`,
`app/(auth)`, `app/(admin)`, `app/(community)`, `app/(dev)`.

**Homepage file structure.**

```
app/(marketing)/page.tsx          → <MarketingShell locale="en"><Landing locale="en" />
app/(marketing)/es/page.tsx       → <MarketingShell locale="es"><Landing locale="es" />
features/marketing/components/landing.tsx   ← section composition lives here
```

**Localisation is shared, not duplicated.** Both locales render the same
`Landing`; only the `locale` prop differs. Copy lives in
`features/marketing/i18n/{en,es}.ts` and is joined to language-independent data
in `features/marketing/content.ts` **by array index**, with
`tests/unit/marketing-i18n.test.ts` asserting the arrays stay aligned. This is
good and should not be disturbed — a section added to `Landing` appears in both
languages automatically.

**Styling.** Tailwind CSS v4, CSS-first (`@theme`, `@utility` in
`styles/globals.css`). No `tailwind.config.js`. Brand identity is an
OKLCH-based purple/blue/cyan on near-black; tokens include `--gradient-aurora`,
`--gradient-brand-subtle`, `.orb`, `.bg-grid`, `.grain`.

**Component conventions.** Server Components by default. `"use client"` only
where interaction demands it (`Hero`, `AIShowcase`, `Pricing`, `HeroVideo`).
`Reveal`, `Section` and `SectionHeading` in `section.tsx` are the shared
layout primitives.

**Media handling.** `next/image` via a `GeneratedImage` wrapper. Video is a
raw `<video>` behind a `prefers-reduced-motion` gate with a poster of the same
seed. All marketing media is real model output committed to `public/marketing/`.

---

# Verified Bugs

## BUG-1 — Modality tabs never change the panel

- **Severity:** Critical
- **User impact:** The Video and Audio tabs are decorative. Clicking either
  sets `aria-selected="true"` and leaves the Image panel on screen — headline,
  body, bullets and image all unchanged. Two of the three things Atheos sells
  cannot be seen on the homepage.
- **Location:** `features/marketing/components/ai-showcase.tsx`, lines ~104-118
- **Root cause:** **Not the state logic.** `setActive`, the index lookup and the
  `key={panel.id}` on the panel are all correct. The failure is
  `<AnimatePresence mode="wait">`: the outgoing panel's exit animation never
  reports completion, so the incoming panel is never mounted. Reproduced live —
  five seconds after clicking Video the DOM still holds exactly one
  `[role="tabpanel"]`, with `id="panel-image"`.
- **Recommended fix:** Remove `mode="wait"`, or drop `AnimatePresence` here
  entirely and cross-fade with CSS. A tab panel does not need an exit
  animation, and the one it has is what breaks it. Add a test that clicks each
  tab and asserts the rendered headline changes.

## BUG-2 — No route to sign-up from the homepage

- **Severity:** Critical
- **User impact:** A visitor who decides to sign up cannot. Both header buttons
  and the hero's primary call to action scroll to the pricing section instead.
- **Location:**
  - `features/marketing/components/site-header.tsx:102` — Sign in → `#pricing`
  - `features/marketing/components/site-header.tsx:105` — Get started → `#pricing`
  - `features/marketing/i18n/en.ts:76` — `primaryCta.href: "#pricing"`
- **Root cause:** Written in Sprint 2, when there was no authentication. Clerk
  landed in Sprint 5 and these were never revisited. The routes exist and work:
  `/sign-in` and `/sign-up` are live and return 200.
- **Recommended fix:** Sign in → `/sign-in`. Get started → `/sign-up`. Hero
  primary → `/sign-up`. Add a test asserting no marketing auth CTA resolves to
  an anchor.

## BUG-3 — Template cards route to pricing

- **Severity:** High
- **User impact:** Six template cards look like the fastest way to start
  something, and every one of them scrolls to pricing. It reads as a paywall on
  a product that has a free tier.
- **Location:** `features/marketing/components/templates.tsx:46`
- **Root cause:** Same as BUG-2 — the studio did not exist when this was built.
- **Recommended fix:** `/sign-up?redirect_url=/studio`. Carrying the template's
  prompt through as a query parameter is a further improvement, but out of
  scope for this sprint.

## BUG-4 — Hero primary CTA says "Request early access"

- **Severity:** Medium
- **User impact:** The product is live, sign-up is open, and the free tier
  grants 100 credits a month. "Request early access" describes a waitlist that
  does not exist and suppresses conversions from people who could sign up now.
- **Location:** `features/marketing/i18n/en.ts:76`, and the Spanish twin.
- **Recommended fix:** "Start creating free" / "Empiece gratis", pointing at
  `/sign-up`.

## Not a bug — checked and correct

- **Anchor targets all resolve.** Every `href` in the nav (`#showcase`,
  `#features`, `#how-it-works`, `#pricing`, `#faq`) has a matching section id.
- **Spanish uses shared components.** No duplication to reconcile.
- **Testimonials render nothing.** `TESTIMONIALS` is deliberately empty and the
  component returns `null` rather than showing invented quotes. Leave as is.
- **Footer legal links** were fixed earlier today and point at real pages.

---

# Broken or Misleading Navigation

| Visible label                             | Current destination                   | Intended destination            | Status     | Recommended change                                              |
| ----------------------------------------- | ------------------------------------- | ------------------------------- | ---------- | --------------------------------------------------------------- |
| Product                                   | `#showcase`                           | `#showcase`                     | OK         | —                                                               |
| Features                                  | `#features`                           | `#features`                     | OK         | —                                                               |
| How it works                              | `#how-it-works`                       | `#how-it-works`                 | OK         | —                                                               |
| Pricing                                   | `#pricing`                            | `/pricing`                      | Weak       | Full page has the comparison table; the anchor shows only cards |
| FAQ                                       | `#faq`                                | `#faq`                          | OK         | —                                                               |
| **Sign in**                               | `#pricing`                            | `/sign-in`                      | **Broken** | Fix                                                             |
| **Get started** (header)                  | `#pricing`                            | `/sign-up`                      | **Broken** | Fix                                                             |
| **Request early access** (hero)           | `#pricing`                            | `/sign-up`                      | **Broken** | Fix + relabel                                                   |
| See how it works (hero)                   | `#how-it-works`                       | `#how-it-works`                 | OK         | —                                                               |
| Hero eyebrow badge                        | `#showcase`                           | `#showcase`                     | OK         | —                                                               |
| **Template cards ×6**                     | `#pricing`                            | `/sign-up?redirect_url=/studio` | **Broken** | Fix                                                             |
| Pricing card CTAs                         | `/sign-up?redirect_url=…`             | same                            | OK         | Already correct                                                 |
| Footer → Connect your tools               | `/connect`                            | `/connect`                      | OK         | —                                                               |
| Footer → Contact                          | `mailto:hello@atheos.io`              | same                            | OK         | —                                                               |
| Footer → Privacy / Terms / Acceptable use | `/privacy` `/terms` `/acceptable-use` | same                            | OK         | —                                                               |
| Footer → Gallery / FAQ                    | `#gallery` `#faq`                     | same                            | OK         | Anchor-only; breaks from `/pricing`                             |
| Footer → Design system                    | `/design-system`                      | —                               | Review     | Internal tooling on a public footer                             |

---

# Homepage Section Inventory

Current order, top to bottom.

| #   | Component                  | Purpose                        | Verdict           | Reason                                                                                                                     |
| --- | -------------------------- | ------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Hero`                     | Headline, CTAs, stats          | **Redesign**      | CTA is broken and mislabelled; no output visible above the fold                                                            |
| 2   | `TrustedBy`                | Names Next.js, Vercel, Stripe… | **Move lower**    | Infrastructure is reassurance for a technical buyer, not a reason to sign up. Position 2 is the most valuable on the page. |
| 3   | `AnimatedDemo` (`#demo`)   | Prompt → result animation      | **Keep, promote** | Closest thing to a product demonstration. Belongs directly under the hero.                                                 |
| 4   | `AIShowcase` (`#showcase`) | Image / Video / Audio tabs     | **Redesign**      | Functionally broken (BUG-1). The best structure on the page once fixed.                                                    |
| 5   | `Features`                 | Six benefit cards              | **Keep**          | Two carry generated imagery; reads well.                                                                                   |
| 6   | `HowItWorks`               | Four steps                     | **Keep**          | Consolidate to three per the target architecture.                                                                          |
| 7   | `AIModels` (`#models`)     | Provider grid + roadmap        | **Redesign**      | Honest, and gives unshipped integrations equal space to live ones. Show live models; move the roadmap to a single line.    |
| 8   | `Templates`                | Six template cards             | **Redesign**      | Broken links (BUG-3). Should be the "popular tools" entry point.                                                           |
| 9   | `Gallery`                  | Eight real generations         | **Keep, promote** | The strongest proof on the page and it sits ninth. This is the Higgsfield-style discovery block.                           |
| 10  | `Pricing`                  | Five plan cards                | **Keep**          | Correct as a preview; full detail is at `/pricing`.                                                                        |
| 11  | `Testimonials`             | —                              | **Keep**          | Renders `null` by design. No change.                                                                                       |
| 12  | `Faq`                      | Accordion                      | **Keep**          | Also feeds FAQPage JSON-LD.                                                                                                |

**The ordering problem in one sentence:** a visitor sees infrastructure logos
before they see a single generated image, and the gallery — the only
unambiguous proof the product works — is ninth.

---

# Media Inventory

All under `public/marketing/`, all real model output from
`scripts/generate-marketing-assets.ts`.

| Asset                               |     Size | Format | Used by          | Loading                    | Problem                                                                               |
| ----------------------------------- | -------: | ------ | ---------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| `hero.mp4`                          | 1,310 KB | H.264  | `HeroVideo`      | autoplay, `preload="auto"` | Largest homepage payload; competes with LCP                                           |
| `hero-poster.webp`                  |    13 KB | WebP   | `HeroVideo`      | CSS background             | Fine                                                                                  |
| `auth.mp4`                          | 3,415 KB | H.264  | `AuthPanelVideo` | autoplay, desktop-gated    | Not on the homepage. Heavy but correctly gated                                        |
| `auth-poster.webp`                  |     5 KB | WebP   | `AuthPanelVideo` | CSS background             | Fine                                                                                  |
| `gallery-1…8.webp`                  |  9–68 KB | WebP   | `Gallery`        | `next/image`, lazy         | Fine                                                                                  |
| `template-1…6.webp`                 |  8–40 KB | WebP   | `Templates`      | `next/image`, lazy         | Fine                                                                                  |
| `showcase-{image,video,audio}.webp` | 34–72 KB | WebP   | `AIShowcase`     | `next/image`, lazy         | Only `showcase-image` is ever seen (BUG-1)                                            |
| `feature-library.webp`              |   125 KB | WebP   | `Features`       | `next/image`, lazy         | Largest still; candidate for re-encode                                                |
| `feature-craft.webp`                |    11 KB | WebP   | `Features`       | `next/image`, lazy         | Fine                                                                                  |
| `prompts.json`                      |     2 KB | JSON   | none             | —                          | Written by the generator, read by nothing. Provenance record; keep or move to `docs/` |

**Total homepage media ≈ 1.8 MB**, of which `hero.mp4` is 73%.

**No video is served as WebM or AV1.** A VP9/WebM alternate would cut the hero
by roughly 30% for every browser that accepts it, at the cost of a second
encode.

---

# Competitor Comparison

Principles only. No asset, copy, layout or brand element from either product is
to be reproduced.

| Dimension             | Kling                            | Higgsfield         | Atheos today                      | Direction                              |
| --------------------- | -------------------------------- | ------------------ | --------------------------------- | -------------------------------------- |
| Navigation            | Sparse; sign-in prominent        | Dense; content-led | 5 anchors + 2 broken auth buttons | Kling — fix auth, keep it sparse       |
| Hero                  | Full-bleed output, minimal type  | Grid of real work  | Type + abstract video, no output  | Kling 70% — show output above the fold |
| Product demonstration | Prompt box on the landing page   | Live feed          | `AnimatedDemo` buried at 3        | Kling — promote a compact composer     |
| Creation workflow     | Prompt → immediate visual        | Template-first     | Templates route to pricing        | Kling — one obvious path to `/studio`  |
| Content gallery       | Restrained                       | Its whole identity | Real, honest, ninth               | Higgsfield 30% — promote               |
| Templates             | Presets with previews            | Effect-led         | Six cards, broken links           | Fix links; keep restrained             |
| Pricing               | Simple tiers                     | Credit-led         | Five tiers, correct CTAs          | Already good                           |
| Mobile                | Single column, large tap targets | Dense, heavy       | Responsive, untested              | Verify at 375px                        |
| Performance           | Aggressive lazy-loading          | Heavy              | 1.3 MB hero video                 | Add WebM, defer                        |
| Accessibility         | Adequate                         | Weak               | Good roles, broken panel          | Fix BUG-1 to make the roles true       |

**The 70/30 reading:** Kling's discipline for the top half — hero, composer,
one clear action. Higgsfield's generosity for the bottom half — a gallery that
invites browsing. Atheos's own colour identity throughout, unchanged.

---

# Recommended Homepage Architecture

| #   | Section                        | Component              | Status                                                           |
| --- | ------------------------------ | ---------------------- | ---------------------------------------------------------------- |
| 1   | Navigation                     | `SiteHeader`           | Fix auth links                                                   |
| 2   | Cinematic hero                 | `Hero` + `HeroVideo`   | Redesign; real output above the fold                             |
| 3   | Compact generation composer    | **new** `HomeComposer` | Prompt field + modality switch → `/sign-up?redirect_url=/studio` |
| 4   | Image / Video / Audio showcase | `AIShowcase`           | Fix BUG-1                                                        |
| 5   | Made with Atheos gallery       | `Gallery`              | Promote from 9                                                   |
| 6   | Popular tools and templates    | `Templates`            | Fix links                                                        |
| 7   | Three-step explanation         | `HowItWorks`           | Four steps → three                                               |
| 8   | Benefits                       | `Features`             | Keep                                                             |
| 9   | Pricing preview                | `Pricing`              | Keep                                                             |
| 10  | FAQ                            | `Faq`                  | Keep                                                             |
| 11  | Footer                         | `SiteFooter`           | Review `/design-system`                                          |

`TrustedBy` moves into the footer region. `AIModels` is reduced to live models
with the roadmap as one line of text.

---

# Component Plan

| Component        | Responsibility                                                                                                                           | New?                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `HomeComposer`   | Prompt input + modality switch. Does **not** generate — routes to sign-up carrying the prompt. Must not imply a generation is happening. | New                                                           |
| `MediaTile`      | One generated asset with prompt caption, aspect ratio, lazy loading. Shared by Gallery, Templates, Showcase.                             | New — collapses three near-identical implementations          |
| `SectionHeading` | Eyebrow, title, description                                                                                                              | Exists                                                        |
| `Reveal`         | Scroll-reveal wrapper                                                                                                                    | Exists                                                        |
| `GeneratedImage` | `next/image` + prompt-derived alt                                                                                                        | Exists                                                        |
| `HeroVideo`      | Gated autoplay + poster + scrims                                                                                                         | Exists; add WebM source                                       |
| `ModalityTabs`   | Accessible tab list, no exit animation                                                                                                   | New — extracted from `AIShowcase`, which is where BUG-1 lives |
| `CtaButton`      | Enforces that a marketing CTA takes a route, never an anchor                                                                             | New — makes BUG-2 unrepeatable by construction                |

---

# Performance Budget

| Item                    | Budget                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| Hero video              | ≤ 1.5 MB MP4, plus a WebM alternate ≤ 1.0 MB                                    |
| Video formats           | WebM (VP9) first, MP4 (H.264) fallback                                          |
| Poster                  | Always present, WebP, ≤ 20 KB, painted before video attaches                    |
| Hero video preload      | `preload="none"`; attach on idle, not on parse                                  |
| Below-fold video        | Never autoplays; `IntersectionObserver` only                                    |
| Images                  | WebP, `next/image`, explicit `sizes`                                            |
| Responsive widths       | 640 / 828 / 1080 / 1920                                                         |
| Above-fold images       | `priority`; everything else lazy                                                |
| LCP                     | ≤ 2.5 s on 4G                                                                   |
| CLS                     | ≤ 0.1 — every media box needs a reserved aspect ratio                           |
| INP                     | ≤ 200 ms                                                                        |
| Total homepage transfer | ≤ 2.5 MB first visit                                                            |
| Reduced motion          | No video downloaded at all; poster only. Already correct in `HeroVideo` — keep. |

---

# Implementation Plan

## Phase 1 — Navigation and routing (highest value, lowest risk)

- **Objective:** Every CTA reaches a real destination.
- **Files:** `site-header.tsx`, `templates.tsx`, `i18n/en.ts`, `i18n/es.ts`
- **Acceptance:** Sign in → `/sign-in`; Get started and hero primary →
  `/sign-up`; templates → `/sign-up?redirect_url=/studio`; hero CTA relabelled.
- **Tests:** New unit test asserting no marketing auth CTA href starts with `#`.
  Existing i18n parity test must still pass.
- **Risks:** Minimal. Copy changes must land in both languages or the parity
  test fails — which is the test doing its job.
- **Rollback:** Revert the commit; no schema or config touched.

## Phase 2 — Fix the modality tabs

- **Objective:** Video and Audio panels actually render.
- **Files:** `ai-showcase.tsx`, new `modality-tabs.tsx`
- **Acceptance:** Clicking each tab changes headline, bullets and image.
- **Tests:** Component test clicking through all three tabs. Playwright
  assertion on the live panel id.
- **Risks:** Removing `AnimatePresence` changes the transition feel. Acceptable
  — the current transition does not complete.
- **Rollback:** Revert.

## Phase 3 — Reorder the homepage

- **Objective:** Proof before infrastructure.
- **Files:** `landing.tsx` only
- **Acceptance:** Order matches the architecture above. `TrustedBy` demoted,
  `Gallery` promoted.
- **Tests:** Existing suite; visual check at 375 / 768 / 1440.
- **Risks:** Anchor links must keep working — ids travel with components, so
  reordering is safe.
- **Rollback:** Revert.

## Phase 4 — Hero redesign

- **Objective:** Generated output above the fold; correct CTA.
- **Files:** `hero.tsx`, `hero-video.tsx`, `i18n/*`
- **Acceptance:** A real generation is visible without scrolling; LCP ≤ 2.5 s.
- **Tests:** Lighthouse before/after.
- **Risks:** Adding imagery to the hero can worsen LCP — measure, do not assume.
- **Rollback:** Revert.

## Phase 5 — Home composer

- **Objective:** One obvious way to start.
- **Files:** new `home-composer.tsx`, `landing.tsx`, `i18n/*`
- **Acceptance:** Prompt + modality routes to sign-up carrying the prompt. No
  generation occurs and none is implied.
- **Tests:** Unit test on the constructed URL.
- **Risks:** Must not look like it will generate for a signed-out visitor.
- **Rollback:** Remove from `landing.tsx`; component is self-contained.

## Phase 6 — Media and performance

- **Objective:** Meet the budget.
- **Files:** `hero-video.tsx`, `generated-image.tsx`, `scripts/`
- **Acceptance:** WebM alternate present; `preload="none"`; LCP measured.
- **Tests:** Lighthouse; verify reduced-motion still downloads nothing.
- **Risks:** WebM encoding needs ffmpeg locally — available and already used.
- **Rollback:** Remove the `<source>`; MP4 fallback is unchanged.

## Phase 7 — Models and roadmap

- **Objective:** Stop giving unshipped integrations equal weight.
- **Files:** `ai-models.tsx`
- **Acceptance:** Live models shown; roadmap reduced to one line. **No claim
  that an unavailable provider is available** — the honesty constraint holds.
- **Tests:** Existing suite.
- **Rollback:** Revert.

---

# Baseline Test Status

Run immediately before this document was written, on commit `64a1b0a`:

```
npm run lint      → clean, no warnings
npx tsc --noEmit  → clean
npx vitest run    → 23 files, 299 tests, all passing
```

**There are no pre-existing failures.** Any failure appearing during this
sprint was introduced by it.
