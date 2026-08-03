import type { Metadata } from "next";

import { ProjectsBrowser } from "@/features/projects/components/projects-browser";

export const metadata: Metadata = { title: "Projects" };

/**
 * The projects route.
 *
 * A thin wrapper around a client component, deliberately — the page is one long
 * interaction (search, filter, rename, move) where every change refetches, so
 * server-rendering the first grid would buy one paint and cost a second data
 * path to keep in agreement with the first.
 *
 * The API route is the single source, and `services/projects.ts` enforces
 * ownership inside every query it runs.
 */
export default function ProjectsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
      <ProjectsBrowser />
    </div>
  );
}
