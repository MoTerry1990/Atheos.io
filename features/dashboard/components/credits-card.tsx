"use client";

import { motion } from "motion/react";
import { ArrowUpRight, Coins } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Counter } from "@/components/ui/counter";
import type { CreditSummary } from "@/features/dashboard/types";
import { cn } from "@/lib/utils";

/**
 * Credit balance.
 *
 * ## What the bar measures
 *
 * Fraction of the period's allowance **remaining**, not spent. Both are
 * defensible, but a bar that empties as you use the product matches the mental
 * model of a fuel gauge, which is what people already have for a balance.
 *
 * The colour shifts to warning under 25% and destructive under 10%. Those are
 * genuine thresholds, not decoration: running out mid-session is the single
 * most disruptive thing that can happen here, and it should be visible before
 * it happens rather than announced afterwards.
 *
 * ## The purchased amount is not implied
 *
 * `spentThisPeriod` and `balance` are shown as separate figures rather than
 * being reconciled into one number. They genuinely can disagree — a refund puts
 * credits back without reducing spend — and quietly computing
 * `allowance - spent` would print a balance that contradicts the ledger.
 */
export function CreditsCard({ credits }: { credits: CreditSummary }) {
  const allowance = credits.allowance;

  /**
   * How full the bar is, and whether it means anything.
   *
   * The bar measures the balance against what the plan grants. That only has a
   * meaning while the balance is *within* the grant: a top-up, a rollover or a
   * complimentary grant can put it above, and a bar clamped to 1 then reads as
   * "completely full" whether somebody holds 300 credits or 6,000. Above the
   * grant the ratio is not shown as a bar at all — the number is the truth and
   * the bar would only dilute it.
   */
  const overAllowance = allowance ? credits.balance > allowance.credits : false;

  const ratio =
    allowance && !overAllowance
      ? Math.max(0, credits.balance / allowance.credits)
      : null;

  const tone =
    ratio === null
      ? "brand"
      : ratio < 0.1
        ? "destructive"
        : ratio < 0.25
          ? "warning"
          : "brand";

  return (
    <Card className="relative overflow-hidden">
      {tone === "brand" ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-brand-subtle"
        />
      ) : null}

      <CardContent className="relative space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Coins className="size-3.5" aria-hidden />
              Credits
            </p>
            <p className="mt-2 text-4xl font-semibold tracking-tight">
              <Counter value={credits.balance} />
            </p>
            {/*
              The denominator says what kind of grant it is.

              "of 300" alone reads as a monthly allowance on every plan, and
              Free's 300 arrives once. A plan whose allowance is still undecided
              shows its name and no number, because `creditsPerMonth` being null
              means undecided rather than zero.
            */}
            <p className="mt-1 text-xs text-muted-foreground">
              {allowance
                ? overAllowance
                  ? `on ${credits.planName}, above its ${allowance.credits.toLocaleString("en-US")} ${allowance.kind === "monthly" ? "monthly allowance" : "welcome grant"}`
                  : `of ${allowance.credits.toLocaleString("en-US")} ${allowance.kind === "monthly" ? "per month" : "granted once"} on ${credits.planName}`
                : `on ${credits.planName}`}
            </p>
          </div>

          <Button variant="outline" size="sm" asChild>
            <Link href="/settings/billing">
              Manage
              <ArrowUpRight />
            </Link>
          </Button>
        </div>

        <div className="space-y-2">
          {/*
            The bar is drawn only when it measures something.

            With no allowance, or with a balance above it, there is no honest
            fraction to show — and a bar clamped to 100% says "full" identically
            for somebody holding their whole grant and somebody holding twenty
            times it. The figure above is already the truth; an ornamental bar
            beside it is a second, worse answer to the same question.
          */}
          {ratio !== null ? (
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={Math.round(ratio * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Credits remaining"
            >
              {/* `initial` must not read the motion preference. The server
                cannot know it, so branching here renders one width on the
                server and another on the client — a hydration mismatch React
                does not patch up, which can strand the bar at zero. Reduced
                motion is handled globally by MotionConfig. See
                docs/DESIGN-SYSTEM.md. */}
              {/* `scaleX`, not `width`.
                Animating width makes the browser lay out and paint the bar on
                every frame of a 0.9s animation. `scaleX` is composited — it
                runs on the GPU and touches neither layout nor paint. Visually
                identical for a solid bar; `origin-left` is what makes it grow
                from the left rather than from the centre.

                The gradient variant does stretch rather than translate, which
                is imperceptible at these dimensions and worth the frames. */}
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: ratio }}
                transition={{
                  duration: 0.9,
                  ease: [0.25, 1, 0.5, 1],
                  delay: 0.1,
                }}
                className={cn(
                  "h-full w-full origin-left rounded-full",
                  tone === "brand" && "bg-gradient-brand",
                  tone === "warning" && "bg-warning",
                  tone === "destructive" && "bg-destructive",
                )}
              />
            </div>
          ) : null}

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {credits.spentThisPeriod.toLocaleString("en-US")} spent this
              period
            </span>
            {credits.renewsAt ? (
              <span>
                Renews{" "}
                {new Date(credits.renewsAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
