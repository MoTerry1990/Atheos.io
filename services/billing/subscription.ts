import "server-only";

import type Stripe from "stripe";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { resolvePriceId } from "@/services/billing/plans";
import type {
  BillingInterval,
  PlanTier,
  Role,
  SubscriptionStatus,
} from "@/lib/generated/prisma/enums";

/**
 * The subscription mirror.
 *
 * **Stripe is the source of truth.** Our row is a cache that exists so an
 * entitlement check is a database read rather than a network call to a third
 * party on every page load. When the two disagree, Stripe is right and our row
 * is stale — never resolve a conflict the other way. That rule was written into
 * `lib/stripe.ts` in Sprint 0 and this file is where it is actually enforced.
 *
 * Everything here is driven by webhooks. Nothing writes a subscription row from
 * a user action, because a user action can succeed while the payment behind it
 * has not settled, and the gap between the two is where free access lives.
 */

/** Stripe's status strings to ours. */
const STATUS_MAP: Record<string, SubscriptionStatus> = {
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  canceled: "CANCELED",
  incomplete: "INCOMPLETE",
  incomplete_expired: "INCOMPLETE_EXPIRED",
  unpaid: "UNPAID",
  paused: "PAUSED",
};

/** Statuses that entitle the user to their plan. */
const ENTITLED: ReadonlySet<SubscriptionStatus> = new Set([
  "TRIALING",
  "ACTIVE",
  // Past due is deliberately included. Stripe retries a failed payment for
  // days; cutting access off at the first failure punishes an expired card as
  // harshly as a refusal to pay, and the recovery rate on those retries is
  // high. `UNPAID` — after every retry has failed — is where access stops.
  "PAST_DUE",
]);

export interface Entitlement {
  tier: PlanTier;
  interval: BillingInterval;
  status: SubscriptionStatus | null;
  /** Whether the plan's features are currently available. */
  active: boolean;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  /** A downgrade waiting for the period to end, if any. */
  scheduledTier: PlanTier | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

/**
 * What an owner account gets.
 *
 * The top tier, so that any capability gated on rank is open. It carries no
 * credits of its own — see the note in `getEntitlement`; credits are a
 * separate ledger and are granted, not implied by a tier.
 */
const OWNER_TIER: PlanTier = "STUDIO";

/**
 * Whether this account belongs to whoever runs the install.
 *
 * Same two sources of truth as admin access, and for the same reason:
 * `ADMIN_USER_IDS` cannot be changed by anyone who only has the database, and
 * the role column is the recovery path when the environment list is wrong. See
 * `services/admin/auth.ts`.
 *
 * Takes the row rather than reading the session, because this is asked about
 * arbitrary users — an admin looking at somebody else's billing must see
 * *their* entitlement, not the viewer's.
 */
function isOwnerAccount(user: { clerkId: string; role: Role }): boolean {
  if (user.role === "ADMIN") return true;

  return (env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(user.clerkId);
}

/**
 * What this user is entitled to right now.
 *
 * Falls back to FREE rather than throwing when there is no subscription: not
 * having paid is a normal state, and every caller would otherwise have to
 * handle null in the same way.
 */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  const [subscription, user] = await Promise.all([
    prisma.subscription.findUnique({
      where: { userId },
      select: {
        planTier: true,
        interval: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        scheduledTier: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true, clerkId: true, role: true },
    }),
  ]);

  // The people who run Atheos are entitled to the whole product, without a
  // Stripe subscription standing behind it. Checked before the subscription
  // row is read, so it holds whether or not one exists.
  //
  // Deliberately **not** implemented by writing a fake Subscription: that row
  // requires a unique `stripeCustomerId`, and inventing one means the real
  // checkout later collides with a placeholder — a billing bug found at the
  // worst moment. Entitlement is a question about a person, and this is the
  // one function that answers it, so this is where the exception belongs.
  if (user && isOwnerAccount(user)) {
    return {
      tier: OWNER_TIER,
      interval: "MONTH",
      status: subscription?.status ?? null,
      active: true,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      scheduledTier: null,
      stripeCustomerId:
        subscription?.stripeCustomerId ?? user.stripeCustomerId ?? null,
      stripeSubscriptionId: subscription?.stripeSubscriptionId ?? null,
    };
  }

  if (!subscription) {
    return {
      tier: "FREE",
      interval: "MONTH",
      status: null,
      active: false,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      scheduledTier: null,
      stripeCustomerId: user?.stripeCustomerId ?? null,
      stripeSubscriptionId: null,
    };
  }

  const active = ENTITLED.has(subscription.status);

  return {
    // A lapsed subscription does not keep its tier. The row still records what
    // it *was*, which is useful for support; entitlement is what it is now.
    tier: active ? subscription.planTier : "FREE",
    interval: subscription.interval,
    status: subscription.status,
    active,
    currentPeriodStart: subscription.currentPeriodStart?.getTime() ?? null,
    currentPeriodEnd: subscription.currentPeriodEnd?.getTime() ?? null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    scheduledTier: subscription.scheduledTier,
    stripeCustomerId:
      subscription.stripeCustomerId ?? user?.stripeCustomerId ?? null,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
  };
}

/**
 * Write a Stripe subscription into our mirror.
 *
 * Called from the webhook for every subscription event. An upsert rather than
 * an update: Stripe events can arrive out of order, and
 * `customer.subscription.updated` landing before `.created` must not fail.
 *
 * `planTier` is resolved from the price id **here**, on the way in, and stored.
 * Resolving it on read would make every entitlement check depend on an
 * environment variable being set — so a deploy missing one price id would
 * silently downgrade every customer on that plan.
 */
export async function syncSubscription(
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { stripeCustomerId: customerId },
        { subscription: { stripeCustomerId: customerId } },
      ],
    },
    select: { id: true },
  });

  if (!user) {
    // Loud, because it means a payment exists that we cannot attribute. It is
    // also retryable: returning a non-2xx makes Stripe redeliver, and the user
    // row may simply not have been created by Clerk's webhook yet.
    throw new Error(`No user for Stripe customer ${customerId}`);
  }

  const item = subscription.items.data[0];
  const priceId = item?.price.id ?? null;
  const resolved = resolvePriceId(priceId);

  const periodStart = item?.current_period_start ?? null;
  const periodEnd = item?.current_period_end ?? null;

  const data = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    stripeProductId:
      typeof item?.price.product === "string" ? item.price.product : null,
    // An unrecognised price id keeps the tier rather than resetting it to
    // FREE. That happens when a price is added in Stripe before the deploy
    // that knows about it, and silently downgrading a paying customer over a
    // deployment ordering detail is not acceptable.
    ...(resolved
      ? { planTier: resolved.tier, interval: resolved.interval }
      : {}),
    status: STATUS_MAP[subscription.status] ?? "INCOMPLETE",
    currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000)
      : null,
    // Whatever downgrade was pending has now been applied or abandoned — this
    // event *is* the change landing.
    scheduledTier: null,
  };

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId },
    }),
    prisma.subscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    }),
  ]);
}

/** Record a downgrade that Stripe will apply when the paid period ends. */
export async function setScheduledTier(
  userId: string,
  tier: PlanTier | null,
): Promise<void> {
  await prisma.subscription.update({
    where: { userId },
    data: { scheduledTier: tier },
  });
}
