import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import {
  BillingError,
  createPackCheckout,
  createSubscriptionCheckout,
} from "@/services/billing/checkout";

/**
 * Start a purchase.
 *
 * Returns a URL rather than redirecting. A 303 from `fetch` is followed
 * transparently and the caller ends up with Stripe's HTML in a JSON parser;
 * handing back the URL lets the client navigate deliberately, and lets it show
 * an error in place when the request fails.
 *
 * **POST, not GET.** This creates a Stripe object and costs money to complete.
 * A GET would be prefetched by a link hover and crawled by anything that finds
 * the URL.
 */

const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("subscription"),
    tier: z.enum(["CREATOR", "PRO", "STUDIO"]),
    interval: z.enum(["MONTH", "YEAR"]),
  }),
  z.object({
    kind: z.literal("pack"),
    packId: z.string().min(1).max(64),
  }),
]);

export async function POST(request: NextRequest) {
  const gate = await guard(request, {
    policy: "billing",
    body: schema,
    context: "POST /api/billing/checkout",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const result =
      gate.body.kind === "subscription"
        ? await createSubscriptionCheckout({
            tier: gate.body.tier,
            interval: gate.body.interval,
          })
        : await createPackCheckout(gate.body.packId);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    // Stripe's own errors can carry request ids and account details. Logged,
    // never returned.
    console.error("checkout failed", error);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 },
    );
  }
}
