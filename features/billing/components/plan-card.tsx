"use client";

import { ArrowDown, ArrowUp, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, rankOf } from "@/services/billing/catalogue";
import type { BillingInterval, PlanTier } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * One plan, on the billing screen.
 *
 * ## The button says what will happen, not "Choose"
 *
 * Upgrade, Downgrade, Current plan, or Resume. The difference matters because
 * the *consequences* differ — an upgrade is charged now, a downgrade takes
 * effect at the period end — and a row of identical "Choose" buttons hides
 * exactly the thing the user is trying to decide.
 *
 * ## Yearly shows the monthly-equivalent price
 *
 * Because that is the comparison people actually make, and quoting the annual
 * total beside a monthly one is the oldest trick in pricing-page design. The
 * saving is stated separately rather than folded into a number.
 */
export function PlanCard({
  plan,
  interval: _interval,
  currentTier,
  scheduledTier,
  cancelAtPeriodEnd,
  highlighted,
  disabled,
  pending,
  onSelect,
}: {
  plan: {
    tier: PlanTier;
    name: string;
    description: string;
    monthly: number;
    monthlyCredits: number | null;
    features: readonly string[];
    featured?: boolean;
  };
  interval: BillingInterval;
  currentTier: PlanTier;
  scheduledTier: PlanTier | null;
  cancelAtPeriodEnd: boolean;
  /** Chosen on the pricing page before signing up. */
  highlighted?: boolean;
  disabled?: boolean;
  pending?: boolean;
  onSelect: (tier: PlanTier) => void;
}) {
  const isCurrent = plan.tier === currentTier;
  const isScheduled = scheduledTier === plan.tier;
  // Monthly only since Sprint 4. `_interval` is still accepted because a
  // pre-existing yearly subscription must still render a card, and it renders
  // at the monthly rate rather than at a price that no longer exists. The
  // parameter is kept rather than removed so the call sites do not have to
  // change back when annual billing is reconsidered.
  const amount = plan.monthly;

  const direction =
    rankOf(plan.tier) > rankOf(currentTier)
      ? "up"
      : rankOf(plan.tier) < rankOf(currentTier)
        ? "down"
        : "same";

  const label = isCurrent
    ? cancelAtPeriodEnd
      ? "Ending soon"
      : "Current plan"
    : direction === "up"
      ? `Upgrade to ${plan.name}`
      : plan.tier === "FREE"
        ? "Cancel subscription"
        : `Downgrade to ${plan.name}`;

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border p-5",
        plan.featured ? "border-primary/40 bg-primary/[0.03]" : "border-border",
        isCurrent && "ring-2 ring-primary/40",
        highlighted && !isCurrent && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{plan.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {plan.description}
          </p>
        </div>
        {isCurrent ? (
          <Badge variant="success" size="sm">
            Current
          </Badge>
        ) : isScheduled ? (
          <Badge variant="warning" size="sm">
            Scheduled
          </Badge>
        ) : plan.featured ? (
          <Badge variant="brand" size="sm">
            Popular
          </Badge>
        ) : null}
      </div>

      <p className="mt-4 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {amount === 0 ? "Free" : formatMoney(amount)}
        </span>
        {amount > 0 ? (
          <span className="text-xs text-muted-foreground">/month</span>
        ) : null}
      </p>

      {/* A null allowance is a plan whose provider costs are still being
          measured. It says so rather than printing a guess — see
          `services/billing/catalogue.ts`. */}
      <p className="mt-3 text-xs font-medium tabular-nums">
        {plan.monthlyCredits === null
          ? "Credit allowance confirmed at launch"
          : plan.tier === "FREE"
            ? `${plan.monthlyCredits.toLocaleString("en-US")} credits, one time`
            : `${plan.monthlyCredits.toLocaleString("en-US")} credits monthly`}
      </p>

      <ul className="mt-4 flex-1 space-y-1.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-2 text-xs">
            <Check
              className="mt-0.5 size-3 shrink-0 text-success"
              aria-hidden
            />
            <span className="text-muted-foreground">{feature}</span>
          </li>
        ))}
      </ul>

      <Button
        className="mt-5"
        variant={
          isCurrent ? "outline" : plan.featured ? "gradient" : "secondary"
        }
        block
        disabled={disabled || (isCurrent && !cancelAtPeriodEnd)}
        loading={pending}
        onClick={() => onSelect(plan.tier)}
      >
        {direction === "up" ? <ArrowUp /> : null}
        {direction === "down" ? <ArrowDown /> : null}
        {label}
      </Button>

      {/* Said on the card, before the confirmation, because it is the fact
          that decides the choice. */}
      {!isCurrent && direction === "down" ? (
        <p className="mt-1.5 text-center text-2xs text-muted-foreground">
          Takes effect at the end of your paid period
        </p>
      ) : null}
      {!isCurrent && direction === "up" ? (
        <p className="mt-1.5 text-center text-2xs text-muted-foreground">
          Charged now, pro-rated for the rest of this period
        </p>
      ) : null}
    </div>
  );
}
