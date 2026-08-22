import { ApiError, type BillingSummary } from "@/features/billing/lib/api";
import type { BillingApi } from "@/features/billing/lib/api-context";
import {
  PACK_DEFINITIONS,
  PLAN_DEFINITIONS,
} from "@/services/billing/catalogue";
import type { BillingInterval, PlanTier } from "@/lib/generated/prisma/enums";

/**
 * An in-memory billing backend.
 *
 * There is no Stripe account in this environment, so without this the billing
 * screen renders one error banner. Billing is also the surface where
 * "it typechecked" is furthest from "it works": money moves, and the states
 * that matter most — past due, cancelling, a scheduled downgrade, nothing
 * configured — are exactly the ones a happy-path demo never reaches.
 *
 * ## It reproduces the rules, including the awkward ones
 *
 * Upgrades apply immediately and grant credits; downgrades schedule for the
 * period end and change nothing now; cancelling is a downgrade to Starter;
 * resuming clears it. A preview more permissive than the server would teach the
 * wrong thing about the product.
 *
 * ## What it deliberately does not do
 *
 * Checkout returns a URL that goes nowhere. Redirecting to a fake payment page
 * would be pretending to take money, and the honest thing for a fixture is to
 * say so. The scenario picker is how the paid states are reached instead.
 */

export type Scenario =
  | "free"
  | "subscribed"
  | "past_due"
  | "cancelling"
  | "unconfigured"
  /**
   * An owner: complimentary Studio access with a real Creator subscription
   * underneath. Added in Sprint 6B, when a live purchase on the owner account
   * showed "Current plan: Studio" and offered to move the customer onto the
   * plan they had just bought. It is unreachable in the preview without a role
   * override *and* a paid subscription, which is exactly the kind of state this
   * page exists to make visible.
   */
  | "complimentary";

const LATENCY_MS = 200;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

const PLANS = PLAN_DEFINITIONS.map((plan) => ({
  ...plan,
  // Monthly only. The fixture used to mint a `year` id too, which meant the
  // billing preview rendered a working yearly option for a price that does not
  // exist in Stripe and a plan that is not sold annually — a preview showing
  // something the real screen cannot do is worse than no preview.
  priceIds:
    plan.tier === "FREE" ? {} : { month: `price_fixture_${plan.tier}_m` },
}));

const PACKS = PACK_DEFINITIONS.map((pack) => ({
  ...pack,
  priceId: `price_fixture_${pack.id}`,
}));

export function createFixtureApi(now: number, scenario: Scenario): BillingApi {
  const day = 86_400_000;

  const configured = scenario !== "unconfigured";
  const subscribed =
    scenario === "subscribed" ||
    scenario === "past_due" ||
    scenario === "cancelling" ||
    scenario === "complimentary";

  // Access granted by role rather than payment. The subscription underneath is
  // real and still governs every billing control.
  const complimentary = scenario === "complimentary";

  const state = {
    // Effective access. An owner reaches Studio whatever they pay for.
    tier: (complimentary
      ? "STUDIO"
      : subscribed
        ? "CREATOR"
        : "FREE") as PlanTier,
    interval: "MONTH" as BillingInterval,
    status: subscribed
      ? scenario === "past_due"
        ? ("PAST_DUE" as const)
        : ("ACTIVE" as const)
      : null,
    cancelAtPeriodEnd: scenario === "cancelling",
    scheduledTier: (scenario === "cancelling"
      ? "FREE"
      : null) as PlanTier | null,
    balance: complimentary ? 17_079 : subscribed ? 2140 : 118,
  };

  const periodStart = now - 12 * day;
  const periodEnd = now + 18 * day;

  function summary(): BillingSummary {
    const plan = PLANS.find((entry) => entry.tier === state.tier) ?? PLANS[0];

    return {
      configured,
      problems: configured
        ? []
        : [
            "STRIPE_PRICE_CREATOR_MONTHLY",
            "STRIPE_PRICE_PRO_MONTHLY",
            "STRIPE_PRICE_STUDIO_MONTHLY",
          ],
      creditBalance: state.balance,
      entitlement: {
        tier: state.tier,
        interval: state.interval,
        status: state.status,
        active: subscribed,
        // Access above, billing here. They are the same plan for an ordinary
        // customer and deliberately differ for an owner.
        billedTier: complimentary ? "CREATOR" : subscribed ? state.tier : null,
        complimentary,
        currentPeriodStart: subscribed ? periodStart : null,
        currentPeriodEnd: subscribed ? periodEnd : null,
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        scheduledTier: state.scheduledTier,
        stripeCustomerId: subscribed ? "cus_fixture" : null,
        stripeSubscriptionId: subscribed ? "sub_fixture" : null,
      },
      plans: PLANS,
      packs: PACKS,
      usage: {
        periodStart: subscribed ? periodStart : now - 30 * day,
        periodEnd: subscribed ? periodEnd : now,
        // Only a subscriber has a billing period; everyone else gets the
        // rolling window, which must not be compared to a monthly grant.
        isBillingPeriod: subscribed,
        /**
         * Wallet consumption, not subscription-credit consumption.
         *
         * The owner scenario deliberately spends more than Creator's 500
         * monthly grant, because that is what the real account does: the
         * balance is pooled and mostly came from adjustments and packs. It is
         * the case the panel used to render as an overage against the wrong
         * plan's allowance.
         */
        creditsSpent: complimentary ? 860 : subscribed ? 380 : 82,
        creditsGranted: complimentary ? 500 : (plan.monthlyCredits ?? 0),
        generations: subscribed ? 47 : 9,
        byModality: subscribed
          ? [
              { modality: "VIDEO", credits: 540, generations: 6 },
              { modality: "IMAGE", credits: 320, generations: 41 },
            ]
          : [{ modality: "IMAGE", credits: 82, generations: 9 }],
        byModel: subscribed
          ? [
              { model: "replicate/video-gen", credits: 540, generations: 6 },
              { model: "replicate/flux-dev", credits: 240, generations: 20 },
              { model: "replicate/flux-schnell", credits: 80, generations: 21 },
            ]
          : [{ model: "mock/standard", credits: 82, generations: 9 }],
      },
      invoices: subscribed
        ? [
            {
              id: "in_fixture_2",
              number: "ATH-0042",
              status: "paid",
              amountDue: 2400,
              amountPaid: 2400,
              currency: "usd",
              created: periodStart,
              periodStart,
              periodEnd,
              hostedUrl: null,
              pdfUrl: null,
              description: null,
            },
            {
              id: "in_fixture_1",
              number: "ATH-0041",
              status: "paid",
              amountDue: 2400,
              amountPaid: 2400,
              currency: "usd",
              created: periodStart - 30 * day,
              periodStart: periodStart - 30 * day,
              periodEnd: periodStart,
              hostedUrl: null,
              pdfUrl: null,
              description: null,
            },
          ]
        : [],
      history: [
        ...(subscribed
          ? [
              {
                id: "ct_grant",
                amount: 3000,
                reason: "SUBSCRIPTION_GRANT" as const,
                balanceAfter: 3000,
                stripeReference: "in_fixture_2",
                createdAt: periodStart,
                generation: null,
              },
            ]
          : [
              {
                id: "ct_signup",
                amount: 200,
                reason: "SIGNUP_GRANT" as const,
                balanceAfter: 200,
                stripeReference: null,
                createdAt: now - 40 * day,
                generation: null,
              },
            ]),
        {
          id: "ct_spend",
          amount: -90,
          reason: "GENERATION_SPEND" as const,
          balanceAfter: state.balance,
          stripeReference: null,
          createdAt: now - 2 * 3_600_000,
          generation: {
            id: "gen_1",
            model: "replicate/video-gen",
            operation: "text-to-video",
            modality: "VIDEO" as const,
          },
        },
        {
          id: "ct_refund",
          amount: 90,
          reason: "GENERATION_REFUND" as const,
          balanceAfter: state.balance + 90,
          stripeReference: null,
          createdAt: now - 3 * 3_600_000,
          generation: null,
        },
      ],
    };
  }

  function requireConfigured() {
    if (configured) return;
    throw new ApiError(
      "Billing is not configured. Missing: STRIPE_PRICE_STUDIO_MONTHLY.",
      503,
      "billing_unconfigured",
    );
  }

  return {
    async loadBilling() {
      return delay(summary());
    },

    async startSubscriptionCheckout() {
      requireConfigured();
      // Honest failure. A fixture that redirected somewhere would be
      // pretending to take a payment.
      throw new ApiError(
        "Checkout needs a real Stripe account — this preview has no payment page to send you to.",
        503,
        "preview_only",
      );
    },

    async startPackCheckout() {
      requireConfigured();
      throw new ApiError(
        "Checkout needs a real Stripe account — this preview has no payment page to send you to.",
        503,
        "preview_only",
      );
    },

    async changePlan(tier) {
      requireConfigured();
      if (!subscribed) {
        throw new ApiError(
          "You do not have a subscription to change.",
          409,
          "no_subscription",
        );
      }

      const rank = { FREE: 0, CREATOR: 1, PRO: 2, STUDIO: 3 };
      const upgrading = rank[tier] > rank[state.tier];

      if (upgrading) {
        // Applies now, and the allowance follows from the invoice.
        state.tier = tier;
        state.scheduledTier = null;
        state.cancelAtPeriodEnd = false;
        state.balance += 9000;
      } else {
        // Scheduled. Nothing about the current period changes.
        state.scheduledTier = tier;
      }

      return delay({
        ok: true as const,
        effective: upgrading ? "now" : "period_end",
        entitlement: summary().entitlement,
      });
    },

    async cancelPlan() {
      requireConfigured();
      state.cancelAtPeriodEnd = true;
      state.scheduledTier = "FREE";
      return delay({
        ok: true as const,
        effective: "period_end",
        entitlement: summary().entitlement,
      });
    },

    async resumePlan() {
      requireConfigured();
      state.cancelAtPeriodEnd = false;
      state.scheduledTier = null;
      return delay({
        ok: true as const,
        effective: "now",
        entitlement: summary().entitlement,
      });
    },

    async openPortal() {
      throw new ApiError(
        "The billing portal is hosted by Stripe and needs a real account.",
        503,
        "preview_only",
      );
    },
  };
}
