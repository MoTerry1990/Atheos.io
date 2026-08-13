import { AIModels } from "@/features/marketing/components/ai-models";
import { AIShowcase } from "@/features/marketing/components/ai-showcase";
import { AnimatedDemo } from "@/features/marketing/components/animated-demo";
import { Faq } from "@/features/marketing/components/faq";
import { Features } from "@/features/marketing/components/features";
import { Gallery } from "@/features/marketing/components/gallery";
import { Hero } from "@/features/marketing/components/hero";
import { HowItWorks } from "@/features/marketing/components/how-it-works";
import { Pricing } from "@/features/marketing/components/pricing";
import { Templates } from "@/features/marketing/components/templates";
import { Testimonials } from "@/features/marketing/components/testimonials";
import { TrustedBy } from "@/features/marketing/components/trusted-by";
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
      <Hero />
      <TrustedBy locale={locale} />

      {/* The demo sits directly after the fold. A visitor who has read the hero
          is asking "what is it actually like", and answering that before the
          feature list is what stops the page reading as a brochure. */}
      <AnimatedDemo />

      <AIShowcase />
      <Features locale={locale} />
      <HowItWorks locale={locale} />

      {/* Providers before templates: which models are connected is a
          qualifying question, and a buyer who needs a vendor we do not have
          should find that out before scrolling a gallery. */}
      <AIModels />

      <Templates locale={locale} />
      <Gallery locale={locale} />
      <Pricing />

      {/* Renders nothing — `TESTIMONIALS` is empty because there are no
          customers yet. Mounted anyway so the section appears the moment a
          real, consented quote exists, rather than needing this file edited
          under launch pressure. */}
      <Testimonials />

      <Faq />
    </>
  );
}
