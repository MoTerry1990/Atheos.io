import { Check, Minus } from "lucide-react";

import { PLAN_DEFINITIONS } from "@/services/billing/catalogue";
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

interface Row {
  label: string;
  /** By tier id, in the order plans are defined. */
  values: readonly (boolean | string)[];
  note?: string;
}

const ROWS: readonly Row[] = [
  {
    label: "Monthly credits",
    values: PLAN_DEFINITIONS.map((p) =>
      p.monthlyCredits.toLocaleString("en-US"),
    ),
  },
  {
    label: "Videos per month",
    values: PLAN_DEFINITIONS.map((p) =>
      String(Math.floor(p.monthlyCredits / 90)),
    ),
    note: "At five seconds on the standard model",
  },
  {
    label: "Images per month",
    values: PLAN_DEFINITIONS.map((p) =>
      String(Math.floor(p.monthlyCredits / 4)),
    ),
  },
  { label: "Image generation", values: [true, true, true] },
  { label: "Video generation", values: [true, true, true] },
  { label: "Video resolution", values: ["720p", "1080p", "1080p"] },
  { label: "Maximum clip length", values: ["7.5s", "12s", "12s"] },
  {
    label: "Motion Pro — higher-quality model",
    values: [false, true, true],
    note: "Slower to render, noticeably better output",
  },
  { label: "Image-to-video", values: [false, true, true] },
  { label: "Reference images", values: [false, true, true] },
  { label: "Aspect ratios", values: ["16:9, 9:16", "All six", "All six"] },
  { label: "Upscale to 4K", values: [true, true, true] },
  { label: "Background removal", values: [true, true, true] },
  { label: "Projects and collections", values: [true, true, true] },
  { label: "Prompt packs from the marketplace", values: [true, true, true] },
  { label: "Publish to the community gallery", values: [false, false, true] },
  { label: "Bulk generation and export", values: [false, false, true] },
  { label: "Usage and cost breakdown", values: [false, false, true] },
  {
    label: "Automatic refund on provider failure",
    values: [true, true, true],
    note: "Credits return the moment a generation fails",
  },
  { label: "Commercial rights", values: [true, true, true] },
  { label: "Support", values: ["Community", "Community", "Email"] },
];

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
              Feature comparison across the Free, Creator and Studio plans
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
                        : `$${(plan.monthly / 100).toFixed(2)}/mo`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
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
