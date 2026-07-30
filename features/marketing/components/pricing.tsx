"use client";

import { motion } from "motion/react";
import { Check } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PRICING, PRICING_NOTE } from "@/features/marketing/content";
import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";
import { duration, easing } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

/**
 * Pricing.
 *
 * ## The billing toggle
 *
 * A two-state segmented control, not a switch. A switch implies on/off and
 * gives no affordance for reading the alternative before committing to it —
 * users have to flip it to find out what the other option costs. The sliding
 * `layoutId` pill is the same technique as the showcase tabs.
 *
 * ## The price
 *
 * `tabular-nums` so the digits do not jitter as the number changes width
 * between 24 and 19. Without it the whole card twitches on every toggle.
 *
 * The featured card is scaled up only at `lg` and above. On mobile every card
 * is full width, so scaling one just makes it overflow its neighbours.
 *
 * All CTAs point at the same early-access anchor: there is no checkout yet, and
 * a button that pretends to start one is worse than a button that is honest
 * about the beta.
 */
export function Pricing() {
  const [yearly, setYearly] = useState(false);

  return (
    <Section id="pricing">
      <SectionHeading
        eyebrow="Pricing"
        title="Pay for generations, not seats"
        description="One balance across every model and modality. No per-provider subscriptions to reconcile at the end of the month."
      />

      <Reveal delay={0.05} className="mt-10">
        <div
          role="radiogroup"
          aria-label="Billing period"
          className="mx-auto flex w-fit gap-1 rounded-full border border-border bg-surface-sunken p-1"
        >
          {[
            { id: "monthly", label: "Monthly", value: false },
            { id: "yearly", label: "Yearly", value: true },
          ].map((option) => {
            const selected = yearly === option.value;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setYearly(option.value)}
                className={cn(
                  "relative rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                  selected
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {selected ? (
                  <motion.span
                    layoutId="billing-pill"
                    className="absolute inset-0 rounded-full bg-card elevation-raised"
                    transition={{ duration: duration.normal, ease: easing.out }}
                  />
                ) : null}
                <span className="relative">{option.label}</span>
                {option.value ? (
                  <span className="relative ml-1.5 text-xs text-primary">
                    −20%
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </Reveal>

      <div className="mt-12 grid items-start gap-6 lg:grid-cols-3">
        {PRICING.map((tier, index) => {
          const price = yearly ? tier.yearly : tier.monthly;

          return (
            <Reveal
              key={tier.id}
              delay={Math.min(index * 0.07, 0.21)}
              className="h-full"
            >
              <div
                className={cn(
                  "relative flex h-full flex-col rounded-2xl border p-6 sm:p-8",
                  tier.featured
                    ? "border-primary/40 bg-card elevation-floating lg:scale-[1.03]"
                    : "border-border bg-card",
                )}
              >
                {tier.featured ? (
                  <>
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-brand-subtle"
                    />
                    <Badge
                      variant="gradient"
                      size="sm"
                      className="absolute -top-3 left-1/2 -translate-x-1/2"
                    >
                      Most popular
                    </Badge>
                  </>
                ) : null}

                <div className="relative flex h-full flex-col">
                  <h3 className="text-lg font-semibold">{tier.name}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {tier.description}
                  </p>

                  <div className="mt-6 flex items-baseline gap-1">
                    <span className="text-4xl font-semibold tracking-tight tabular-nums">
                      ${price}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {price === 0 ? "forever" : "/ month"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs font-medium text-primary">
                    {tier.credits}
                  </p>

                  <Button
                    variant={tier.featured ? "gradient" : "outline"}
                    size="lg"
                    block
                    className="mt-6"
                    asChild
                  >
                    <a href="#faq">{tier.cta}</a>
                  </Button>

                  <ul className="mt-8 space-y-3">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <Check
                          className="mt-0.5 size-4 shrink-0 text-primary"
                          strokeWidth={2.5}
                          aria-hidden
                        />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>

      <Reveal delay={0.1}>
        <p className="mx-auto mt-10 max-w-2xl text-center text-xs text-balance text-muted-foreground">
          {PRICING_NOTE}
        </p>
      </Reveal>
    </Section>
  );
}
