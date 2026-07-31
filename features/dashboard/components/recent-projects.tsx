"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, FolderPlus, Layers } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state";
import type { RecentProject } from "@/features/dashboard/types";
import { formatRelativeTime } from "@/utils/format";

/**
 * Recent projects.
 *
 * ## The preview mosaic
 *
 * Up to four tiles per card, generated from hues the **server** derived from
 * asset ids. Doing that derivation here would be non-deterministic across
 * server and client and hydrate with a mismatch — the same class of bug that
 * bit the motion primitives in Sprint 1.
 *
 * Real thumbnails replace these once assets exist; the mosaic keeps the layout
 * honest in the meantime rather than leaving a grey rectangle.
 *
 * ## Empty state
 *
 * Every account starts here, so this is the first thing most users see —
 * treated as a primary state with an action, not as a fallback.
 */
export function RecentProjects({ projects }: { projects: RecentProject[] }) {
  const reduced = useReducedMotion();

  return (
    <section aria-labelledby="recent-projects-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2
          id="recent-projects-heading"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Layers className="size-4 text-muted-foreground" aria-hidden />
          Recent projects
        </h2>

        {projects.length > 0 ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">
              View all
              <ArrowRight />
            </Link>
          </Button>
        ) : null}
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-border">
          <EmptyState
            icon={FolderPlus}
            title="No projects yet"
            description="Projects group related generations so a series of attempts stays together instead of scattering through your library."
            action={
              <Button variant="gradient" size="sm" asChild>
                <Link href="/dashboard">Create a project</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project, index) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.35,
                ease: [0.25, 1, 0.5, 1],
                delay: Math.min(index * 0.05, 0.25),
              }}
              whileHover={reduced ? undefined : { y: -2 }}
            >
              <Link
                href="/dashboard"
                className="group block overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
              >
                {/* 2×2 mosaic. Fewer than four assets leaves real gaps rather
                    than padding with filler that implies content. */}
                <div className="grid aspect-[16/9] grid-cols-2 grid-rows-2 gap-px bg-surface-sunken">
                  {Array.from({ length: 4 }).map((_, tile) => {
                    const hue = project.previewHues[tile];
                    return (
                      <div
                        key={tile}
                        className="relative overflow-hidden"
                        style={
                          hue !== undefined
                            ? {
                                backgroundColor: "oklch(0.16 0.02 300)",
                                backgroundImage: `radial-gradient(120% 120% at 30% 20%, oklch(0.66 0.2 ${hue} / 0.75), transparent 70%)`,
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>

                <div className="p-3.5">
                  <p className="truncate text-sm font-medium">{project.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {project.assetCount}{" "}
                    {project.assetCount === 1 ? "asset" : "assets"} ·{" "}
                    {formatRelativeTime(project.updatedAt)}
                  </p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}
