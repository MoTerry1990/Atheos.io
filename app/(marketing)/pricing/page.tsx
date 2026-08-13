import type { Metadata } from "next";

import { MarketingShell } from "@/features/marketing/components/marketing-shell";
import { PricingPage } from "@/features/marketing/components/pricing-page";
import { alternatesFor } from "@/features/marketing/i18n/metadata";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "One credit balance across every model. Free to start, no per-provider subscriptions, and unused credits roll over for a month.",
  alternates: alternatesFor("pricing", "en"),
};

export default function Page() {
  return (
    <MarketingShell locale="en">
      <PricingPage locale="en" />
    </MarketingShell>
  );
}
