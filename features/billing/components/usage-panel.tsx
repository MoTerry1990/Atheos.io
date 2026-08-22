"use client";

import { Activity } from "lucide-react";

import { ProgressBar } from "@/components/ui/loading";
import type { UsageReport } from "@/features/billing/lib/api";
import { cn } from "@/lib/utils";

/**
 * What the credits went on.
 *
 * ## The allowance bar is a fraction, and it says which
 *
 * "1,840 of 3,000 used" rather than a percentage. A bar with no denominator
 * tells somebody they are two thirds through something without saying two
 * thirds of what — and the denominator is the number they are deciding whether
 * to increase.
 *
 * ## What the two numbers actually are
 *
 * They come from different places and mean different things, and conflating
 * them is how this panel told an owner they had used "860 of 4,800".
 *
 *   **used** is `creditsSpent` from `services/billing/reporting.ts`: the net of
 *   `GENERATION_SPEND` and `GENERATION_REFUND` in the **ledger** over the
 *   period. It is wallet consumption, drawn from one pooled balance — signup
 *   grant, credit packs, subscription grants and manual adjustments all spend
 *   from the same place. It is not "subscription credits used", and nothing
 *   stops it exceeding the allowance.
 *
 *   **allowance** is the recurring grant of the plan the customer is **billed**
 *   for, from the catalogue — the same figure `invoice.paid` grants. It is a
 *   reference point, not a cap.
 *
 * So `allowanceNote` names the plan behind the denominator. Without it, "of
 * 500" is a number with no stated origin, which is the ambiguity that let the
 * wrong plan's figure sit there unnoticed.
 *
 * ## Two breakdowns, because they answer different questions
 *
 * By modality answers "is video eating my plan". By model answers "which one".
 * The first is the decision about what to stop doing; the second is the
 * decision about what to swap.
 *
 * The bars are proportional to the largest row, not to the total. With a long
 * tail, scaling to the total makes every row after the first two invisible.
 */

const MODALITY_LABELS: Record<string, string> = {
  IMAGE: "Images",
  VIDEO: "Video",
  AUDIO: "Audio",
};

export function UsagePanel({
  usage,
  allowance,
  allowanceNote,
  balance,
}: {
  usage: UsageReport;
  /**
   * The recurring grant of the **billed** plan, not the access tier.
   *
   * Null while a plan's credit allowance has not been settled, in which case
   * the fraction collapses to a bare count rather than inventing a
   * denominator.
   */
  allowance: number | null;
  /**
   * Where that denominator comes from, in words — "Creator grants 500 credits
   * monthly". Rendered beneath the fraction so the number is never anonymous.
   */
  allowanceNote?: string | null;
  balance: number;
}) {
  const used = usage.creditsSpent;
  const maxModality = Math.max(
    1,
    ...usage.byModality.map((row) => row.credits),
  );
  const maxModel = Math.max(1, ...usage.byModel.map((row) => row.credits));

  const start = new Date(usage.periodStart);
  const end = new Date(usage.periodEnd);

  return (
    <section className="space-y-5" aria-labelledby="usage-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="usage-heading"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Activity className="size-4 text-muted-foreground" aria-hidden />
          Usage
        </h2>
        <p className="text-2xs text-muted-foreground">
          {start.toLocaleDateString()} – {end.toLocaleDateString()}
        </p>
      </div>

      <div className="space-y-1.5">
        {/**
         * The bar only exists when there is a real denominator.
         *
         * A progress bar is a claim that something is being consumed out of
         * something finite. Credits are pooled and never expire, so that claim
         * only holds for one comparison: spend *inside a billing period*
         * against the recurring grant that period pays for. Everywhere else —
         * a rolling 30-day window, a one-time Free grant, complimentary access
         * that grants nothing — the facts are stated separately instead, with
         * no bar to imply a limit that is not there.
         */}
        {allowance !== null ? (
          <>
            <ProgressBar
              value={
                allowance > 0 ? Math.min(100, (used / allowance) * 100) : 0
              }
              label="Credits used this billing period"
            />
            <p className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground tabular-nums">
              <span>
                <span className="font-medium text-foreground">
                  {used.toLocaleString("en-US")}
                </span>{" "}
                {`of ${allowance.toLocaleString("en-US")} used this billing period`}
              </span>
              <span>{balance.toLocaleString("en-US")} balance</span>
            </p>
          </>
        ) : (
          <dl className="space-y-1 text-xs">
            <div className="flex flex-wrap justify-between gap-2 tabular-nums">
              <dt className="text-muted-foreground">Available balance</dt>
              <dd className="font-medium text-foreground">
                {balance.toLocaleString("en-US")} credits
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2 tabular-nums">
              <dt className="text-muted-foreground">
                Credits spent in this window
              </dt>
              <dd className="font-medium text-foreground">
                {used.toLocaleString("en-US")}
              </dd>
            </div>
          </dl>
        )}

        {/* The denominator, attributed. */}
        {allowanceNote ? (
          <p className="text-2xs text-muted-foreground">{allowanceNote}</p>
        ) : null}
        {/* Balance and allowance are different numbers and people conflate
            them. Credits pool and never expire, so rollover, credit packs and
            adjustments all make the balance exceed the allowance — which looks
            like a bug unless it is explained. */}
        {allowance !== null && balance > allowance ? (
          <p className="text-2xs text-muted-foreground">
            Your balance is above this period&rsquo;s grant — credits never
            expire, and packs and rollover both add to it.
          </p>
        ) : null}

        {/* The other direction, and the one that looked like an error: spending
            draws on the whole balance, so using more than the grant is normal
            rather than an overage. */}
        {allowance !== null && used > allowance ? (
          <p className="text-2xs text-muted-foreground">
            You have spent more than this period&rsquo;s grant — that is fine,
            generations draw on your whole balance.
          </p>
        ) : null}
      </div>

      {usage.generations === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Nothing generated this period.
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          <Breakdown
            title="By type"
            rows={usage.byModality.map((row) => ({
              key: row.modality,
              label: MODALITY_LABELS[row.modality] ?? row.modality,
              credits: row.credits,
              count: row.generations,
            }))}
            max={maxModality}
          />
          <Breakdown
            title="By model"
            rows={usage.byModel.map((row) => ({
              key: row.model,
              label: row.model,
              credits: row.credits,
              count: row.generations,
            }))}
            max={maxModel}
          />
        </div>
      )}
    </section>
  );
}

function Breakdown({
  title,
  rows,
  max,
}: {
  title: string;
  rows: { key: string; label: string; credits: number; count: number }[];
  max: number;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate font-mono">{row.label}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {row.credits.toLocaleString("en-US")}
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-secondary"
              role="presentation"
            >
              <div
                className={cn("h-full rounded-full bg-primary/70")}
                style={{ width: `${Math.max(2, (row.credits / max) * 100)}%` }}
              />
            </div>
            <p className="text-2xs text-muted-foreground tabular-nums">
              {row.count} generation{row.count === 1 ? "" : "s"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
