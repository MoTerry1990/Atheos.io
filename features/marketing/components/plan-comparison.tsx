import { Check, Minus } from "lucide-react";

import { PLAN_DEFINITIONS, formatMoney } from "@/services/billing/catalogue";
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

function Cell({ value }: { value: boolean | string }) {
  if (value === true) {
    return (
      <>
        <Check className="mx-auto size-4 text-primary" aria-hidden />
        <span className="sr-only">Included</span>
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
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span className="tabular-nums">{value}</span>;
}

export function PlanComparison() {
  return (
    <Section id="compare">
      <SectionHeading
        eyebrow="Compare"
        title="What each plan includes"
        description="Every row is something the product does today."
      />

      <Reveal delay={0.05} className="mt-10">
        {/* Scrolls on its own rather than pushing the page sideways. */}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-2xl text-sm">
            <caption className="sr-only">
              Feature comparison across the Free, Starter, Creator, Studio and
              Agency plans
            </caption>
            <thead className="bg-surface-sunken">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium">
                  Feature
                </th>
                {PLAN_DEFINITIONS.map((plan) => (
                  <th
                    key={plan.tier}
                    scope="col"
                    className="px-4 py-3 text-center font-medium whitespace-nowrap"
                  >
                    {plan.name}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {plan.monthly === 0
                        ? "Free"
                        : `${formatMoney(plan.monthly)}/mo`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.label} className="border-t border-border">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    {row.label}
                    {row.note ? (
                      <span className="block text-xs text-muted-foreground">
                        {row.note}
                      </span>
                    ) : null}
                  </th>
                  {row.values.map((value, index) => (
                    <td
                      key={`${row.label}-${PLAN_DEFINITIONS[index]?.tier ?? index}`}
                      className="px-4 py-3 text-center text-muted-foreground"
                    >
                      <Cell value={value} />
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
