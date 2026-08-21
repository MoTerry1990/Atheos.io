"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { BillingScreen } from "@/features/billing/components/billing-screen";
import { BillingApiProvider } from "@/features/billing/lib/api-context";
import {
  createFixtureApi,
  type Scenario,
} from "@/app/(dev)/billing-preview/fixtures";

/**
 * Billing preview.
 *
 * The production `BillingScreen`, wired to an in-memory backend. Same pattern
 * as the studio and projects previews, and the most necessary of the three:
 * billing has five states that matter and four of them are unreachable without
 * a Stripe account, a paid subscription and a failed payment.
 *
 * Switching scenario remounts the screen with a fresh fixture, so each one
 * starts from a clean state rather than inheriting the last scenario's edits.
 *
 * `noindex` via the `(dev)` layout, and excluded from Clerk's middleware
 * matcher so the development handshake does not intercept it.
 */

const SCENARIOS: { id: Scenario; label: string; hint: string }[] = [
  { id: "free", label: "Free", hint: "No subscription" },
  { id: "subscribed", label: "Subscribed", hint: "Studio, active" },
  { id: "past_due", label: "Past due", hint: "Payment failed, still entitled" },
  { id: "cancelling", label: "Cancelling", hint: "Ends at the period end" },
  { id: "unconfigured", label: "No Stripe", hint: "Nothing purchasable" },
  {
    id: "complimentary",
    label: "Owner",
    hint: "Studio access, Creator billed",
  },
];

export default function BillingPreviewPage() {
  const [scenario, setScenario] = useState<Scenario>("subscribed");

  // Seeded with a timestamp captured in state rather than read during render —
  // `Date.now()` in a render body differs between the server and client passes,
  // which is a hydration mismatch.
  const [now] = useState(() => Date.now());
  const api = useMemo(() => createFixtureApi(now, scenario), [now, scenario]);

  return (
    <div className="min-h-dvh">
      <div className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs">
        <p>
          <span className="font-medium">Preview route.</span>{" "}
          <span className="text-muted-foreground">
            Fixtures in memory — no Stripe account, so checkout refuses rather
            than pretending.
          </span>
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          {SCENARIOS.map((entry) => (
            <Button
              key={entry.id}
              size="xs"
              variant={scenario === entry.id ? "secondary" : "ghost"}
              onClick={() => setScenario(entry.id)}
              title={entry.hint}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </div>

      <Container size="lg" className="py-8">
        <PageHeader
          title="Billing"
          description="Your plan, credits and what you have spent them on."
        />
        <div className="mt-2">
          {/* Keyed so a scenario change remounts rather than merging state. */}
          <BillingApiProvider value={api}>
            <BillingScreen key={scenario} />
          </BillingApiProvider>
        </div>
      </Container>
    </div>
  );
}
