import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Reveal, Section } from "@/features/marketing/components/section";

/**
 * The enterprise track.
 *
 * ## Why this has no price
 *
 * Not as a negotiating tactic. The things that make a plan "enterprise" —
 * team seats, SSO, an invoice instead of a card, a signed DPA, a support
 * commitment with hours attached — are **not built**. Printing $199 next to a
 * list of them would be selling a plan that cannot be delivered.
 *
 * A conversation is the honest shape while that is true. It is also the more
 * useful one: the first few people who ask will describe what they actually
 * need, which is better information than a guess at what a tier should contain.
 *
 * When those capabilities exist this becomes a priced tier like the others.
 */

const NEEDS = [
  "More than 3,000 generations a month",
  "Several people working from one balance",
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
                Running this at volume, or with a team?
              </h2>

              <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
                Studio covers one person publishing daily. Past that — several
                people on one balance, procurement, or a model we do not offer
                yet — the right plan depends on what you are actually doing, so
                we would rather ask than guess.
              </p>

              <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
                Tell us the volume and the constraints and we will tell you what
                it costs, or say plainly if we are not the right fit yet.
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
