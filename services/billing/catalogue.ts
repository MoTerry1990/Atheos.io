import type { PlanTier } from "@/lib/generated/prisma/enums";

/**
 * What Atheos sells.
 *
 * ## Deliberately free of `env` and of `server-only`
 *
 * This file is imported by the landing page, the pricing card and the billing
 * screen — all of which run in the browser. `services/billing/plans.ts` sits on
 * top and adds the Stripe price ids, which come from server environment
 * variables and would throw the moment this module reached a client bundle.
 *
 * The split is not tidiness. Reading a server variable at module scope in a
 * file that a client component transitively imports is a runtime error in
 * production and nothing in development, which is the worst possible time to
 * find out.
 *
 * ## One catalogue, two audiences
 *
 * The landing page has advertised three tiers since Sprint 2 from its own
 * hand-written list. That was fine while nothing could be bought; now that
 * checkout is real, two lists would eventually advertise $24 and charge
 * something else — and the user would discover it at the card form. This is the
 * list. `features/marketing/content.ts` reshapes it for a marketing card and
 * invents no numbers of its own.
 *
 * ## Minor units
 *
 * Cents, not dollars, everywhere. Money in floating point is how a total ends
 * in `.00000001`; Stripe's API is in minor units for the same reason. One
 * conversion, at the point of display.
 */

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  description: string;
  /** Per month, billed monthly. Minor units. */
  monthly: number;
  /** Per month, billed yearly. Minor units. */
  yearly: number;
  /** Credits granted at the start of each billing period. */
  monthlyCredits: number;
  features: readonly string[];
  featured?: boolean;
}

export const CURRENCY = "usd";

/**
 * The plans.
 *
 * **Every feature line here must be true today.** Sequences, audio and the
 * editor are specified and not built; naming them on a pricing page would be
 * selling something that does not exist, and the first customer to look for it
 * stops believing the rest of the list. They go in when they ship.
 *
 * Credit counts are translated into outcomes — "11 videos or 250 images" rather
 * than "1,000 credits" — because a number of credits means nothing to somebody
 * who has never used the product. The credits are still shown; they are just
 * not the headline.
 */
export const PLAN_DEFINITIONS: readonly PlanDefinition[] = [
  {
    tier: "STARTER",
    name: "Free",
    description: "One video and a handful of images, to see if it fits.",
    monthly: 0,
    yearly: 0,
    // 100 credits is exactly one video on the fast model, or 25 images. At
    // measured provider rates that is ~$0.10 per signup — a cheap way to let
    // somebody find out whether the output is good enough for them.
    monthlyCredits: 100,
    features: [
      "1 video or 25 images",
      "720p video, fast model",
      "Image upscaling to 4K",
      "Full asset library and projects",
      "Commercial rights to everything you make",
    ],
  },
  {
    tier: "BASIC",
    name: "Starter",
    description: "For the occasional project, without a monthly commitment.",
    monthly: 500,
    yearly: 400,
    // 350 credits is roughly three videos or eighty-seven images. Priced to be
    // an easy yes rather than to be profitable per seat: at ~$0.001 a credit it
    // costs us about $0.39 to serve, and Stripe takes $0.45 of the $5.
    monthlyCredits: 350,
    features: [
      "3 videos or 87 images a month",
      "720p video, fast model",
      "Background removal and 4K upscaling",
      "Full asset library and projects",
      "Automatic refund when a provider fails",
      "Commercial rights to everything you make",
    ],
  },
  {
    tier: "STUDIO",
    name: "Creator",
    description: "For one person publishing on a schedule.",
    monthly: 1599,
    yearly: 1299,
    monthlyCredits: 1000,
    features: [
      "11 videos or 250 images a month",
      "1080p video up to 12 seconds",
      "Every aspect ratio — 16:9, 9:16, 1:1, 21:9",
      "Both video models, including Motion Pro",
      "Image-to-video and reference images",
      "Background removal and 4K upscaling",
      "Automatic refund when a provider fails",
    ],
    featured: true,
  },
  {
    tier: "SCALE",
    name: "Studio",
    description: "For channels shipping every day, and small teams.",
    monthly: 3599,
    yearly: 2899,
    monthlyCredits: 3000,
    features: [
      "33 videos or 750 images a month",
      "Everything in Creator",
      "Bulk generation and export",
      "Usage and cost breakdown",
      "Publish to the community gallery",
      "Email support",
    ],
  },
  {
    tier: "AGENCY",
    name: "Agency",
    description: "For studios and agencies producing at volume.",
    monthly: 19900,
    yearly: 15900,
    monthlyCredits: 20000,
    // Deliberately a *volume* tier and nothing more. Team seats, SSO, invoicing
    // and a support SLA are what usually justify a price like this, and none of
    // them are built — so none of them are listed. Everything below is a
    // capability the product has today, at six times the Studio allowance.
    // People who need the seats-and-procurement version get the contact card
    // further down the page instead, which is honest about being a conversation.
    features: [
      "222 videos or 5,000 images a month",
      "Everything in Studio",
      "Unused credits roll over for a month",
      "Bulk generation and export",
      "Full usage and cost breakdown per generation",
      "Email support",
    ],
  },
] as const;

/**
 * Credit packs — one-off purchases, not subscriptions.
 *
 * They exist because a monthly allowance is the wrong shape for the actual
 * failure case: somebody halfway through a deadline who has run out. Making
 * them upgrade a plan they will downgrade next week is worse for both sides
 * than selling them what they need.
 */
export interface PackDefinition {
  id: string;
  name: string;
  credits: number;
  /** Minor units. */
  amount: number;
}

export const PACK_DEFINITIONS: readonly PackDefinition[] = [
  // There is deliberately no 350-credit pack. It existed briefly and was
  // removed when Starter became a $5 subscription with the same allowance:
  // two products at the same price for the same credits, on the same page, is
  // a decision the reader has to make and cannot make well. The entry point is
  // the plan; packs start above it, where they answer a different question.
  { id: "pack_1000", name: "1,000 credits", credits: 1000, amount: 1200 },
  { id: "pack_5000", name: "5,000 credits", credits: 5000, amount: 5000 },
  { id: "pack_20000", name: "20,000 credits", credits: 20_000, amount: 18_000 },
] as const;

/** Credits granted once, when an account is created. Matches Starter. */
export const SIGNUP_GRANT = 100;

export function planDefinitionFor(tier: PlanTier): PlanDefinition {
  return (
    PLAN_DEFINITIONS.find((plan) => plan.tier === tier) ?? PLAN_DEFINITIONS[0]
  );
}

/** Ordering, so "is this an upgrade" is a comparison rather than a table. */
const RANK: Record<PlanTier, number> = {
  STARTER: 0,
  BASIC: 1,
  STUDIO: 2,
  SCALE: 3,
  AGENCY: 4,
};

export function isUpgrade(from: PlanTier, to: PlanTier): boolean {
  return RANK[to] > RANK[from];
}

export function rankOf(tier: PlanTier): number {
  return RANK[tier];
}

/** Minor units to a display string. */
export function formatMoney(
  minorUnits: number,
  currency: string = CURRENCY,
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    // Whole amounts read better without ".00" on a pricing card, but a
    // pro-rated invoice line of $7.43 must not be rounded to $7.
    minimumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
  }).format(minorUnits / 100);
}
