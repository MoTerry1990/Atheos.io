"use client";

import { motion } from "motion/react";
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  FolderPlus,
  History,
  Upload,
} from "lucide-react";

import { EmptyState } from "@/components/ui/state";
import type { ActivityItem, ActivityType } from "@/features/dashboard/types";
import { formatRelativeTime } from "@/utils/format";
import { cn } from "@/lib/utils";

/**
 * Activity feed.
 *
 * A merged timeline of generations, credit movements and uploads. Merging them
 * is the point: "24 credits spent" immediately under the generation that spent
 * them is the answer to "what happened to my credits", and separate feeds never
 * produce that adjacency.
 *
 * ## Icon and colour carry meaning, but never alone
 *
 * Each row's type sets an icon *and* a tint, and the text says what happened
 * regardless. Someone who cannot distinguish the red from the green still reads
 * "failed" in the detail line.
 *
 * ## The connecting rail
 *
 * Drawn as a single absolute element behind the list, stopping short of the
 * last row. Per-item borders would leave a stub hanging below the final entry —
 * a small thing that reads as broken.
 *
 * ## `<time>` with a machine-readable datetime
 *
 * The visible text is relative ("6 minutes ago") and goes stale as the page
 * sits open; the `dateTime` attribute is absolute and does not. It is also what
 * a screen reader or a scraper can actually parse.
 */

const STYLES: Record<
  ActivityType,
  { icon: typeof CheckCircle2; className: string }
> = {
  generation_succeeded: {
    icon: CheckCircle2,
    className: "bg-success/10 text-success",
  },
  generation_failed: {
    icon: AlertCircle,
    className: "bg-destructive/10 text-destructive",
  },
  credits_spent: { icon: Coins, className: "bg-muted text-muted-foreground" },
  credits_granted: { icon: Coins, className: "bg-primary/10 text-primary" },
  asset_uploaded: { icon: Upload, className: "bg-info/10 text-info" },
  project_created: { icon: FolderPlus, className: "bg-info/10 text-info" },
};

export function ActivityFeed({ activity }: { activity: ActivityItem[] }) {
  return (
    <section aria-labelledby="activity-heading" className="space-y-4">
      <h2
        id="activity-heading"
        className="flex items-center gap-2 text-sm font-medium"
      >
        <History className="size-4 text-muted-foreground" aria-hidden />
        Activity
      </h2>

      {activity.length === 0 ? (
        <div className="rounded-xl border border-border">
          <EmptyState
            icon={History}
            title="Nothing here yet"
            description="Generations, uploads and credit movements will appear as they happen."
          />
        </div>
      ) : (
        <div className="relative rounded-xl border border-border bg-card p-4 sm:p-5">
          {/* Rail. Inset so it starts and stops inside the first and last icon
              rather than dangling past them. */}
          <div
            aria-hidden
            className="absolute top-9 bottom-9 left-[2.05rem] w-px bg-border sm:left-[2.3rem]"
          />

          <ol className="relative space-y-4">
            {activity.map((item, index) => {
              const style = STYLES[item.type];
              const Icon = style.icon;

              return (
                <motion.li
                  key={item.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.3,
                    ease: [0.25, 1, 0.5, 1],
                    delay: Math.min(index * 0.03, 0.24),
                  }}
                  className="flex gap-3"
                >
                  <span
                    className={cn(
                      "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card",
                      style.className,
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                  </span>

                  <div className="min-w-0 flex-1 pt-1">
                    <p className="truncate text-sm">{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.detail ? (
                        <>
                          <span className="capitalize">{item.detail}</span>
                          <span aria-hidden> · </span>
                        </>
                      ) : null}
                      <time dateTime={item.at}>
                        {formatRelativeTime(item.at)}
                      </time>
                    </p>
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
