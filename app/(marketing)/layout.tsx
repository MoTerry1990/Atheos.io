import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteFooter } from "@/features/marketing/components/site-footer";
import { SiteHeader } from "@/features/marketing/components/site-header";
import { StructuredData } from "@/features/marketing/components/structured-data";
import { SITE } from "@/features/marketing/content";
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
 */
export const metadata: Metadata = {
  // No `title` here on purpose. A `title.default` in this layout would be fed
  // through the root layout's `%s · Atheos` template, producing the duplicated
  // "Atheos — … · Atheos". The page sets its own title with `absolute`, which
  // bypasses the template entirely.
  description: SITE.description,
  keywords: [
    "AI image generation",
    "AI video generation",
    "AI audio generation",
    "multi-provider AI platform",
    "creative AI tools",
    "AI creative workspace",
    "generative AI platform",
  ],
  alternates: {
    // Prevents duplicate-content dilution if the page is ever reachable with
    // tracking parameters or from a second hostname.
    canonical: "/",
  },
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
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    url: env.NEXT_PUBLIC_APP_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  category: "technology",
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <StructuredData />
      <SiteHeader />

      {/* No top padding: the hero deliberately sits underneath the transparent
          header and provides its own clearance. */}
      <main className="flex-1">{children}</main>

      <SiteFooter />
    </div>
  );
}
