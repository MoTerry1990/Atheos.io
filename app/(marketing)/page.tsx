import type { Metadata } from "next";

import { Landing } from "@/features/marketing/components/landing";
import { MarketingShell } from "@/features/marketing/components/marketing-shell";
import { getCopy } from "@/features/marketing/i18n/dictionaries";
import { alternatesFor } from "@/features/marketing/i18n/metadata";
import { SITE } from "@/features/marketing/content";

const copy = getCopy("en");

/**
 * `absolute` skips the parent `%s · Atheos` template. Without it the root
 * template wraps this title and the tab reads "Atheos — … · Atheos".
 */
export const metadata: Metadata = {
  title: { absolute: `${SITE.name} — ${copy.site.tagline}` },
  description: copy.site.description,
  alternates: alternatesFor("home", "en"),
};

export default function LandingPage() {
  return (
    <MarketingShell locale="en">
      <Landing locale="en" />
    </MarketingShell>
  );
}
