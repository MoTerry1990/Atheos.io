import "server-only";

import Stripe from "stripe";

import { env } from "@/lib/env";

/**
 * The Stripe client. Server-only — the `server-only` import above turns any
 * accidental client-component import into a build error rather than a leaked
 * secret key.
 *
 * Stripe is the **source of truth** for billing state. Our `subscriptions`
 * table is a mirror, reconciled by webhook. When the two disagree, Stripe is
 * right and our row is stale; never resolve a conflict the other way.
 */
/** A structural defect in the Stripe configuration. Never carries the value. */
export interface StripeConfigProblem {
  variable: string;
  problem: string;
}

/**
 * What is structurally wrong with the Stripe configuration, if anything.
 *
 * ## Why this exists, and why it looks like `r2ConfigProblems`
 *
 * Because the R2 outage happened. Production held an access key of the wrong
 * length and a secret with a trailing newline for three sprints, and nothing
 * noticed, because the only check asked whether the variables were *present*.
 * `isBillingConfigured()` had exactly the same shape and exactly the same blind
 * spot — `sk_test_placeholder` is present, and a presence check calls that
 * configured.
 *
 * The failure mode here is worse than storage. A placeholder key does not fail
 * at boot; it fails at the moment a customer clicks Subscribe, having already
 * decided to pay.
 *
 * ## Fails closed, does not crash
 *
 * This returns problems; it never throws. `isBillingConfigured()` consults it,
 * so a malformed key disables checkout, the portal and the webhook while the
 * marketing pages, sign-in, studio and generation carry on untouched. Billing
 * is the only thing that should break when billing is misconfigured.
 *
 * ## Live keys are refused on purpose
 *
 * Not because a live key is malformed — because Atheos has never taken a real
 * payment, and the switch to live money should be a reviewed code change rather
 * than an environment variable somebody pastes at the wrong moment. Deleting
 * the `sk_live_` branch below is that change, and it should happen in the same
 * commit as the decision to accept real money.
 */
export function stripeConfigProblems(): StripeConfigProblem[] {
  const problems: StripeConfigProblem[] = [];

  const inspect = (
    variable: string,
    raw: string | undefined,
    check: (value: string) => string | null,
  ) => {
    if (!raw || raw.trim() === "") {
      problems.push({ variable, problem: "is missing" });
      return;
    }
    const trimmed = raw.trim();
    if (raw !== trimmed) {
      problems.push({
        variable,
        problem: "has leading or trailing whitespace — re-paste it",
      });
      return;
    }
    if (/^["']|["']$/.test(trimmed)) {
      problems.push({ variable, problem: "is wrapped in quotes" });
      return;
    }
    const failure = check(trimmed);
    if (failure) problems.push({ variable, problem: failure });
  };

  inspect("STRIPE_SECRET_KEY", env.STRIPE_SECRET_KEY, (value) => {
    // The literal that shipped in `.env.example` and sat in production for
    // three sprints looking like a configured test key.
    if (/placeholder|changeme|your[_-]?key/i.test(value)) {
      return "is a placeholder, not a real key";
    }
    if (value.startsWith("sk_live_")) {
      return "is a LIVE key — Atheos is test-mode only; see lib/stripe.ts";
    }
    if (!value.startsWith("sk_test_")) {
      return "does not start with sk_test_";
    }
    // Deliberately a floor rather than an exact length: Stripe has issued
    // several key formats and pinning one would reject a valid future key.
    if (value.length < 30) {
      return `is too short to be a real key (${value.length} characters)`;
    }
    if (!/^sk_test_[A-Za-z0-9]+$/.test(value)) {
      return "contains characters a Stripe key never has";
    }
    return null;
  });

  inspect("STRIPE_WEBHOOK_SECRET", env.STRIPE_WEBHOOK_SECRET, (value) =>
    value.startsWith("whsec_") ? null : "does not start with whsec_",
  );

  for (const [variable, value] of [
    ["STRIPE_PRICE_CREATOR_MONTHLY", env.STRIPE_PRICE_CREATOR_MONTHLY],
    ["STRIPE_PRICE_PRO_MONTHLY", env.STRIPE_PRICE_PRO_MONTHLY],
    ["STRIPE_PRICE_STUDIO_MONTHLY", env.STRIPE_PRICE_STUDIO_MONTHLY],
  ] as const) {
    inspect(variable, value, (v) =>
      v.startsWith("price_") ? null : "is not a Stripe price id (price_…)",
    );
  }

  return problems;
}

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  // Pinned deliberately. Stripe ships breaking API changes behind dated
  // versions; letting the SDK float means an unrelated `npm update` can change
  // the shape of a webhook payload in production.
  apiVersion: "2026-07-29.dahlia",
  typescript: true,
  appInfo: {
    name: "Atheos.io",
    url: env.NEXT_PUBLIC_APP_URL,
  },
  // Network blips during checkout are worse than a slightly slower response.
  maxNetworkRetries: 2,
});
