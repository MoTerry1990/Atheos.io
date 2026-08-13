import type { Metadata } from "next";

import { Landing } from "@/features/marketing/components/landing";
import { MarketingShell } from "@/features/marketing/components/marketing-shell";
import { getCopy } from "@/features/marketing/i18n/dictionaries";
import { alternatesFor } from "@/features/marketing/i18n/metadata";
import { SITE } from "@/features/marketing/content";

/**
 * The landing page in Spanish.
 *
 * Composition lives in `Landing`, so a section added to the English page
 * appears here without this file changing. What is local to the route is the
 * metadata: a Spanish title and description, and the `hreflang` pair telling a
 * crawler this and `/` are the same page in two languages rather than two
 * pages competing for the same query.
 */
const copy = getCopy("es");

export const metadata: Metadata = {
  title: { absolute: `${SITE.name} — ${copy.site.tagline}` },
  description: copy.site.description,
  alternates: alternatesFor("home", "es"),
  openGraph: {
    title: `${SITE.name} — ${copy.site.tagline}`,
    description: copy.site.description,
    locale: "es_419",
  },
};

export default function LandingPageEs() {
  return (
    <MarketingShell locale="es">
      <Landing locale="es" />
    </MarketingShell>
  );
}
