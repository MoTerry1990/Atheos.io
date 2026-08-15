import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import type Stripe from "stripe";

import { env } from "@/lib/env";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { grantCredits } from "@/services/billing/credits";
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
