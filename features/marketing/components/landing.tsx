import { AIShowcase } from "@/features/marketing/components/ai-showcase";
import { Faq } from "@/features/marketing/components/faq";
import { Features } from "@/features/marketing/components/features";
import { MadeWithAtheos } from "@/features/marketing/components/made-with-atheos";
import { Hero } from "@/features/marketing/components/hero";
import { HomeComposer } from "@/features/marketing/components/home-composer";
import { HowItWorks } from "@/features/marketing/components/how-it-works";
import { Pricing } from "@/features/marketing/components/pricing";
import { Templates } from "@/features/marketing/components/templates";
import type { Locale } from "@/features/marketing/i18n/locales";

/**
 * The landing page, in one language.
 *
 * Composes sections and nothing else — no state, no data fetching, no logic.
 * Only the sections that genuinely need interactivity (`Hero`, `AIShowcase`,
 * `Pricing`, `Faq`) are client components; the rest render to static HTML,
 * which is both faster and the version a search crawler sees without executing
 * anything.
 *
 * ## Section order
 *
 * Not arbitrary. It follows the questions a visitor asks, in the order they ask
 * them:
 *
 *   Hero        what is this?
 *   TrustedBy   is it real?
 *   Showcase    what does it actually do?
 *   Features    why is it better than what I do now?
 *   HowItWorks  what would using it be like?
 *   Templates   can I start quickly?
 *   Gallery     is it any good?
 *   Pricing     what does it cost?
 *   FAQ         what is the catch?
 *
 * Pricing sits late deliberately. A price shown before the value is established
 * is just a number to flinch at.
 *
 * ## Why this is a component and not the route
 *
 * There are two routes — `/` and `/es` — and they must not drift. Extracting
 * the composition means a section added here appears in both languages by
 * construction, rather than by somebody remembering to edit a second file.
 * Server sections take `locale`; client ones read it from the provider the
 * route wraps around this.
 */
export function Landing({ locale }: { locale: Locale }) {
  return (
    <>
      {/**
       * The one preload on the page.
       *
       * Lighthouse identifies the LCP element as the hero's poster — the
       * `bg-cover` div in `hero-video.tsx`, 1340×622 at desktop — and fails
       * `lcp-discovery-insight` because nothing announces it. A CSS
       * `background-image` is invisible to the preload scanner: the browser
       * cannot know the URL until it has downloaded the stylesheet, matched
       * the rule and built the layout box, which is why the measured LCP
       * carried 456 ms of pure *resource load delay*.
       *
       * `fetchpriority` cannot help here — that attribute belongs on an
       * `<img>`, and this is not one. A preload link is the only way to hand
       * the URL to the scanner while the HTML is still streaming.
       *
       * React 19 hoists this into `<head>`. It lives in `Landing` rather than
       * the marketing layout on purpose: the layout also wraps `/pricing`,
       * `/privacy` and the legal pages, none of which render a hero, and
       * preloading a 13 KB image those pages never paint is a straight waste.
       * Here it is scoped to exactly the two routes with a hero, `/` and `/es`.
       */}
      <link
        rel="preload"
        as="image"
        // Density descriptors matching the `image-set()` in `.hero-poster`, so
        // the preload fetches the file the CSS will actually use. A plain
        // `href` here would preload one density and the stylesheet would then
        // request the other — two downloads for one painted image.
        imageSrcSet="/marketing/hero-poster-mobile.webp 640w, /marketing/hero-poster.webp 1920w"
        imageSizes="100vw"
        type="image/webp"
        fetchPriority="high"
      />

      <Hero />

      {/* One field, directly under the fold. It generates nothing — it carries
          the prompt into sign-up and on to the studio. See home-composer.tsx
          for why it is worded to avoid looking like it will generate. */}
      <HomeComposer />

      <AIShowcase />

      {/* The only media gallery on the page.
      
          "A look at the surface" used to sit further down showing the same
          eight generations in a masonry grid, so the homepage proved the same
          point twice, four sections apart. This one carries the prompt and the
          modality into the studio; that one linked nowhere. */}
      <MadeWithAtheos />

      <Templates locale={locale} />
      <HowItWorks locale={locale} />
      <Features locale={locale} />
      <Pricing />
      <Faq />
    </>
  );
}
