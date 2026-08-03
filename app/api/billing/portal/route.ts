import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";

import { BillingError, createPortalSession } from "@/services/billing/checkout";

/**
 * A link into Stripe's billing portal.
 *
 * Card details, tax ids, payment methods and receipts — all hosted by Stripe.
 * Rebuilding them would mean card tokenisation, SCA re-authentication and
 * dunning flows: weeks of work with a compliance surface, to produce something
 * worse than the page Stripe maintains for free.
 *
 * Plan changes stay ours (`PATCH /api/billing/subscription`), because the
 * upgrade-now / downgrade-at-period-end asymmetry is a product decision the
 * portal cannot express.
 *
 * POST because it creates a session, and because the returned URL is a
 * short-lived credential that should not sit in browser history.
 */
export async function POST(request: NextRequest) {
  const gate = await guard(request, {
    policy: "billing",
    context: "POST /api/billing/portal",
  });
  if (gate instanceof NextResponse) return gate;
  try {
    return NextResponse.json(await createPortalSession());
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("portal session failed", error);
    return NextResponse.json(
      { error: "Could not open the billing portal." },
      { status: 500 },
    );
  }
}
