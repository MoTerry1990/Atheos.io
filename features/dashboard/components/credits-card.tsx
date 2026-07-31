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
  const ratio =
    credits.monthlyAllowance > 0
      ? Math.min(1, Math.max(0, credits.balance / credits.monthlyAllowance))
      : 0;

  const tone = ratio < 0.1 ? "destructive" : ratio < 0.25 ? "warning" : "brand";

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
            <p className="mt-1 text-xs text-muted-foreground">
              of {credits.monthlyAllowance.toLocaleString("en-US")} on{" "}
              {credits.planName}
            </p>
          </div>

          <Button variant="outline" size="sm" asChild>
            <Link href="/settings">
              Manage
              <ArrowUpRight />
            </Link>
          </Button>
        </div>

        <div className="space-y-2">
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
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${ratio * 100}%` }}
              transition={{
                duration: 0.9,
                ease: [0.25, 1, 0.5, 1],
                delay: 0.1,
              }}
              className={cn(
                "h-full rounded-full",
                tone === "brand" && "bg-gradient-brand",
                tone === "warning" && "bg-warning",
                tone === "destructive" && "bg-destructive",
              )}
            />
          </div>

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
