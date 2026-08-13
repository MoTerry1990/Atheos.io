import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import {
  BillingError,
  cancelSubscription,
  changePlan,
  resumeSubscription,
} from "@/services/billing/checkout";
import { getCurrentUser } from "@/lib/auth";
import { getEntitlement } from "@/services/billing/subscription";

/**
 * Change an existing subscription.
 *
 *   change  upgrade or downgrade to another tier or interval
 *   cancel  downgrade to free at the end of the paid period
 *   resume  undo a pending cancellation
 *
 * One endpoint with an action, rather than three. They are the same resource in
 * the same state machine, and splitting them would repeat the authorisation and
 * the error mapping three times to express a verb.
 *
 * The response reports **when** the change takes effect, because the answer
 * differs — upgrades now, downgrades at the period end — and the interface has
 * to say which one just happened.
 */

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("change"),
    tier: z.enum(["STARTER", "BASIC", "STUDIO", "SCALE", "AGENCY"]),
    interval: z.enum(["MONTH", "YEAR"]).default("MONTH"),
  }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("resume") }),
]);

export async function PATCH(request: NextRequest) {
  const gate = await guard(request, {
    policy: "billing",
    body: schema,
    context: "PATCH /api/billing/subscription",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    if (gate.body.action === "resume") {
      await resumeSubscription();
    } else if (gate.body.action === "cancel") {
      await cancelSubscription();
    } else {
      await changePlan({
        tier: gate.body.tier,
        interval: gate.body.interval,
      });
    }

    // The entitlement is re-read from our mirror rather than returned from the
    // call above, so the client sees the same shape it gets from GET /billing.
    //
    // It may still say the *old* tier: Stripe confirms the change over a
    // webhook that has not necessarily arrived yet. That is why the response
    // carries `effective` — the interface reports what was requested and when
    // it lands, rather than pretending the row is already updated.
    const user = await getCurrentUser();
    const entitlement = user ? await getEntitlement(user.id) : null;

    return NextResponse.json({
      ok: true,
      effective:
        gate.body.action === "resume"
          ? "now"
          : gate.body.action === "cancel"
            ? "period_end"
            : undefined,
      entitlement,
    });
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("subscription change failed", error);
    return NextResponse.json(
      { error: "Could not change your plan. Please try again." },
      { status: 500 },
    );
  }
}
