"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import DashboardLoading from "@/app/(app)/dashboard/loading";
import { DashboardView } from "@/features/dashboard/components/dashboard-view";
import { dashboardFixture } from "@/features/dashboard/fixtures";
import type { DashboardData } from "@/features/dashboard/types";

/**
 * Dashboard preview.
 *
 * Renders the **production** `DashboardView` against fixture data, so layout,
 * animation and responsive behaviour can be verified without a database or a
 * Clerk instance. If a component breaks, this page breaks with it — which is
 * what separates it from a mock-up.
 *
 * The three states are the ones that actually ship and are easy to forget:
 *
 *   populated  a workspace in use
 *   empty      every account's first day — the state most users see first
 *   pending    signed in, but the Clerk webhook has not created the row yet
 *
 * Building only the populated case is how products end up with a dashboard that
 * looks great in a screenshot and hostile on day one.
 *
 * ## Why the data is built in an effect
 *
 * `dashboardFixture()` derives timestamps from `Date.now()`. `"use client"`
 * does not prevent server rendering — Client Components still produce the
 * initial HTML — so calling it during render gives the server and the client
 * different millisecond values and hydrates with a mismatch. Building it after
 * mount means only the browser ever runs it.
 *
 * The real dashboard has no such problem: its timestamps come from the
 * database, identical on both sides.
 *
 * Internal, `noindex` via the `(dev)` layout, not linked from the product, and
 * deliberately kept in the production build — a preview that only exists on
 * localhost stops being checked.
 */

type PreviewState = "populated" | "empty" | "pending";

const EMPTY: DashboardData = {
  user: {
    displayName: "Alex",
    imageUrl: null,
    memberSince: "2026-07-01T00:00:00.000Z",
  },
  credits: {
    balance: 200,
    monthlyAllowance: 200,
    spentThisPeriod: 0,
    renewsAt: null,
    planName: "Starter",
  },
  storage: { usedBytes: 0, quotaBytes: 2 * 1024 * 1024 * 1024, breakdown: [] },
  projects: [],
  activity: [],
  notifications: [],
  stats: { generationsThisPeriod: 0, assetsTotal: 0, successRate: null },
  pending: false,
};

const PENDING: DashboardData = { ...EMPTY, pending: true };

export default function DashboardPreviewPage() {
  const [state, setState] = useState<PreviewState>("populated");
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    setData(
      state === "populated"
        ? dashboardFixture()
        : state === "empty"
          ? EMPTY
          : PENDING,
    );
  }, [state]);

  return (
    <div className="min-h-dvh bg-background">
      <div className="sticky top-0 z-50 flex flex-wrap items-center gap-2 border-b border-border bg-surface-sunken px-4 py-2.5">
        <p className="mr-2 text-xs text-muted-foreground">
          Dashboard preview — fixture data, not a real workspace
        </p>
        {(["populated", "empty", "pending"] as const).map((option) => (
          <Button
            key={option}
            size="xs"
            variant={state === option ? "default" : "outline"}
            onClick={() => setState(option)}
            className="capitalize"
          >
            {option}
          </Button>
        ))}
      </div>

      {/* The real loading skeleton, so the pre-mount frame is the same one
          production shows rather than a blank page. */}
      {data ? <DashboardView data={data} /> : <DashboardLoading />}
    </div>
  );
}
