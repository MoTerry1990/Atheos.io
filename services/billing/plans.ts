import "server-only";

import { env } from "@/lib/env";
import { stripeConfigProblems } from "@/lib/stripe";
import {
  PACK_DEFINITIONS,
  PLAN_DEFINITIONS,
  type PackDefinition,
  type PlanDefinition,
} from "@/services/billing/catalogue";
import type { BillingInterval, PlanTier } from "@/lib/generated/prisma/enums";

/**
 * The catalogue, plus the Stripe price ids.
 *
 * **Server-only**, and that is the entire reason this is a separate file from
 * `catalogue.ts`: price ids come from server environment variables, and
 * `@t3-oss/env-nextjs` throws if one is read in the browser. The catalogue is
 * imported by the landing page and the billing screen; this is not.
 *
 * ## Amounts are committed; ids are not
 *
 * A Stripe price id is created in the dashboard and differs per account and
 * between test and live mode, so it cannot live in the repository. What can is
 * the amount, the allowance and the entitlements — the things the product
 * promises. If an id is missing the plan is not offered, and asking for it
 * fails with a message naming the variable. Same rule as the placeholder
 * Replicate versions in Sprint 6: an obvious failure beats a plausible one.
 *
 * Nothing here can guarantee the amount in `catalogue.ts` matches the amount
 * configured in Stripe — Stripe owns what is actually charged. What it can do
 * is refuse to sell a plan it has no id for, rather than showing a price and
 * silently charging whatever the dashboard says.
 */

export interface Plan extends PlanDefinition {
  priceIds: { month?: string; year?: string };
}

export interface CreditPack extends PackDefinition {
  priceId?: string;
}

/**
 * Stripe price ids, per plan.
 *
 * **Monthly only.** Sprint 4 retired annual billing — a year of money taken
 * against provider costs that have not been measured is the wrong direction to
 * be wrong in — so there is no `year` id to configure, and `priceFor` returns
 * undefined for a yearly request rather than quietly charging the monthly rate
 * twelve times.
 *
 * The variable names follow the `PlanTier` value, which since Sprint 4.1 is
 * also the plan's name. `STRIPE_PRICE_STUDIO_MONTHLY` is the $89.99 Studio
 * plan; it used to be `STRIPE_PRICE_AGENCY_MONTHLY` for a plan called Studio,
 * which is the class of confusion that sprint existed to end.
 */
const PRICE_IDS: Partial<Record<PlanTier, { month?: string; year?: string }>> =
  {
    CREATOR: { month: env.STRIPE_PRICE_CREATOR_MONTHLY },
    PRO: { month: env.STRIPE_PRICE_PRO_MONTHLY },
    STUDIO: { month: env.STRIPE_PRICE_STUDIO_MONTHLY },
    // FREE has none deliberately: the free tier is the *absence* of a
    // subscription, not a zero-amount one. A $0 Stripe subscription still asks
    // for a card, which is exactly the friction a free tier exists to avoid.
  };

const PACK_PRICE_IDS: Record<string, string | undefined> = {
  pack_1000: env.STRIPE_PRICE_PACK_1000,
  pack_5000: env.STRIPE_PRICE_PACK_5000,
  pack_20000: env.STRIPE_PRICE_PACK_20000,
};

export const PLANS: readonly Plan[] = PLAN_DEFINITIONS.map((plan) => ({
  ...plan,
  priceIds: PRICE_IDS[plan.tier] ?? {},
}));

export const CREDIT_PACKS: readonly CreditPack[] = PACK_DEFINITIONS.map(
  (pack) => ({ ...pack, priceId: PACK_PRICE_IDS[pack.id] }),
);

export const FREE_PLAN = PLANS[0];

export function planFor(tier: PlanTier): Plan {
  return PLANS.find((plan) => plan.tier === tier) ?? FREE_PLAN;
}

export function packFor(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}

/**
 * Which tier and interval a Stripe price id corresponds to.
 *
 * Resolved once, when a webhook arrives, and stored on the subscription row.
 * Resolving it on read would make every entitlement check depend on an
 * environment variable being present — so a deploy missing one price id would
 * silently downgrade every customer on that plan.
 */
export function resolvePriceId(
  priceId: string | null | undefined,
): { tier: PlanTier; interval: BillingInterval } | null {
  if (!priceId) return null;

  for (const plan of PLANS) {
    if (plan.priceIds.month === priceId) {
      return { tier: plan.tier, interval: "MONTH" };
    }
    // Kept so a subscription created before annual billing was retired still
    // resolves to a tier rather than to null. `priceIds.year` is undefined for
    // every plan now, so this matches nothing new.
    if (plan.priceIds.year === priceId) {
      return { tier: plan.tier, interval: "YEAR" };
    }
  }

  return null;
}

export function priceIdFor(
  tier: PlanTier,
  interval: BillingInterval,
): string | undefined {
  const plan = planFor(tier);
  return interval === "YEAR" ? plan.priceIds.year : plan.priceIds.month;
}

/**
 * Whether billing can run at all.
 *
 * Checked before showing a checkout button rather than after clicking it. A key
 * alone is not enough: without price ids there is nothing to sell, and without
 * the webhook secret a completed payment would never grant anything — which is
 * the worst of the three failure modes, because the customer's card is charged.
 */
/**
 * Is billing actually usable — not merely populated.
 *
 * This used to test three variables for presence, which is the check that let
 * `sk_test_placeholder` read as a configured Stripe account. `stripeConfigProblems`
 * validates prefix, length, charset, quoting and whitespace, and refuses a live
 * key outright, so a misconfiguration disables checkout instead of surfacing at
 * the moment a customer clicks Subscribe.
 */
export function isBillingConfigured(): boolean {
  return stripeConfigProblems().length === 0;
}

/** Names the missing variables, so a misconfiguration is actionable. */
export function billingConfigurationProblems(): string[] {
  // Structural defects first: "STRIPE_SECRET_KEY is a placeholder" is a more
  // useful line than "STRIPE_SECRET_KEY", and the old check could not say it.
  const problems: string[] = stripeConfigProblems().map(
    (problem) => `${problem.variable} ${problem.problem}`,
  );

  for (const plan of PLANS) {
    if (plan.tier === "FREE") continue;
    if (!plan.priceIds.month)
      problems.push(`STRIPE_PRICE_${plan.tier}_MONTHLY`);
    // No yearly check. Annual billing was retired in Sprint 4, so a missing
    // yearly price is the configured state rather than a problem to report.
  }

  for (const pack of CREDIT_PACKS) {
    if (!pack.priceId) problems.push(`STRIPE_PRICE_${pack.id.toUpperCase()}`);
  }

  return problems;
}

export {
  CURRENCY,
  SIGNUP_GRANT,
  formatMoney,
  isUpgrade,
  rankOf,
} from "@/services/billing/catalogue";
