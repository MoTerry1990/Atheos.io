import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Reveal, Section } from "@/features/marketing/components/section";

/**
 * The enterprise track.
 *
 * ## Why this has no price, when Agency does
 *
 * Agency is a **volume** tier: 20,000 credits a month, at a price, on a card.
 * Every line on it is a capability the product has today, so it can be bought
 * without a conversation.
 *
 * This is the other thing people mean by "enterprise", and it is not volume —
 * team seats, SSO, an invoice instead of a card, a signed DPA, a support
 * commitment with hours attached. Those are **not built**. Printing a price
 * beside a list of them would be selling a plan that cannot be delivered.
 *
 * A conversation is the honest shape while that is true. It is also the more
 * useful one: the first few people who ask will describe what they actually
 * need, which is better information than a guess at what a tier should contain.
 *
 * When those capabilities exist this becomes a priced tier like the others.
 */

const NEEDS = [
  "More than 20,000 credits a month",
  "Several people working from one balance",
  "Single sign-on for your team",
  "Invoicing rather than a card on file",
  "A data-processing agreement",
  "A specific model, or your own provider keys",
  "Support with a response time attached",
] as const;

export function EnterpriseCard() {
  return (
    <Section id="enterprise">
      <Reveal>
        <div className="mx-auto max-w-4xl rounded-2xl border border-border bg-card p-8 sm:p-10">
          <div className="grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-start">
            <div>
              <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Business and enterprise
              </p>

              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                Need seats, SSO or an invoice?
              </h2>

              <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
                Agency covers the volume — 20,000 credits a month, on a card, no
                conversation required. What it does not cover is the other half
                of an enterprise purchase: several people on one balance, single
                sign-on, procurement, a model we do not offer yet.
              </p>

              <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
                Those are being built, and we would rather scope them against a
                real requirement than guess. Tell us the constraints and we will
                tell you what it costs and when — or say plainly if we are not
                the right fit yet.
              </p>

              <Button asChild size="lg" className="mt-6">
                <a href="mailto:hello@atheos.io?subject=Atheos%20for%20teams">
                  Talk to us
                  <ArrowUpRight />
                </a>
              </Button>
            </div>

            <div className="rounded-xl border border-border bg-surface-sunken p-5">
              <p className="text-sm font-medium">Worth a conversation if</p>
              <ul className="mt-3 space-y-2.5">
                {NEEDS.map((need) => (
                  <li
                    key={need}
                    className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground"
                  >
                    <span
                      aria-hidden
                      className="mt-2 size-1 shrink-0 rounded-full bg-primary"
                    />
                    {need}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
