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
