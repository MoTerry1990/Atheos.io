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
  // The cheapest way in. Deliberately a one-off rather than a subscription:
  // it catches the person who has used their free video and is not ready to
  // commit to a monthly plan. People who buy it twice tend to subscribe.
  { id: "pack_350", name: "350 credits", credits: 350, amount: 500 },
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
const RANK: Record<PlanTier, number> = { STARTER: 0, STUDIO: 1, SCALE: 2 };

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
