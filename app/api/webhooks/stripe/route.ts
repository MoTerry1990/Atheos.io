import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import type Stripe from "stripe";

import { env } from "@/lib/env";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { grantCredits } from "@/services/billing/credits";
import { planDispute, planRefund } from "@/services/billing/refunds";
import { packFor, planFor, resolvePriceId } from "@/services/billing/plans";
import { syncSubscription } from "@/services/billing/subscription";

/**
 * Stripe → database billing sync.
 *
 * **This is the only place credits are granted or plans are changed.** Nothing
 * in the checkout flow touches either, because reaching a success page is not
 * evidence that money moved: a card can be declined asynchronously, a 3-D
 * Secure challenge can be abandoned after the redirect, and the success URL is
 * a URL anyone can type. Granting on redirect is how a product gives itself
 * away.
 *
 * ## Verification is the authentication
 *
 * `constructEvent` checks the signature against `STRIPE_WEBHOOK_SECRET` over
 * the **raw body**. Without it this route is an unauthenticated "give me
 * credits" API. It is public in the middleware precisely *because* the
 * signature is the authentication — Stripe has no session to check.
 *
 * The body must be read as text, not JSON. Parsing and re-serialising changes
 * key order and whitespace, and the signature is over the exact bytes.
 *
 * ## Idempotency, in that order
 *
 * 1. Insert the event id into `webhook_events`. A duplicate hits the primary
 *    key and returns 200 without re-processing.
 * 2. Do the work.
 *
 * The reverse — process, then record — double-applies whenever the response is
 * lost in flight, which for a renewal means granting a month's credits twice.
 * Stripe retries for up to three days, so "the response was lost" is not
 * hypothetical.
 *
 * The credit grants carry their own `idempotencyKey` as well, derived from the
 * Stripe object rather than the event. Belt and braces, and they guard
 * different things: the event row stops the same *delivery* being processed
 * twice, the grant key stops the same *invoice* being paid out twice across
 * two different event types.
 *
 * ## Failure handling
 *
 * Signature failure → **400**; the request is not from Stripe and a retry will
 * not change that. Processing failure → **500** so Stripe redelivers, with the
 * event row rolled back so the retry is not rejected as a duplicate.
 */

/**
 * Events we act on. Anything else is acknowledged and ignored — Stripe sends a
 * great deal, and a 500 on an event we do not handle would put the endpoint
 * into a retry loop that eventually gets it disabled.
 */
const HANDLED = new Set<Stripe.Event.Type>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  // Sprint 6A. A refund that leaves paid access in place is a subscription
  // the customer no longer pays for; a dispute that does not is worse.
  "charge.refunded",
  "charge.dispute.created",
]);

export async function POST(request: NextRequest) {
  // Rate limited before the signature is verified.
  //
  // Verification is HMAC over the whole body — cheap, but not free, and an
  // unauthenticated endpoint whose URL is discoverable is exactly the shape an
  // attacker floods. `auth: "none"` because the signature *is* the
  // authentication; `csrf: false` because a webhook sender is not a browser and
  // sends no Origin, so the cross-origin check would reject every real call.
  //
  // Keyed by IP, which is the only identity available here. The limit is set
  // well above either provider's real delivery rate.
  const gate = await guard(request, {
    policy: "sensitive",
    auth: "none",
    csrf: false,
    context: "POST /api/webhooks/stripe",
  });
  if (gate instanceof NextResponse) return gate;

  if (!env.STRIPE_WEBHOOK_SECRET) {
    // Refuse rather than process unverified. An endpoint that accepts unsigned
    // billing events is worse than one that is down.
    console.error("Stripe webhook received but STRIPE_WEBHOOK_SECRET is unset");
    return NextResponse.json(
      { error: "Webhook verification is not configured." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  // Raw text. See above — the signature covers the exact bytes.
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed", error);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    return NextResponse.json({ received: true, handled: false });
  }

  try {
    await prisma.webhookEvent.create({
      data: {
        id: event.id,
        source: "stripe",
        eventType: event.type,
      },
    });
  } catch (error) {
    // **Only** a primary-key collision means "already processed".
    //
    // This was previously a bare `catch`, which treated every failure the same
    // way — including a dropped connection or an exhausted pool. That returned
    // 200, Stripe stopped retrying, and the grant was lost permanently and
    // silently. The one case that must never be swallowed was the one most
    // likely to happen under load.
    if (isUniqueViolation(error)) {
      // Genuinely already processed. 200 so Stripe stops retrying.
      return NextResponse.json({ received: true, duplicate: true });
    }

    console.error("Stripe webhook: could not claim event id", error);
    // 500 so Stripe retries. A retry is safe: nothing has been granted yet.
    return NextResponse.json(
      { error: "Could not record the event." },
      { status: 500 },
    );
  }

  try {
    await handle(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(`Stripe webhook ${event.type} (${event.id}) failed`, error);

    // Remove the marker so the retry is processed rather than rejected as a
    // duplicate. Without this, one transient database error means a renewal is
    // never granted and nothing ever tries again.
    await prisma.webhookEvent
      .delete({ where: { id: event.id } })
      .catch(() => undefined);

    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}

async function handle(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return onCheckoutCompleted(event.data.object);

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return syncSubscription(event.data.object);

    case "invoice.paid":
      return onInvoicePaid(event.data.object);

    case "invoice.payment_failed":
      return onPaymentFailed(event.data.object);

    case "charge.refunded":
      return onChargeRefunded(event.data.object);

    case "charge.dispute.created":
      return onDisputeCreated(event.data.object);

    default:
      return;
  }
}

/**
 * A completed checkout.
 *
 * Only credit packs are fulfilled here. A subscription checkout produces an
 * `invoice.paid` as well, and granting in both places would double the first
 * month — so subscriptions are handled there and only there.
 */
async function onCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode !== "payment") return;
  if (session.payment_status !== "paid") return;

  const userId = session.metadata?.userId;
  const packId = session.metadata?.packId;
  if (!userId || !packId) {
    throw new Error(`Checkout session ${session.id} is missing metadata`);
  }

  // Re-read from our catalogue rather than trusting a credit count carried in
  // metadata. Metadata is ours, but it has round-tripped through a third party
  // and comes back as part of an untrusted payload.
  const pack = packFor(packId);
  if (!pack) {
    throw new Error(
      `Checkout session ${session.id} names unknown pack ${packId}`,
    );
  }

  await grantCredits({
    userId,
    amount: pack.credits,
    reason: "PACK_PURCHASE",
    // Keyed on the session, so a redelivery of this event is a no-op while a
    // second genuine purchase of the same pack is not.
    idempotencyKey: `pack:${session.id}`,
    stripeReference:
      typeof session.invoice === "string"
        ? session.invoice
        : ((session.payment_intent as string | null) ?? session.id),
    metadata: { packId: pack.id, credits: pack.credits },
  });
}

/**
 * A paid invoice — the subscription allowance.
 *
 * Fires for the first payment and for every renewal, which is exactly the
 * cadence credits should be granted on. Keyed on the invoice id, so a
 * redelivery grants nothing and next month's invoice grants again.
 *
 * The subscription row is synced first: the allowance depends on the tier, and
 * on an upgrade the invoice can arrive before the subscription update.
 */
async function onInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = subscriptionIdOf(invoice);
  if (!subscriptionId) return; // A one-off invoice; the pack path handled it.

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await syncSubscription(subscription);

  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;

  const user = customerId
    ? await prisma.user.findFirst({
        where: {
          OR: [
            { stripeCustomerId: customerId },
            { subscription: { stripeCustomerId: customerId } },
          ],
        },
        select: { id: true },
      })
    : null;

  if (!user) {
    throw new Error(`No user for Stripe customer ${customerId}`);
  }

  // The tier is taken from the price on the subscription, not from our mirror,
  // so the grant matches what was actually billed even if the sync above wrote
  // something unexpected.
  const priceId = subscription.items.data[0]?.price.id;
  const resolved = resolvePriceId(priceId);
  if (!resolved) {
    throw new Error(
      `Invoice ${invoice.id} references unknown price ${priceId}`,
    );
  }

  const plan = planFor(resolved.tier);

  // A yearly subscription invoices once and is entitled to twelve months of
  // allowance. Granting one month would quietly sell them a twelfth of what
  // the pricing page promised. Annual billing is no longer offered, but a
  // historical yearly subscription would still invoice, so the arithmetic
  // stays.
  const months = resolved.interval === "YEAR" ? 12 : 1;

  /**
   * A null allowance means Sprint 4 has not settled this plan's credits yet.
   *
   * Refusing to grant is the safe direction: granting a guessed number gives
   * away inventory whose cost is unknown, and the customer can be topped up by
   * hand the moment the figure is confirmed. The reverse — clawing credits back
   * from somebody who has already spent them — is not recoverable.
   *
   * This cannot fire today: Stripe is not configured, so no invoice exists to
   * reach this line. It is the guard for the day one does.
   */
  if (plan.monthlyCredits === null) {
    console.error(
      `stripe webhook: invoice ${invoice.id} is on tier ${resolved.tier}, whose credit allowance is not yet set — no credits granted`,
    );
    return;
  }

  await grantCredits({
    userId: user.id,
    amount: plan.monthlyCredits * months,
    reason: "SUBSCRIPTION_GRANT",
    idempotencyKey: `invoice:${invoice.id}`,
    stripeReference: invoice.id,
    metadata: {
      tier: resolved.tier,
      interval: resolved.interval,
      months,
      monthlyCredits: plan.monthlyCredits,
      /**
       * The join key a refund will need.
       *
       * `charge.refunded` carries a payment intent and no invoice, so without
       * this a refund cannot tell which grant it should reverse — and reversing
       * the wrong one would take credits the customer paid for separately.
       */
      paymentIntentId: paymentIntentOf(invoice),
    },
  });
}

/**
 * A failed payment.
 *
 * Recorded, not punished. Stripe retries on its own schedule for days, and the
 * subscription moves to `past_due` — which `getEntitlement` deliberately still
 * treats as entitled, because an expired card is not a refusal to pay. Access
 * stops at `unpaid`, after every retry has failed, and Stripe drives that
 * transition itself.
 */
async function onPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = subscriptionIdOf(invoice);
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await syncSubscription(subscription);
}

/**
 * The subscription an invoice belongs to.
 *
 * Stripe moved this from `invoice.subscription` onto the line items' parent in
 * recent API versions, and the SDK's types follow the pinned version. Reading
 * it in one place keeps the version-specific shape out of the handlers.
 */
function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  if (parent?.type === "subscription_details") {
    const details = parent.subscription_details;
    const subscription = details?.subscription;
    if (typeof subscription === "string") return subscription;
    if (subscription && typeof subscription === "object")
      return subscription.id;
  }
  return null;
}

/**
 * A refunded charge.
 *
 * The money went back, so the access it bought stops now and the unused part of
 * the allowance it funded is removed. `planRefund` decides; this carries the
 * decision out, in one transaction.
 *
 * Keyed on `refund:{charge.id}`, so Stripe replaying the event — which it does,
 * on its own schedule, for days — collapses to one effect at the database's
 * unique index rather than at an `if` somebody has to remember to write.
 */
async function onChargeRefunded(charge: Stripe.Charge): Promise<void> {
  /**
   * The payment intent is the join key, not the invoice.
   *
   * `Charge.invoice` does not exist in the pinned API version — Stripe moved
   * the invoice's payment linkage onto `invoice.payments`. The payment intent
   * is the one identifier both a charge and an invoice still carry, so
   * `onInvoicePaid` records it on the grant and this reads it back. No extra
   * API call, and the correlation is exact rather than inferred from amounts.
   */
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;

  if (!paymentIntentId) {
    // Nothing to correlate against. A charge outside the subscription flow, or
    // a shape this code has not seen. A human decides rather than this guessing.
    await flagForReview(charge.customer, "refund.unlinkable", {
      chargeId: charge.id,
    });
    return;
  }

  const customerId = customerIdOf(charge.customer);
  const subscription = customerId
    ? await prisma.subscription.findFirst({
        where: { stripeCustomerId: customerId },
        select: { id: true, userId: true },
      })
    : null;

  if (!subscription) return;

  /**
   * The grant this invoice made, if it made one.
   *
   * Read by the same deterministic key `onInvoicePaid` writes, which is what
   * makes "only the credits from *this* invoice" a lookup rather than a guess.
   * A missing row means the invoice never granted — an unset allowance, or a
   * grant that failed — and the clawback is then zero.
   */
  const grant = await prisma.creditTransaction.findFirst({
    where: {
      reason: "SUBSCRIPTION_GRANT",
      metadata: { path: ["paymentIntentId"], equals: paymentIntentId },
    },
    select: { amount: true, stripeReference: true },
  });

  const [user, existingReversal] = await Promise.all([
    prisma.user.findUnique({
      where: { id: subscription.userId },
      select: { creditBalance: true },
    }),
    prisma.creditTransaction.findFirst({
      where: { idempotencyKey: `refund:${charge.id}` },
      select: { id: true },
    }),
  ]);

  if (!user) return;

  const plan = planRefund({
    refundedMinorUnits: charge.amount_refunded,
    invoiceMinorUnits: charge.amount,
    grantedCredits: grant?.amount ?? 0,
    currentBalance: user.creditBalance,
    alreadyReversed: Boolean(existingReversal),
  });

  if (plan.action === "already") return;

  if (plan.action === "manual_review") {
    await flagForReview(charge.customer, "refund.manual_review", {
      chargeId: charge.id,
      reason: plan.reason,
    });
    return;
  }

  /**
   * Entitlement and credits move together or not at all.
   *
   * A torn write here leaves either a refunded customer with full access, or
   * one whose credits vanished while they still appear subscribed. Both are
   * states somebody has to unpick by hand.
   */
  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "CANCELED",
        planTier: "FREE",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(),
      },
    });

    if (plan.clawback > 0) {
      const updated = await tx.user.update({
        where: { id: subscription.userId },
        data: { creditBalance: { decrement: plan.clawback } },
        select: { creditBalance: true },
      });

      await tx.creditTransaction.create({
        data: {
          userId: subscription.userId,
          amount: -plan.clawback,
          balanceAfter: updated.creditBalance,
          // There is no SUBSCRIPTION_REFUND reason in the enum and adding one
          // is a migration. The metadata carries the meaning until there is.
          reason: "MANUAL_ADJUSTMENT",
          idempotencyKey: `refund:${charge.id}`,
          stripeReference: charge.id,
          metadata: {
            kind: "subscription_refund",
            paymentIntentId,
            invoiceId: grant?.stripeReference ?? null,
            grantedCredits: grant?.amount ?? 0,
            clawback: plan.clawback,
            unrecoverable: plan.unrecoverable,
          },
        },
      });
    }
  });

  if (plan.flagForReview) {
    // Credits already spent. The work was delivered and the provider was paid
    // for it, so this is a real loss rather than a discrepancy.
    await flagForReview(charge.customer, "refund.credits_already_spent", {
      chargeId: charge.id,
      unrecoverable: plan.unrecoverable,
    });
  }
}

/**
 * A disputed charge.
 *
 * Access stops immediately; credits are untouched. A dispute is a claim, not a
 * verdict — the bank may find for the customer weeks later — and taking credits
 * from someone who turns out to have been right is not something a webhook
 * should decide on its own.
 */
async function onDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const charge = dispute.charge;
  const customerId =
    typeof charge === "string" ? null : customerIdOf(charge?.customer);

  const subscription = customerId
    ? await prisma.subscription.findFirst({
        where: { stripeCustomerId: customerId },
        select: { id: true },
      })
    : null;

  if (subscription) {
    const plan = planDispute();
    if (plan.suspendEntitlement) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: "UNPAID", planTier: "FREE" },
      });
    }
  }

  await flagForReview(customerId, "dispute.created", {
    disputeId: dispute.id,
    reason: dispute.reason,
  });
}

function customerIdOf(
  customer:
    string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

/**
 * Record that a human needs to look at this account.
 *
 * Written to the admin audit log rather than a new table: it is already where
 * staff look for "what happened to this account", and a second log is a second
 * place to forget to check. The actor is named as the system — attributing an
 * automatic action to a person would corrupt the one record that exists to say
 * who did what.
 *
 * Never throws. A flag that fails must not roll back a refund that succeeded.
 */
async function flagForReview(
  customer:
    string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    const customerId = customerIdOf(customer);
    await prisma.adminAuditLog.create({
      data: {
        actorId: "system",
        actorEmail: "system@atheos.io",
        action,
        subjectType: "stripe_customer",
        subjectId: customerId ?? "unknown",
        detail: details as never,
        reason: `Automatic: ${action}`,
      },
    });
  } catch (error) {
    console.error(`stripe webhook: could not flag ${action} for review`, error);
  }
}

/**
 * The payment intent behind an invoice.
 *
 * Recent API versions moved this from `invoice.payment_intent` into the
 * `payments` list, so it is read in one place rather than in every handler that
 * needs it. Returns null when the invoice has no recorded payment — a $0
 * invoice, or one settled out of band.
 */
function paymentIntentOf(invoice: Stripe.Invoice): string | null {
  const payment = invoice.payments?.data?.[0]?.payment;
  if (!payment) return null;

  const intent = payment.payment_intent;
  if (typeof intent === "string") return intent;
  return intent?.id ?? null;
}
