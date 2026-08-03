import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";

import { listCreditHistory } from "@/services/billing/credits";
import {
  CREDIT_PACKS,
  PLANS,
  billingConfigurationProblems,
  isBillingConfigured,
} from "@/services/billing/plans";
import {
  getUsage,
  listInvoices,
  usagePeriodFor,
} from "@/services/billing/reporting";
import { getEntitlement } from "@/services/billing/subscription";

/**
 * Everything the billing page needs, in one request.
 *
 * Plan, credits, usage, invoices and history are shown together on one screen
 * and none of them is useful alone. Five endpoints would mean five round trips,
 * five loading states, and a window where the plan card and the usage bar
 * disagree about which period they are describing.
 *
 * The invoice call is the slow one — it goes to Stripe — so it runs in parallel
 * with the local queries rather than after them.
 *
 * ## Configuration is reported, not hidden
 *
 * `configured: false` with the list of missing variables. The interface uses it
 * to explain why there is no upgrade button instead of rendering one that fails
 * on click, and the list makes the fix obvious to whoever is deploying.
 */
export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "read",
    context: "GET /api/billing",
  });
  if (gate instanceof NextResponse) return gate;
  const user = gate.user!;

  try {
    const entitlement = await getEntitlement(user.id);
    const period = usagePeriodFor(entitlement);

    const [usage, invoices, history] = await Promise.all([
      getUsage(user.id, period),
      // Never fatal. Stripe being slow or down must not stop somebody seeing
      // their credit balance and what they spent it on.
      listInvoices(entitlement.stripeCustomerId).catch((error) => {
        console.error("Could not load invoices", error);
        return null;
      }),
      listCreditHistory(user.id, { limit: 40 }),
    ]);

    return NextResponse.json({
      configured: isBillingConfigured(),
      problems: isBillingConfigured() ? [] : billingConfigurationProblems(),
      creditBalance: user.creditBalance,
      entitlement,
      plans: PLANS,
      packs: CREDIT_PACKS,
      usage,
      // Null means "we could not reach Stripe", which is different from an
      // empty list meaning "you have no invoices". The interface says so.
      invoices,
      history,
    });
  } catch (error) {
    console.error("billing summary failed", error);
    return NextResponse.json(
      { error: "Could not load your billing details." },
      { status: 500 },
    );
  }
}
