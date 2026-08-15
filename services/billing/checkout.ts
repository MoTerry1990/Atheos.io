import "server-only";

import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import {
  billingConfigurationProblems,
  isBillingConfigured,
  isUpgrade,
  packFor,
  planFor,
  priceIdFor,
} from "@/services/billing/plans";
import {
  getEntitlement,
  setScheduledTier,
} from "@/services/billing/subscription";
import type { BillingInterval, PlanTier } from "@/lib/generated/prisma/enums";

/**
 * Buying things.
 *
 * ## Nothing here grants anything
 *
 * Every function in this file starts a payment. **None of them adds a credit
 * or changes a plan.** That happens in the webhook, after Stripe confirms money
 * moved. The gap matters: a user who reaches the success page has not
 * necessarily paid — they can close the tab mid-3-D-Secure, the card can be
 * declined asynchronously, or they can simply navigate to the success URL.
 * Granting on redirect is how a product gives itself away.
 *
 * ## Checkout, not a card form
 *
 * Stripe Checkout is a hosted page. That is the point: card details never touch
 * our origin, which takes this application almost entirely out of PCI scope and
 * removes the single most damaging class of bug we could write. It also brings
 * 3-D Secure, wallets, tax and local payment methods for free.
 */

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly code: string = "invalid_request",
  ) {
    super(message);
    this.name = "BillingError";
  }
}

function requireBillingConfigured() {
  if (isBillingConfigured()) return;

  // Named variables rather than "billing is unavailable". This failure is
  // always a deployment mistake, and the person who can fix it is the one
  // reading the log.
  throw new BillingError(
    `Billing is not configured. Missing: ${billingConfigurationProblems().join(", ")}.`,
    503,
    "billing_unconfigured",
  );
}

/**
 * Find or create this user's Stripe customer.
 *
 * Created lazily, on the first purchase, rather than at signup. Most accounts
 * never buy anything, and a customer record per signup is a Stripe account full
 * of rows that exist only because somebody looked at the pricing page.
 *
 * The id is written back immediately so a retry after a network failure finds
 * the existing customer rather than making a second one — duplicate customers
 * are the classic way a user's invoice history ends up split in half.
 */
async function customerIdFor(user: {
  id: string;
  email: string;
  name: string | null;
}): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { id: user.id },
    select: { stripeCustomerId: true },
  });

  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const customer = await stripe.customers.create(
    {
      email: user.email,
      name: user.name ?? undefined,
      // Our id on their object, so a Stripe-side investigation can be traced
      // back without a database query.
      metadata: { userId: user.id },
    },
    // Stripe-level idempotency as well as our own: a retry of this exact call
    // returns the first customer instead of creating a second.
    { idempotencyKey: `customer:${user.id}` },
  );

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

function absoluteUrl(path: string): string {
  return new URL(path, env.NEXT_PUBLIC_APP_URL).toString();
}

/**
 * Start a subscription checkout.
 *
 * If the user already has an active subscription this is a **plan change**, not
 * a checkout — Stripe would otherwise create a second subscription and bill for
 * both. `changePlan` handles that case, and this function refuses rather than
 * quietly doing something expensive.
 */
export async function createSubscriptionCheckout(input: {
  tier: PlanTier;
  interval: BillingInterval;
}): Promise<{ url: string }> {
  // Authentication first. `requireBillingConfigured` names the missing
  // environment variables, and a stranger has no business learning which parts
  // of our deployment are incomplete.
  const user = await requireApiUser();
  requireBillingConfigured();

  if (input.tier === "FREE") {
    throw new BillingError(
      "The free plan is what you get without a subscription — there is nothing to buy.",
      400,
      "not_purchasable",
    );
  }

  const priceId = priceIdFor(input.tier, input.interval);
  if (!priceId) {
    throw new BillingError(
      `No Stripe price is configured for ${planFor(input.tier).name} ${input.interval === "YEAR" ? "yearly" : "monthly"}.`,
      503,
      "price_unconfigured",
    );
  }

  const entitlement = await getEntitlement(user.id);
  if (entitlement.active && entitlement.stripeSubscriptionId) {
    throw new BillingError(
      "You already have a subscription. Change your plan instead.",
      409,
      "already_subscribed",
    );
  }

  const customerId = await customerIdFor(user);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: absoluteUrl("/settings/billing?checkout=success"),
    cancel_url: absoluteUrl("/settings/billing?checkout=cancelled"),
    // Carried onto the subscription so the webhook can attribute it even if
    // the customer lookup somehow fails.
    subscription_data: { metadata: { userId: user.id } },
    metadata: { userId: user.id, tier: input.tier },
    allow_promotion_codes: true,
    // Stripe collects and remits where it must. Getting tax wrong is a legal
    // problem, not a product one, and this is not the place to hand-roll it.
    automatic_tax: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
  });

  if (!session.url) {
    throw new BillingError("Stripe did not return a checkout URL.", 502);
  }

  return { url: session.url };
}

/**
 * Start a one-off credit pack checkout.
 *
 * `payment` mode, not `subscription`. A pack is a purchase, and modelling it as
 * a subscription would mean cancelling something the user never agreed to
 * renew.
 */
export async function createPackCheckout(
  packId: string,
): Promise<{ url: string }> {
  // Authentication first. `requireBillingConfigured` names the missing
  // environment variables, and a stranger has no business learning which parts
  // of our deployment are incomplete.
  const user = await requireApiUser();
  requireBillingConfigured();

  const pack = packFor(packId);
  if (!pack) {
    throw new BillingError(
      "That credit pack does not exist.",
      404,
      "not_found",
    );
  }
  if (!pack.priceId) {
    throw new BillingError(
      `No Stripe price is configured for the ${pack.name} pack.`,
      503,
      "price_unconfigured",
    );
  }

  const customerId = await customerIdFor(user);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: pack.priceId, quantity: 1 }],
    success_url: absoluteUrl("/settings/billing?purchase=success"),
    cancel_url: absoluteUrl("/settings/billing?purchase=cancelled"),
    // How many credits to grant, decided here and read by the webhook. The
    // webhook re-reads the pack from the catalogue rather than trusting this
    // number — metadata is ours, but it round-trips through a third party.
    metadata: { userId: user.id, packId: pack.id },
    automatic_tax: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    // A receipt is not optional for a one-off charge.
    invoice_creation: { enabled: true },
  });

  if (!session.url) {
    throw new BillingError("Stripe did not return a checkout URL.", 502);
  }

  return { url: session.url };
}

/**
 * Change plan on an existing subscription.
 *
 * ## Upgrades take effect now; downgrades take effect at the period end
 *
 * This asymmetry is deliberate and it is the whole design of these two flows.
 *
 * An **upgrade** is someone who wants more capacity, usually right now.
 * `proration_behavior: "always_invoice"` charges the difference for the
 * remainder of the period immediately, and the higher allowance is granted by
 * the invoice webhook that follows. Making them wait until next month for
 * something they just paid for would be absurd.
 *
 * A **downgrade** must not remove what has already been paid for. Applying it
 * immediately with a proration credit sounds fair and is not: the user loses
 * access mid-period in exchange for a credit against a future invoice they may
 * never receive. So the change is scheduled at the period end, the user keeps
 * everything until then, and `scheduledTier` records the pending change so the
 * interface can say what will happen and offer to undo it.
 */
export async function changePlan(input: {
  tier: PlanTier;
  interval: BillingInterval;
}): Promise<{ effective: "now" | "period_end"; tier: PlanTier }> {
  // Authentication first. `requireBillingConfigured` names the missing
  // environment variables, and a stranger has no business learning which parts
  // of our deployment are incomplete.
  const user = await requireApiUser();
  requireBillingConfigured();

  const entitlement = await getEntitlement(user.id);
  if (!entitlement.stripeSubscriptionId) {
    throw new BillingError(
      "You do not have a subscription to change.",
      409,
      "no_subscription",
    );
  }

  if (input.tier === "FREE") {
    return cancelSubscription();
  }

  const priceId = priceIdFor(input.tier, input.interval);
  if (!priceId) {
    throw new BillingError(
      `No Stripe price is configured for ${planFor(input.tier).name}.`,
      503,
      "price_unconfigured",
    );
  }

  const subscription = await stripe.subscriptions.retrieve(
    entitlement.stripeSubscriptionId,
  );
  const item = subscription.items.data[0];
  if (!item) {
    throw new BillingError("That subscription has no items.", 502);
  }

  if (item.price.id === priceId) {
    throw new BillingError("You are already on that plan.", 409, "no_change");
  }

  const upgrading = isUpgrade(entitlement.tier, input.tier);

  if (upgrading) {
    await stripe.subscriptions.update(entitlement.stripeSubscriptionId, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: "always_invoice",
      // Any pending downgrade is superseded — you cannot be scheduled to drop
      // to Studio while upgrading to Scale.
      cancel_at_period_end: false,
      metadata: { userId: user.id },
    });

    await setScheduledTier(user.id, null);
    return { effective: "now", tier: input.tier };
  }

  // Downgrade: change the price at the renewal, charge nothing now, and issue
  // no proration credit — the user keeps the period they paid for in full.
  await stripe.subscriptions.update(entitlement.stripeSubscriptionId, {
    items: [{ id: item.id, price: priceId }],
    proration_behavior: "none",
    billing_cycle_anchor: "unchanged",
    cancel_at_period_end: false,
    metadata: { userId: user.id },
  });

  await setScheduledTier(user.id, input.tier);
  return { effective: "period_end", tier: input.tier };
}

/**
 * Cancel — the downgrade to free.
 *
 * At the period end, for the same reason as any other downgrade. `cancel_now`
 * is deliberately not offered: it would end access to something already paid
 * for, and every support request that follows would be asking us to undo it.
 */
export async function cancelSubscription(): Promise<{
  effective: "period_end";
  tier: PlanTier;
}> {
  // Authentication first. `requireBillingConfigured` names the missing
  // environment variables, and a stranger has no business learning which parts
  // of our deployment are incomplete.
  const user = await requireApiUser();
  requireBillingConfigured();

  const entitlement = await getEntitlement(user.id);
  if (!entitlement.stripeSubscriptionId) {
    throw new BillingError(
      "You do not have a subscription to cancel.",
      409,
      "no_subscription",
    );
  }

  await stripe.subscriptions.update(entitlement.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  await setScheduledTier(user.id, "FREE");
  return { effective: "period_end", tier: "FREE" };
}

/** Undo a pending cancellation, while the subscription is still running. */
export async function resumeSubscription(): Promise<void> {
  // Authentication first. `requireBillingConfigured` names the missing
  // environment variables, and a stranger has no business learning which parts
  // of our deployment are incomplete.
  const user = await requireApiUser();
  requireBillingConfigured();

  const entitlement = await getEntitlement(user.id);
  if (!entitlement.stripeSubscriptionId) {
    throw new BillingError(
      "You do not have a subscription to resume.",
      409,
      "no_subscription",
    );
  }

  await stripe.subscriptions.update(entitlement.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });

  await setScheduledTier(user.id, null);
}

/**
 * The Stripe billing portal.
 *
 * Card updates, tax ids, invoice history and payment methods, hosted by Stripe.
 * Rebuilding those means handling card tokenisation, SCA re-authentication and
 * dunning — weeks of work with a compliance surface, to produce something worse
 * than the page Stripe maintains.
 *
 * Plan changes are ours rather than the portal's, because the upgrade and
 * downgrade semantics above are a product decision the portal has no way to
 * express.
 */
export async function createPortalSession(): Promise<{ url: string }> {
  // Authentication first. `requireBillingConfigured` names the missing
  // environment variables, and a stranger has no business learning which parts
  // of our deployment are incomplete.
  const user = await requireApiUser();
  requireBillingConfigured();

  const entitlement = await getEntitlement(user.id);
  const customerId = entitlement.stripeCustomerId;

  if (!customerId) {
    throw new BillingError(
      "There is nothing to manage yet — you have not made a purchase.",
      409,
      "no_customer",
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: absoluteUrl("/settings/billing"),
  });

  return { url: session.url };
}
