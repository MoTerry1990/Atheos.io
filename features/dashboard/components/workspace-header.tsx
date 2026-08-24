"use client";

import { motion } from "motion/react";
import { Images, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { Counter } from "@/components/ui/counter";
import type { DashboardUser, UsageStats } from "@/features/dashboard/types";

/**
 * Workspace header — greeting and headline usage.
 *
 * ## The greeting is computed client-side, on purpose
 *
 * "Good morning" depends on the **viewer's** clock. Rendered on the server it
 * would reflect the server's timezone, so a user in Sydney gets "good evening"
 * at breakfast. Computing it after mount is a deliberate trade: the greeting
 * word is the one thing on this page that pops in a frame late, and that is
 * better than being confidently wrong.
 *
 * The name renders server-side either way, so there is no layout shift — only
 * the time-of-day word settles.
 *
 * ## Success rate is not shown
 *
 * It used to sit here as a third stat, computed as
 * `SUCCEEDED / (SUCCEEDED + FAILED)` across an account's whole history. Two
 * things were wrong with it. It sat beside "Generations this period" while
 * measuring all time, so one row mixed two time windows. And a failed
 * generation is refunded — the customer pays nothing — so the number described
 * Atheos's reliability while being displayed as if it were a fact about the
 * user's work.
 *
 * `UsageStats.successRate` is still computed and still returned; only the
 * display is gone. It belongs on an operations view, against a stated window,
 * not on somebody's dashboard.
 */

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function WorkspaceHeader({
  user,
  stats,
}: {
  user: DashboardUser;
  stats: UsageStats;
}) {
  const items = [
    {
      icon: Sparkles,
      label: "Generations this period",
      value: stats.generationsThisPeriod,
      format: (n: number) => Math.round(n).toLocaleString("en-US"),
    },
    {
      icon: Images,
      label: "Assets in library",
      value: stats.assetsTotal,
      format: (n: number) => Math.round(n).toLocaleString("en-US"),
    },
  ];

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
      >
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          <ClientGreeting />, {user.displayName}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Here is what has been happening in your workspace.
        </p>
      </motion.div>

      <motion.dl
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1], delay: 0.06 }}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
      >
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-border bg-card p-4"
          >
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <item.icon className="size-3.5" aria-hidden />
              {item.label}
            </dt>
            <dd className="mt-2 text-2xl font-semibold tracking-tight">
              <Counter value={item.value} format={item.format} />
            </dd>
          </div>
        ))}
      </motion.dl>
    </div>
  );
}

/**
 * Isolated so only this span re-renders after mount, rather than the whole
 * header. Renders nothing on the server — the comma and name carry the line
 * until it resolves.
 */
function ClientGreeting() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(greeting()), []);
  return <>{text ?? "Welcome back"}</>;
}
