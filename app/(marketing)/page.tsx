import type { Metadata } from "next";

import { AIShowcase } from "@/features/marketing/components/ai-showcase";
import { Faq } from "@/features/marketing/components/faq";
import { Features } from "@/features/marketing/components/features";
import { Gallery } from "@/features/marketing/components/gallery";
import { Hero } from "@/features/marketing/components/hero";
import { HowItWorks } from "@/features/marketing/components/how-it-works";
import { Pricing } from "@/features/marketing/components/pricing";
import { Templates } from "@/features/marketing/components/templates";
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
      <AIShowcase />
      <Features />
      <HowItWorks />
      <Templates />
      <Gallery />
      <Pricing />
      <Faq />
    </>
  );
}
