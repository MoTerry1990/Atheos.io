import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getCopy } from "@/features/marketing/i18n/dictionaries";
import type { Locale } from "@/features/marketing/i18n/locales";
import { Reveal, Section } from "@/features/marketing/components/section";

/**
 * The enterprise track.
 *
 * ## Why this has no price, when Studio does
 *
 * Studio is a **volume** tier: a price, on a card. Every line on it is a
 * capability the product has today, so it can be bought without a conversation.
 *
 * Neither this card nor the plan copy quotes a credit count any more. The paid
 * allowances are unset until the provider costs behind them are measured — see
 * `services/billing/plan-config.ts` — and a number here would be the same guess
 * the pricing card declines to print, wearing a different hat.
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

export function EnterpriseCard({ locale }: { locale: Locale }) {
  const { enterprise } = getCopy(locale);

  return (
    <Section id="enterprise">
      <Reveal>
        <div className="mx-auto max-w-4xl rounded-2xl border border-border bg-card p-8 sm:p-10">
          <div className="grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-start">
            <div>
              <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                {enterprise.eyebrow}
              </p>

              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                {enterprise.title}
              </h2>

              <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
                {enterprise.body[0]}
              </p>

              <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
                {enterprise.body[1]}
              </p>

              <Button asChild size="lg" className="mt-6">
                <a href="mailto:hello@atheos.io?subject=Atheos%20for%20teams">
                  {enterprise.cta}
                  <ArrowUpRight />
                </a>
              </Button>
            </div>

            <div className="rounded-xl border border-border bg-surface-sunken p-5">
              <p className="text-sm font-medium">{enterprise.needsTitle}</p>
              <ul className="mt-3 space-y-2.5">
                {enterprise.needs.map((need) => (
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
