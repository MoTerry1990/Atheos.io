import "server-only";

import { env } from "@/lib/env";
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

const PRICE_IDS: Partial<Record<PlanTier, { month?: string; year?: string }>> =
  {
    BASIC: {
      month: env.STRIPE_PRICE_BASIC_MONTHLY,
      year: env.STRIPE_PRICE_BASIC_YEARLY,
    },
    STUDIO: {
      month: env.STRIPE_PRICE_STUDIO_MONTHLY,
      year: env.STRIPE_PRICE_STUDIO_YEARLY,
    },
    SCALE: {
      month: env.STRIPE_PRICE_SCALE_MONTHLY,
      year: env.STRIPE_PRICE_SCALE_YEARLY,
    },
    AGENCY: {
      month: env.STRIPE_PRICE_AGENCY_MONTHLY,
      year: env.STRIPE_PRICE_AGENCY_YEARLY,
    },
    // STARTER has none deliberately: the free tier is the *absence* of a
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
export function isBillingConfigured(): boolean {
  return Boolean(
    env.STRIPE_SECRET_KEY &&
    env.STRIPE_WEBHOOK_SECRET &&
    PLANS.some((plan) => plan.priceIds.month || plan.priceIds.year),
  );
}

/** Names the missing variables, so a misconfiguration is actionable. */
export function billingConfigurationProblems(): string[] {
  const problems: string[] = [];

  if (!env.STRIPE_SECRET_KEY) problems.push("STRIPE_SECRET_KEY");
  if (!env.STRIPE_WEBHOOK_SECRET) {
    problems.push("STRIPE_WEBHOOK_SECRET (payments would never be fulfilled)");
  }

  for (const plan of PLANS) {
    if (plan.tier === "STARTER") continue;
    if (!plan.priceIds.month)
      problems.push(`STRIPE_PRICE_${plan.tier}_MONTHLY`);
    if (!plan.priceIds.year) problems.push(`STRIPE_PRICE_${plan.tier}_YEARLY`);
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
