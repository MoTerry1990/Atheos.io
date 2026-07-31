"use client";

import { motion } from "motion/react";
import { HardDrive } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { StorageSummary } from "@/features/dashboard/types";
import { formatBytes } from "@/utils/format";
import { cn } from "@/lib/utils";

/**
 * Storage usage.
 *
 * A ring rather than a bar, purely so it does not read as a second copy of the
 * credits card sitting next to it. Two identical progress bars side by side
 * make the eye treat them as one control.
 *
 * ## Drawing the ring
 *
 * `strokeDasharray` set to the circumference, with `strokeDashoffset` animated
 * from full to the remainder — the standard SVG technique, and the only one
 * that animates smoothly without a layout pass. `rotate(-90)` moves the start
 * to twelve o'clock, since SVG arcs begin at three.
 *
 * The circle is `aria-hidden`; the percentage is announced from the text
 * beneath it. A screen reader gains nothing from an SVG path.
 *
 * ## Per-kind breakdown
 *
 * Video dominates storage on a platform like this — typically an order of
 * magnitude above images — so showing the split answers "what do I delete?"
 * which a single total never does.
 */

const KIND_COLORS: Record<string, string> = {
  VIDEO: "bg-chart-1",
  IMAGE: "bg-chart-2",
  AUDIO: "bg-chart-3",
  OTHER: "bg-chart-4",
};

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function StorageCard({ storage }: { storage: StorageSummary }) {
  const ratio =
    storage.quotaBytes > 0
      ? Math.min(1, storage.usedBytes / storage.quotaBytes)
      : 0;
  const percent = Math.round(ratio * 100);
  const nearlyFull = ratio >= 0.9;

  return (
    <Card>
      <CardContent className="space-y-5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <HardDrive className="size-3.5" aria-hidden />
          Storage
        </p>

        <div className="flex items-center gap-5">
          <div className="relative size-20 shrink-0">
            <svg
              viewBox="0 0 80 80"
              className="size-full -rotate-90"
              aria-hidden
            >
              <circle
                cx="40"
                cy="40"
                r={RADIUS}
                fill="none"
                strokeWidth="8"
                className="stroke-muted"
              />
              <motion.circle
                cx="40"
                cy="40"
                r={RADIUS}
                fill="none"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                // Same rule as the credits bar: no motion-preference branch
                // in `initial`. MotionConfig suppresses the animation globally
                // under prefers-reduced-motion.
                initial={{ strokeDashoffset: CIRCUMFERENCE }}
                animate={{ strokeDashoffset: CIRCUMFERENCE * (1 - ratio) }}
                transition={{
                  duration: 1,
                  ease: [0.25, 1, 0.5, 1],
                  delay: 0.15,
                }}
                className={cn(
                  nearlyFull ? "stroke-destructive" : "stroke-primary",
                )}
              />
            </svg>

            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-semibold tabular-nums">
                {percent}%
              </span>
            </div>
          </div>

          <div className="min-w-0">
            <p className="text-2xl font-semibold tracking-tight">
              {formatBytes(storage.usedBytes)}
            </p>
            <p className="text-xs text-muted-foreground">
              of {formatBytes(storage.quotaBytes)} used
            </p>
          </div>
        </div>

        {storage.breakdown.length > 0 ? (
          <ul className="space-y-2">
            {storage.breakdown.map((row) => (
              <li
                key={row.kind}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      KIND_COLORS[row.kind] ?? "bg-muted-foreground",
                    )}
                  />
                  <span className="truncate capitalize">
                    {row.kind.toLowerCase()}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    ({row.count})
                  </span>
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatBytes(row.bytes)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nothing stored yet. Generated work and uploads will appear here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
