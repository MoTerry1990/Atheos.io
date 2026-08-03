"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ProjectDetail } from "@/features/projects/components/project-detail";
import { ProjectsBrowser } from "@/features/projects/components/projects-browser";
import { ProjectsApiProvider } from "@/features/projects/lib/api-context";
import { createFixtureApi } from "@/app/(dev)/projects-preview/fixtures";

/**
 * Projects preview.
 *
 * The production components, wired to an in-memory backend instead of the API.
 * Same pattern and same reason as `/studio-preview`: there is no database here,
 * so without this the page renders one error banner and nothing about the
 * interaction design can be reviewed.
 *
 * Routing is faked with a piece of state rather than the router, because
 * `/projects/[id]` sits behind the authenticated layout — following a real link
 * from here would land on a sign-in redirect. The component being rendered is
 * the real one either way.
 *
 * `noindex` via the `(dev)` layout, and excluded from Clerk's middleware
 * matcher so the development handshake does not intercept it.
 */
export default function ProjectsPreviewPage() {
  // Created once, and seeded with a timestamp passed in rather than read during
  // render — `Date.now()` in a render body differs between the server pass and
  // the client pass, which is a hydration mismatch.
  const [api] = useState(() => createFixtureApi(Date.now()));
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <ProjectsApiProvider value={api}>
      <div className="flex h-dvh flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs">
          <p>
            <span className="font-medium">Preview route.</span>{" "}
            <span className="text-muted-foreground">
              Projects, folders and metadata are fixtures held in memory —
              changes are real until you reload.
            </span>
          </p>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="xs"
              variant={openId === null ? "secondary" : "ghost"}
              onClick={() => setOpenId(null)}
            >
              Browser
            </Button>
            <Button
              size="xs"
              variant={openId ? "secondary" : "ghost"}
              onClick={() => setOpenId("p_atlas")}
            >
              Detail
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
          {openId ? <ProjectDetail projectId={openId} /> : <ProjectsBrowser />}
        </div>
      </div>
    </ProjectsApiProvider>
  );
}
