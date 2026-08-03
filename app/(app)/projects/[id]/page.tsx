import type { Metadata } from "next";

import { ProjectDetail } from "@/features/projects/components/project-detail";

export const metadata: Metadata = { title: "Project" };

/**
 * One project.
 *
 * The title is static rather than generated from the project's name. A
 * `generateMetadata` would need its own authenticated fetch — the same query the
 * client is about to make — to put a word in the tab, and would leak a 404 for
 * someone else's id through the page title. Not worth either.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
      <ProjectDetail projectId={id} />
    </div>
  );
}
