import { AIModels } from "@/features/marketing/components/ai-models";
import { AIShowcase } from "@/features/marketing/components/ai-showcase";
import { AnimatedDemo } from "@/features/marketing/components/animated-demo";
import { Faq } from "@/features/marketing/components/faq";
import { Features } from "@/features/marketing/components/features";
import { Gallery } from "@/features/marketing/components/gallery";
import { MadeWithAtheos } from "@/features/marketing/components/made-with-atheos";
import { Hero } from "@/features/marketing/components/hero";
import { HomeComposer } from "@/features/marketing/components/home-composer";
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

      {/* One field, directly under the fold.
      
          It generates nothing — it carries the prompt into sign-up and on to
          the studio. Placed here because the question a visitor has after the
          hero is "what do I do", and a text field answers that faster than any
          paragraph. See home-composer.tsx for why it is worded to avoid
          looking like it will generate. */}
      <HomeComposer />

      {/* The demo sits directly after the fold. A visitor who has read the hero
          is asking "what is it actually like", and answering that before
          anything else is what stops the page reading as a brochure. */}
      <AnimatedDemo />

      <AIShowcase />

      {/* Promoted from ninth.
          
          This is eight real generations with the prompt that produced each one
          — the only unambiguous proof on the page that the product works. It
          used to sit below the feature list, the provider grid and the
          templates, which meant a visitor met three sections of claims before
          a single piece of evidence. */}
      <MadeWithAtheos />
      <Gallery locale={locale} />

      <Templates locale={locale} />
      <HowItWorks locale={locale} />
      <Features locale={locale} />

      {/* Demoted from seventh. Which providers are connected is a qualifying
          question for a technical buyer, not an opening argument — and the
          roadmap half of it was competing for attention with shipped work. */}
      <AIModels />

      <Pricing />

      {/* Demoted from second.
          
          Naming Next.js, Vercel and Stripe is credible and reassuring, and it
          is reassurance — it answers "is this a weekend project", which is a
          question somebody asks *after* they are interested. It was occupying
          the second-most valuable position on the page, above every piece of
          evidence that the product generates anything. */}
      <TrustedBy locale={locale} />

      {/* Renders nothing — `TESTIMONIALS` is empty because there are no
          customers yet. Mounted anyway so the section appears the moment a
          real, consented quote exists, rather than needing this file edited
          under launch pressure. */}
      <Testimonials />

      <Faq />
    </>
  );
}
