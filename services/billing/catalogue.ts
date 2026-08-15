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
  /**
   * Credits granted at the start of each billing period.
   *
   * **Null means not yet decided.** Four of the six sellable models still carry
   * estimated or unknown provider costs (`services/billing/model-costs.ts`), and
   * an allowance derived from an estimate is a promise the backend might not be
   * able to keep. Nothing may render a number from a null — the pricing page
   * shows the plan as not yet available instead, which is true.
   *
   * `services/billing/plan-config.ts` holds the provisional figure and the
   * arithmetic behind it, server-side, where it carries no promise.
   */
  monthlyCredits: number | null;
  features: readonly string[];
  featured?: boolean;
  /**
   * Whether this plan can be bought today.
   *
   * `launch_disabled` plans are configured and priced, and the pricing page
   * shows them with their credit line replaced by "confirmed at launch"
   * rather than a guess.
   *
   * There is no `retired` state. Sprint 4.1 removed the last retired tier by
   * deleting its enum value outright, which is the honest version of retiring
   * a plan that was never sold.
   */
  status: "active" | "launch_disabled";
}

export const CURRENCY = "usd";

/**
 * The plans.
 *
 * ## Four, monthly, no annual, no Agency
 *
 * The $5 Starter and the $199 Agency are gone: the first was marginal after
 * Stripe took $0.45 of it, and the second sold volume nobody had asked for.
 * Annual billing is gone too — it takes a year's money against costs that have
 * not been measured yet, which is the wrong direction to be wrong in.
 *
 * Sprint 4.1 went further and renamed the **enum values** to match, so `STUDIO`
 * is the $89.99 plan in the database, in the type system and on the page. See
 * `prisma/schema.prisma` for why that was done once, while it was still free.
 * There is no retired-tier entry here any more because there is no retired
 * value left in the enum to resolve.
 *
 * ## Every feature line here must be true today.
 * Sequences, audio and the
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
    tier: "FREE",
    name: "Free",
    description:
      "A handful of images, to see whether the output is good enough.",
    monthly: 0,
    // **One-time.** Not a monthly allowance — Sprint 4 removed the renewal, and
    // the wording here changed with it. A free tier that renews forever is a
    // cost that grows with signups and never with revenue, which on a $500
    // ceiling is the one shape that cannot be managed.
    monthlyCredits: 100,
    features: [
      "100 credits when you join, one time",
      "Around 25 images, or 7 on the quality model",
      "Full asset library and projects",
      "Commercial rights to everything you make",
    ],
    status: "active",
  },
  {
    tier: "CREATOR",
    name: "Creator",
    description: "For one person publishing on a schedule.",
    monthly: 999,
    monthlyCredits: null,
    features: [
      "Both video models, including Motion Pro",
      "1080p video up to 12 seconds",
      "Every aspect ratio — 16:9, 9:16, 1:1, 21:9",
      "Image-to-video and reference images",
      "Background removal and 4K upscaling",
      "3 generations at once",
    ],
    featured: true,
    status: "launch_disabled",
  },
  {
    tier: "PRO",
    name: "Pro",
    description: "For channels shipping every day.",
    monthly: 3499,
    monthlyCredits: null,
    features: [
      "Everything in Creator",
      "5 generations at once",
      "Bulk generation and export",
      "Usage and cost breakdown",
      "Publish to the community gallery",
      "Email support",
    ],
    status: "launch_disabled",
  },
  {
    tier: "STUDIO",
    name: "Studio",
    description: "For studios producing at volume.",
    monthly: 8999,
    monthlyCredits: null,
    features: [
      "Everything in Pro",
      "8 generations at once",
      "Full usage and cost breakdown per generation",
      "Priority email support",
    ],
    status: "launch_disabled",
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
/**
 * What a new account receives, **once**.
 *
 * Not monthly. `services/billing/free-grant.ts` holds the reasoning and the
 * abuse analysis; the grant itself happens in `services/users/provision.ts`,
 * inside the transaction that creates the user, keyed on the Clerk id so a
 * retried webhook cannot double it.
 *
 * At $0.005 a credit this is $0.50 of retail value. The real exposure is lower:
 * video is not reachable from the Free plan, so the worst case is about seven
 * quality images, or $0.18 of provider spend.
 */
export const SIGNUP_GRANT = 100;

/** Plans that may be bought today. */
export function sellablePlanDefinitions(): readonly PlanDefinition[] {
  return PLAN_DEFINITIONS.filter((plan) => plan.status === "active");
}

/**
 * Plans the pricing page renders.
 *
 * Includes `launch_disabled` — a plan whose *price and capabilities* are
 * settled and whose *credit allowance* is not. Showing it is honest: the price
 * is real, the features are real, and the one number that is still being
 * measured is the one the card declines to print. Hiding the paid plans
 * entirely would suggest the product has no paid tier, which is a different and
 * larger untruth.
 *
 * Since Sprint 4.1 this is every plan — there is no retired tier left to
 * exclude. It stays a function rather than becoming an alias for
 * `PLAN_DEFINITIONS` because the pricing page should keep asking "which of
 * these may I show?" rather than assuming the answer is always "all of them".
 */
export function visiblePlanDefinitions(): readonly PlanDefinition[] {
  return PLAN_DEFINITIONS;
}

export function planDefinitionFor(tier: PlanTier): PlanDefinition {
  return (
    PLAN_DEFINITIONS.find((plan) => plan.tier === tier) ?? PLAN_DEFINITIONS[0]
  );
}

/** Ordering, so "is this an upgrade" is a comparison rather than a table. */
const RANK: Record<PlanTier, number> = {
  FREE: 0,
  CREATOR: 1,
  PRO: 2,
  STUDIO: 3,
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
