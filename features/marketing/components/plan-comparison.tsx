import { Check, Minus } from "lucide-react";

import { PLAN_DEFINITIONS, formatMoney } from "@/services/billing/catalogue";
import { getCopy } from "@/features/marketing/i18n/dictionaries";
import type { Locale } from "@/features/marketing/i18n/locales";
import { COMPARISON_ROWS } from "@/features/marketing/plan-comparison-rows";
import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";

/**
 * Feature comparison across plans.
 *
 * The tier cards answer "which one is for me". This answers "does the cheap
 * one do the specific thing I need", which is the question somebody asks right
 * before they decide not to buy.
 *
 * ## Rows are capabilities that actually exist
 *
 * Nothing here is aspirational. Sequences, audio and the editor are specified
 * and unbuilt, so they are absent rather than greyed out — a roadmap rendered
 * as a feature table reads as a list of things that are missing, and invites
 * the reader to check whether the rest is real.
 */

function Cell({
  value,
  labels,
}: {
  value: boolean | string;
  labels: {
    included: string;
    notIncluded: string;
    values: Record<string, string>;
  };
}) {
  if (value === true) {
    return (
      <>
        <Check className="mx-auto size-4 text-primary" aria-hidden />
        <span className="sr-only">{labels.included}</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <Minus
          className="mx-auto size-4 text-muted-foreground/50"
          aria-hidden
        />
        <span className="sr-only">{labels.notIncluded}</span>
      </>
    );
  }
  // `$`-prefixed values are dictionary keys — see ValueKey.
  const text = value.startsWith("$")
    ? (labels.values[value.slice(1)] ?? value)
    : value;

  return <span className="tabular-nums">{text}</span>;
}

export function PlanComparison({ locale }: { locale: Locale }) {
  const { comparison, plans } = getCopy(locale);

  return (
    <Section id="compare">
      <SectionHeading
        eyebrow={comparison.eyebrow}
        title={comparison.title}
        description={comparison.description}
      />

      <Reveal delay={0.05} className="mt-10">
        {/* Scrolls on its own rather than pushing the page sideways. */}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-2xl text-sm">
            <caption className="sr-only">{comparison.caption}</caption>
            <thead className="bg-surface-sunken">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium">
                  {comparison.feature}
                </th>
                {PLAN_DEFINITIONS.map((plan) => (
                  <th
                    key={plan.tier}
                    scope="col"
                    className="px-4 py-3 text-center font-medium whitespace-nowrap"
                  >
                    {plans[plan.tier].name}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {plan.monthly === 0
                        ? comparison.free
                        : `${formatMoney(plan.monthly)}${comparison.perMonth}`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row, rowIndex) => (
                <tr key={row.label} className="border-t border-border">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    {comparison.rows[rowIndex]?.label}
                    {comparison.rows[rowIndex]?.note ? (
                      <span className="block text-xs text-muted-foreground">
                        {comparison.rows[rowIndex]?.note}
                      </span>
                    ) : null}
                  </th>
                  {row.values.map((value, index) => (
                    <td
                      key={`${row.label}-${PLAN_DEFINITIONS[index]?.tier ?? index}`}
                      className="px-4 py-3 text-center text-muted-foreground"
                    >
                      <Cell value={value} labels={comparison} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
    </Section>
  );
}
