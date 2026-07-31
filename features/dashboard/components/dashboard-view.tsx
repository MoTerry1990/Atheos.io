"use client";

import { AlertCircle } from "lucide-react";

import { Container } from "@/components/layout/container";
import { ActivityFeed } from "@/features/dashboard/components/activity-feed";
import { CreditsCard } from "@/features/dashboard/components/credits-card";
import { QuickActions } from "@/features/dashboard/components/quick-actions";
import { RecentProjects } from "@/features/dashboard/components/recent-projects";
import { StorageCard } from "@/features/dashboard/components/storage-card";
import { WorkspaceHeader } from "@/features/dashboard/components/workspace-header";
import type { DashboardData } from "@/features/dashboard/types";

/**
 * The dashboard, as a pure function of its data.
 *
 * This component takes `DashboardData` and nothing else — no queries, no
 * session, no imports from `services/`. That is what lets `/dashboard-preview`
 * render the real thing from fixtures, and it is why the layout below has
 * actually been looked at rather than only typechecked.
 *
 * ## The grid
 *
 * Two columns above `xl`: content left, summary rail right. Below that it
 * stacks, and the order matters — projects come before credits on mobile,
 * because someone opening this on a phone is far more likely to be checking on
 * their work than auditing their balance.
 *
 * `items-start` on the grid stops the rail cards stretching to match the height
 * of the left column, which is the default and looks like a bug.
 */
export function DashboardView({ data }: { data: DashboardData }) {
  return (
    <Container size="xl" className="space-y-8 py-6 sm:py-8">
      {data.pending ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4"
        >
          <AlertCircle
            className="mt-0.5 size-5 shrink-0 text-warning"
            aria-hidden
          />
          <div className="text-sm">
            <p className="font-medium">Finishing setup</p>
            <p className="mt-0.5 text-muted-foreground">
              Your workspace record is still being created. Figures below will
              fill in within a few seconds — refresh to check.
            </p>
          </div>
        </div>
      ) : null}

      <WorkspaceHeader user={data.user} stats={data.stats} />

      <section aria-label="Quick actions">
        <QuickActions />
      </section>

      {/* `min-w-0` on both children is load-bearing, not tidying. Grid items
          default to `min-width: auto`, which refuses to shrink below their
          content — so one wide descendant (a long project name, an untruncated
          activity title) pushes the column past the viewport and the whole page
          scrolls sideways. This produced 59px of overflow at 375px. It is also
          what makes `truncate` work on anything nested inside. */}
      <div className="grid items-start gap-8 xl:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          <RecentProjects projects={data.projects} />
          <ActivityFeed activity={data.activity} />
        </div>

        <div className="min-w-0 space-y-4">
          <CreditsCard credits={data.credits} />
          <StorageCard storage={data.storage} />
        </div>
      </div>
    </Container>
  );
}
