import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SITE } from "@/features/marketing/content";
import { getCopy } from "@/features/marketing/i18n/dictionaries";

// These surfaces are English-only today: the auth screens and the OG image
// are not locale-routed. Reading the dictionary rather than inlining the
// strings means they follow when they are.
const copy = getCopy("en");
import { env } from "@/lib/env";

/**
 * Marketing shell.
 *
 * This is where indexing is switched **on**. The root layout sets
 * `robots: { index: false }` as a safe default for the whole application —
 * dashboards and the design-system gallery must never be indexed — and the
 * marketing route group opts back in. Defaulting to noindex and opting in is
 * the right way round: forgetting to add noindex leaks a private page, whereas
 * forgetting to add index costs nothing but a day of ranking.
 *
 * ## The header and footer are not here
 *
 * They need the locale, and a layout cannot tell `/` from `/es` — both sit
 * beneath it. Each page renders `MarketingShell` instead, which owns the
 * chrome and the locale provider together so a page cannot have one without
 * the other. What stays here is metadata that is genuinely locale-independent:
 * the robots policy, the keywords and the card type. Titles, descriptions and
 * `hreflang` are set per page.
 */
export const metadata: Metadata = {
  // No `title` here on purpose. A `title.default` in this layout would be fed
  // through the root layout's `%s · Atheos` template, producing the duplicated
  // "Atheos — … · Atheos". The page sets its own title with `absolute`, which
  // bypasses the template entirely.
  description: copy.site.description,
  keywords: [
    "AI image generation",
    "AI video generation",
    "multi-provider AI platform",
    "creative AI tools",
    "AI creative workspace",
    "generative AI platform",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} — ${copy.site.tagline}`,
    description: copy.site.description,
    url: env.NEXT_PUBLIC_APP_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${copy.site.tagline}`,
    description: copy.site.description,
  },
  category: "technology",
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return children;
}
