import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { BillingScreen } from "@/features/billing/components/billing-screen";

export const metadata: Metadata = { title: "Billing" };

/**
 * Billing.
 *
 * Its own route rather than a fifth tab in Settings. Stripe redirects back here
 * with `?checkout=success`, and a destination that only exists as tab state is
 * a destination that cannot be linked to — the user would land on Profile after
 * paying.
 *
 * The notice is derived from the query string here, on the server, rather than
 * with `useSearchParams` in the client component. That keeps the screen usable
 * outside a Suspense boundary and makes the preview route able to pass the same
 * prop directly.
 */
const TIERS = ["STARTER", "STUDIO", "SCALE"] as const;

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    checkout?: string;
    purchase?: string;
    plan?: string;
    interval?: string;
  }>;
}) {
  const params = await searchParams;

  const notice =
    params.checkout === "success"
      ? ("checkout-success" as const)
      : params.purchase === "success"
        ? ("purchase-success" as const)
        : params.checkout === "cancelled" || params.purchase === "cancelled"
          ? ("cancelled" as const)
          : null;

  // Carried from the pricing page through sign-up. Validated against the tier
  // list rather than passed through: it arrives from a URL, and a plan id from
  // a URL is not something to hand to a component as truth.
  const requested = params.plan?.toUpperCase();
  const highlight = TIERS.find((tier) => tier === requested) ?? null;
  const interval = params.interval === "YEAR" ? ("YEAR" as const) : null;

  return (
    <Container size="lg" className="py-8 sm:py-12">
      <PageHeader
        title="Billing"
        description="Your plan, credits and what you have spent them on."
      />

      <div className="mt-2">
        <BillingScreen
          initialNotice={notice}
          highlightTier={highlight}
          initialInterval={interval}
        />
      </div>
    </Container>
  );
}
