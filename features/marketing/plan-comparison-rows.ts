import { visiblePlanDefinitions } from "@/services/billing/catalogue";

/**
 * The comparison matrix, as data.
 *
 * Split out of the component so the unit test can import it without a JSX
 * transform, and so a claim about what a plan includes lives somewhere a
 * reviewer can read end to end without scrolling past markup.
 */

/**
 * A cell whose text is a word rather than a measurement.
 *
 * "720p" and "12s" are the same in every language; "Community" and "All six"
 * are not. Those carry a `$`-prefixed key resolved against
 * `comparison.values` at render time, so the matrix stays one table rather
 * than one per locale.
 */
export type ValueKey = "$community" | "$email" | "$allSix" | "$pending";

export interface Row {
  label: string;
  /** By tier id, in the order plans are defined. */
  values: readonly (boolean | string)[];
  note?: string;
}

/**
 * Four columns, in `visiblePlanDefinitions()` order: Free, Creator, Pro, Studio.
 *
 * Sprint 4 removed the $5 Starter and the $199 Agency, so every literal row
 * below went from five values to four. A row with the wrong number of values
 * renders a silently short table rather than failing the build, so
 * `tests/unit/marketing-pricing.test.ts` asserts every row's width.
 *
 * `$pending` is the credit rows' answer while provider costs are still being
 * measured. It resolves to "Confirmed at launch" rather than to a number,
 * because a comparison table is exactly where an invented allowance would be
 * read as a commitment.
 */
export const COMPARISON_ROWS: readonly Row[] = [
  {
    label: "Credits",
    values: visiblePlanDefinitions().map((p) =>
      p.monthlyCredits === null
        ? "$pending"
        : p.monthlyCredits.toLocaleString("en-US"),
    ),
    note: "The Free grant is one-time; paid plans renew monthly",
  },
  { label: "Image generation", values: [true, true, true, true] },
  { label: "Video generation", values: [false, true, true, true] },
  {
    label: "Video resolution",
    values: ["—", "1080p", "1080p", "1080p"],
  },
  {
    label: "Maximum clip length",
    values: ["—", "12s", "12s", "12s"],
  },
  {
    label: "Motion Pro — higher-quality model",
    values: [false, true, true, true],
    note: "Slower to render, noticeably better output",
  },
  { label: "Image-to-video", values: [false, true, true, true] },
  { label: "Reference images", values: [false, true, true, true] },
  {
    label: "Video aspect ratios",
    values: ["—", "$allSix", "$allSix", "$allSix"],
  },
  { label: "Generations at once", values: ["1", "3", "5", "8"] },
  { label: "Upscale to 4K", values: [true, true, true, true] },
  { label: "Background removal", values: [true, true, true, true] },
  { label: "Projects and collections", values: [true, true, true, true] },
  {
    label: "Prompt packs from the marketplace",
    values: [true, true, true, true],
  },
  {
    label: "Publish to the community gallery",
    values: [false, false, true, true],
  },
  { label: "Bulk generation and export", values: [false, false, true, true] },
  { label: "Usage and cost breakdown", values: [false, false, true, true] },
  {
    // Reworded in Sprint 4. The old line said "Automatic refund on provider
    // failure", which stopped being true: a generation that fails *after* the
    // provider accepted it is billable to us and is no longer refunded
    // automatically. Leaving the old claim up would have been the pricing page
    // promising something the ledger had been changed to refuse.
    label: "Credits returned if a generation never starts",
    values: [true, true, true, true],
    note: "Failures after the provider begins work are reviewed individually",
  },
  { label: "Commercial rights", values: [true, true, true, true] },
  {
    label: "Support",
    values: ["$community", "$community", "$email", "$email"],
  },
];
