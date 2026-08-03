# Landing Page 2.0 — Sprint 23

**Goal:** one of the best AI startup landing pages on the web.

**Status:** two substantial new sections built and verified, one section
deliberately built to render **nothing**, and the page still statically
prerendered with one `h1` and no skipped heading levels.

**One requirement could not be met honestly, and I did not fake it.** Details
first, because it shapes everything else.

---

## Testimonials: there are none, because there are no customers

Atheos has never launched. Zero users, therefore zero people who could have said
anything about it.

`ROADMAP.md` recorded the constraint in Sprint 2 and it has held for
twenty-one sprints: **no invented customer logos, no fabricated metrics, no
`aggregateRating` without real reviews.** A testimonials section is the single
most tempting place to break that, and the place where breaking it does the most
damage. A fake quote with a fake name and a fake job title is fraud, it is the
first thing a sceptical reader checks, and one discovered fake makes every true
claim on the page suspect.

**What I built instead:** `Testimonials` is a real component with a real data
shape, `TESTIMONIALS` is an empty array, and the component returns `null`. The
section is mounted in the page so it appears the moment a real, consented quote
exists — rather than needing this file edited under launch pressure.

It is deliberately **not** a placeholder. Not "coming soon", not three
lorem-ipsum cards with stock avatars waiting to be filled in — those get shipped
by accident. A surface with nothing real to show shows nothing.

This is the same pattern the product already uses twice: trending returns empty
rather than falling back to recent (§ 34), and featured creators stays blank
until somebody is featured.

The `Testimonial` type carries a `consented` flag, and only consented entries
render. Adding one is a statement that a named person said this and agreed to be
quoted. There is no "representative" or "composite" testimonial, because a
composite is a fabrication with extra steps.

---

## Built

### AI Models — reads the real engine catalogue

`features/marketing/components/ai-models.tsx`

**This is the most original thing on the page**, and it is original because it
is honest.

Every other AI landing page has a wall of vendor logos. That is a claim nobody
can check, and one this product cannot make: nine of eleven providers have no
adapter. So instead of a logo grid, this section imports `PROVIDER_CATALOGUE` —
**the same file the Provider Manager routes on** — and prints two groups:

- **Available now (2)** — Replicate, OpenAI
- **On the roadmap (9)** — Fal, Gemini, Anthropic, Runway, Luma, Kling, Minimax,
  Hailuo, Pika

With the line most landing pages will not print:

> Providers marked on the roadmap are not connected yet — the engine knows their
> shape and refuses to route to them until an adapter exists, so nothing here
> can be selected and silently fail.

Three things follow from generating it rather than writing it:

1. **It cannot go stale.** Flipping a provider to `implemented` updates this
   section with no edit here.
2. **It answers the real question.** A buyer is asking "which of these can I use
   today", and a logo grid never answers that.
3. **It ships zero JavaScript.** `catalogue.ts` is `server-only`, so it is read
   during the static render and never reaches the client bundle.

The roadmap grid is deliberately quieter — five columns, dashed borders, no
descriptions. A roadmap presented as loudly as shipped work is a roadmap being
used as a claim.

### Animated demo — the flow, not fabricated output

`features/marketing/components/animated-demo.tsx`

Five frames replaying the real `GenerationStatus` sequence: prompt → model →
queued → running → complete. The labels and the order are the actual state
machine.

**It shows no generated images.** Every image this product could put here would
either be a stock photo pretending to be model output, or mock-provider output
pretending to be a real model. Both are what the honesty constraint exists to
prevent and both are trivially caught. The final frame shows result _tiles_ with
a visible `Illustration` badge and a caption saying so.

A demo honest about being a diagram is more persuasive than one a viewer
suspects is a mockup.

Three performance decisions:

- **`useInView` gates the loop.** A page running a timer for a section three
  screens below the fold burns battery animating something nobody is looking at.
  On a phone that is a difference visitors feel.
- **Fixed aspect ratio container.** The whole sequence happens inside a box whose
  size never changes, so nothing below it can shift — this section contributes
  zero CLS by construction.
- **`opacity` and `transform` only.** The progress bar uses `scaleX`, not
  `width`. Composited, GPU, no layout.

The sequence is also written out in an `sr-only` paragraph. The loop is
decorative; the information is not.

---

## Sections that already existed

Nine of the eleven requested sections were already built and good: Hero,
Interactive Background, Feature Showcase, Templates, Gallery, Pricing, FAQ,
Footer, and the infrastructure marquee.

I did not rewrite them. **Rebuilding working sections to satisfy a checklist is
churn with a regression attached** — the same judgement as Sprint 22.

Worth noting what `TrustedBy` already does, because it is the pattern this
sprint extended: it names the **actual infrastructure stack** rather than
customer logos. Verifiable, and it answers what a technical buyer is really
asking — is this a real system or a weekend project?

---

## SEO and Core Web Vitals

### What is genuinely true

- **`/` is still statically prerendered.** Confirmed in the build output as
  `○ (Static)`. Adding two sections did not push it to dynamic — the models
  section reads server-only config at build time, and the demo is a client
  island inside a static page.
- **190 KB of HTML**, one `h1`, **no skipped heading levels** across 44 headings
  — verified from the rendered markup.
- Metadata, canonical, OG image generation, sitemap, robots and JSON-LD were all
  in place from Sprint 2 and are unchanged.
- The demo cannot contribute to CLS: fixed ratio container, transform-only
  animation.

### What I am not claiming

**Core Web Vitals are still not measured.** Sprint 16's report said LCP and FCP
could not be obtained from this harness and CLS reported zero untrustworthily;
that is unchanged. I have made choices that _should_ protect CWV — static
render, gated animation, no layout-triggering properties, fixed containers — and
I have not measured their effect.

Getting real numbers needs Lighthouse or field data against a deployed page.
That remains gated behind infrastructure that does not exist.

---

## Verification

```
tsc --noEmit                 CLEAN
eslint . --max-warnings 0    CLEAN
prettier --check             CLEAN
next build                   SUCCESS — / remains ○ (Static)
```

Against `next start`:

| Check                              | Result                                                     |
| ---------------------------------- | ---------------------------------------------------------- |
| Page renders                       | 190,407 bytes                                              |
| Heading structure                  | one `h1`, 44 headings, **no skipped levels**               |
| `#demo` section                    | present                                                    |
| `#models` section                  | present                                                    |
| `#testimonials`                    | **absent** — correct, renders `null`                       |
| Provider names from real catalogue | Replicate, OpenAI, Runway, Kling, Hailuo, Pika all present |
| "Available now" / "On the roadmap" | both present                                               |

The last row is the one worth noticing: those names are in the HTML because the
component read the engine's configuration, not because I typed them into a
marketing file.

---

## Remaining gaps

| #   | Gap                                                                                                                                                                                           | Severity |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **Core Web Vitals unmeasured.** Choices are sound; effects unverified.                                                                                                                        | High     |
| 2   | **No testimonials, and no path to getting any** until the product launches.                                                                                                                   | Medium   |
| 3   | **No component tests** for either new section. Same gap as Sprint 22's four components.                                                                                                       | Medium   |
| 4   | **The gallery is still procedural artwork**, labelled as such — it cannot show real output until a provider works.                                                                            | Medium   |
| 5   | **Typography unchanged.** Geist + Geist Mono, already optimally loaded. "Premium typography" would mean a licensed display face, which is a brand decision and a purchase, not a code change. | Low      |
| 6   | **The page has never been seen by a person.** Verified through rendered markup, not eyes — and a landing page is judged by eye.                                                               | High     |

Item 6 deserves emphasis. Everything here is verified structurally: the markup is
correct, the headings are correct, the build is correct. **Whether it is
beautiful is not something I have been able to check.**

---

## Honest summary

The two new sections are the ones this product could uniquely make: a provider
list generated from the engine's own routing configuration, and a demo that
shows the real state machine without pretending to show output it cannot
produce.

The testimonials section renders nothing, and that is the sprint's most
defensible decision rather than its biggest miss. A landing page for a product
with no users can be excellent — it just has to make claims it can support.
`TrustedBy` names the real stack. `AIModels` prints "2 available, 9 on the
roadmap" on the marketing page. Neither is a testimonial; both are evidence,
which is what a testimonial is a proxy for.

What I cannot tell you is whether it looks as good as it reads.
