import { PLAN_DEFINITIONS } from "@/services/billing/catalogue";

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
export type ValueKey = "$community" | "$email" | "$allSix";

export interface Row {
  label: string;
  /** By tier id, in the order plans are defined. */
  values: readonly (boolean | string)[];
  note?: string;
}

export const COMPARISON_ROWS: readonly Row[] = [
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
  // Column order matches PLAN_DEFINITIONS: Free, Starter, Creator, Studio,
  // Agency. A row with the wrong number of values renders a silently short
  // table row rather than failing the build, so a test asserts every row is
  // PLAN_DEFINITIONS.length wide — see tests/unit/marketing-pricing.test.ts.
  { label: "Image generation", values: [true, true, true, true, true] },
  { label: "Video generation", values: [true, true, true, true, true] },
  {
    label: "Video resolution",
    values: ["720p", "720p", "1080p", "1080p", "1080p"],
  },
  {
    label: "Maximum clip length",
    values: ["7.5s", "7.5s", "12s", "12s", "12s"],
  },
  {
    label: "Motion Pro — higher-quality model",
    values: [false, false, true, true, true],
    note: "Slower to render, noticeably better output",
  },
  { label: "Image-to-video", values: [false, false, true, true, true] },
  { label: "Reference images", values: [false, false, true, true, true] },
  {
    label: "Video aspect ratios",
    values: ["16:9, 9:16", "16:9, 9:16", "$allSix", "$allSix", "$allSix"],
    note: "The extra four come with Motion Pro",
  },
  { label: "Upscale to 4K", values: [true, true, true, true, true] },
  { label: "Background removal", values: [true, true, true, true, true] },
  { label: "Projects and collections", values: [true, true, true, true, true] },
  {
    label: "Prompt packs from the marketplace",
    values: [true, true, true, true, true],
  },
  {
    label: "Publish to the community gallery",
    values: [false, false, false, true, true],
  },
  {
    label: "Bulk generation and export",
    values: [false, false, false, true, true],
  },
  {
    label: "Usage and cost breakdown",
    values: [false, false, false, true, true],
  },
  {
    label: "Automatic refund on provider failure",
    values: [true, true, true, true, true],
    note: "Credits return the moment a generation fails",
  },
  { label: "Commercial rights", values: [true, true, true, true, true] },
  {
    label: "Support",
    values: ["$community", "$community", "$community", "$email", "$email"],
  },
];
