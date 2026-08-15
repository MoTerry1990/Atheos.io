"use client";

import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PRICING } from "@/features/marketing/content";
import { useCopy } from "@/features/marketing/i18n";
import { formatMoney } from "@/services/billing/catalogue";
import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";
import { cn } from "@/lib/utils";

/**
 * Pricing.
 *
 * ## Monthly only — Sprint 4
 *
 * The annual toggle is gone. Annual billing collects a year of money against
 * provider costs that have not been measured yet, which is the wrong direction
 * to be wrong in for a self-funded business: a mispriced monthly plan is
 * corrected next month, and a mispriced annual plan is a year of it plus the
 * refunds.
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
  const { pricing, plans } = useCopy();

  return (
    <Section id="pricing">
      <SectionHeading
        eyebrow={pricing.eyebrow}
        title={pricing.title}
        description={pricing.description}
      />

      <div className="mt-12 grid items-start gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {PRICING.map((tier, index) => {
          const price = tier.monthly;
          // A plan whose credit allowance is still being measured. Priced and
          // described honestly; not buyable, and saying so on the button.
          const pending = tier.status === "launch_disabled";
          // Names, blurbs and bullets are translated; every number comes from
          // the billing catalogue, which has exactly one version.
          const plan = plans[tier.tier];

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
                      {pricing.mostPopular}
                    </Badge>
                  </>
                ) : null}

                <div className="relative flex h-full flex-col">
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {plan.description}
                  </p>

                  <div className="mt-6 flex items-baseline gap-1">
                    <span className="text-4xl font-semibold tracking-tight tabular-nums">
                      {formatMoney(price)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {price === 0 ? pricing.forever : pricing.perMonth}
                    </span>
                  </div>

                  {/* The credit line, or an honest substitute for it.
                      `tier.credits` is null while a plan's provider costs are
                      still being measured — printing a guess here is the one
                      thing a pricing page must never do, because a credit count
                      on this card is what a customer will count against later. */}
                  <p className="mt-1.5 text-xs font-medium text-primary">
                    {/* The Free grant is one-time; every paid allowance is
                        still unverified and prints no number at all. There is
                        no case here that says "credits monthly" — that was the
                        promise the product withdrew. */}
                    {tier.credits
                      ? price === 0
                        ? pricing.creditsOneTime(tier.credits)
                        : pricing.creditsMonthly(tier.credits)
                      : pricing.creditsPending}
                  </p>

                  {/* Straight to sign-up, carrying the chosen plan.
                      `redirect_url` is what Clerk uses after authentication, so
                      somebody who picks Studio here lands on billing with
                      Studio selected rather than on a dashboard, having to find
                      the plan they already chose. The free tier needs no plan
                      at all — signing up *is* the free tier. */}
                  <Button
                    variant={tier.featured && !pending ? "gradient" : "outline"}
                    size="lg"
                    block
                    className="mt-6"
                    asChild
                  >
                    <a
                      href={
                        price === 0
                          ? "/sign-up"
                          : `/sign-up?redirect_url=${encodeURIComponent(
                              `/settings/billing?plan=${tier.id}`,
                            )}`
                      }
                    >
                      {price === 0
                        ? pricing.ctaFree
                        : pending
                          ? pricing.ctaPending
                          : pricing.ctaChoose(plan.name)}
                    </a>
                  </Button>

                  <ul className="mt-8 space-y-3">
                    {plan.features.map((feature) => (
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
          {pricing.note}
        </p>
      </Reveal>
    </Section>
  );
}
