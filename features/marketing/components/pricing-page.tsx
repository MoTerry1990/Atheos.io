import { CreditPacks } from "@/features/marketing/components/credit-packs";
import { EnterpriseCard } from "@/features/marketing/components/enterprise-card";
import { Faq } from "@/features/marketing/components/faq";
import { PlanComparison } from "@/features/marketing/components/plan-comparison";
import { Pricing } from "@/features/marketing/components/pricing";
import type { Locale } from "@/features/marketing/i18n/locales";

/**
 * The pricing page, in one language.
 *
 * Separate from the landing page's pricing section rather than a duplicate of
 * it: `/pricing` is where people arrive from a comparison search, and they want
 * the detail the landing page deliberately omits — what a credit buys, what
 * each tier includes, and what happens when a generation fails.
 *
 * Every number reads from `PLAN_DEFINITIONS`, which is what the checkout
 * charges against. A marketing page with its own copy of the prices is a
 * marketing page that will eventually lie — and with two languages it would
 * lie in one of them first.
 */
export function PricingPage({ locale }: { locale: Locale }) {
  return (
    <>
      <Pricing />
      <CreditPacks locale={locale} />
      <PlanComparison locale={locale} />
      <EnterpriseCard locale={locale} />
      <Faq />
    </>
  );
}
