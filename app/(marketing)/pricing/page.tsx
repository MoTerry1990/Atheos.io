import type { Metadata } from "next";

import { Pricing } from "@/features/marketing/components/pricing";
import { CreditPacks } from "@/features/marketing/components/credit-packs";
import { PlanComparison } from "@/features/marketing/components/plan-comparison";
import { EnterpriseCard } from "@/features/marketing/components/enterprise-card";
import { Faq } from "@/features/marketing/components/faq";
import { SITE } from "@/features/marketing/content";

/**
 * The pricing page.
 *
 * Separate from the landing page's pricing section rather than a duplicate of
 * it: `/pricing` is where people arrive from a comparison search, and they
 * want the detail the landing page deliberately omits — what a credit buys,
 * what each tier includes, and what happens when a generation fails.
 *
 * Everything here reads from `PLAN_DEFINITIONS` and `CREDIT_PACKS`, which are
 * the same constants the checkout charges against. A marketing page with its
 * own copy of the prices is a marketing page that will eventually lie.
 */

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "One credit balance across every model. Free to start, no per-provider subscriptions, and unused credits roll over for a month.",
  alternates: { canonical: `${SITE.domain}/pricing` },
};

export default function PricingPage() {
  return (
    <>
      <Pricing />
      <CreditPacks />
      <PlanComparison />
      <EnterpriseCard />
      <Faq />
    </>
  );
}
