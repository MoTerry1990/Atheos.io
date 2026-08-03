import type { Metadata } from "next";

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
import { SITE } from "@/features/marketing/content";

/**
 * The landing page.
 *
 * A Server Component that composes sections and nothing else — no state, no
 * data fetching, no logic. Only the four sections that genuinely need
 * interactivity (`Hero`, `AIShowcase`, `Pricing`, `Faq`) are client components;
 * the rest render to static HTML, which is both faster and the version a search
 * crawler sees without executing anything.
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
 */
/**
 * `absolute` skips the parent `%s · Atheos` template. Without it the root
 * template wraps this title and the tab reads "Atheos — … · Atheos".
 */
export const metadata: Metadata = {
  title: { absolute: `${SITE.name} — ${SITE.tagline}` },
};

export default function LandingPage() {
  return (
    <>
      <Hero />
      <TrustedBy />

      {/* The demo sits directly after the fold. A visitor who has read the hero
          is asking "what is it actually like", and answering that before the
          feature list is what stops the page reading as a brochure. */}
      <AnimatedDemo />

      <AIShowcase />
      <Features />
      <HowItWorks />

      {/* Providers before templates: which models are connected is a
          qualifying question, and a buyer who needs a vendor we do not have
          should find that out before scrolling a gallery. */}
      <AIModels />

      <Templates />
      <Gallery />
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
