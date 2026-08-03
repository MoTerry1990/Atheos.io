import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import {
  createProject,
  listFolders,
  listProjects,
  type ProjectView,
} from "@/services/projects";
import { projectResponse } from "@/app/api/projects/shared";

/**
 * Projects.
 *
 *   GET   projects for a view, plus the folder rail
 *   POST  create one
 *
 * ## Why folders come back with the projects
 *
 * The page renders both at once and neither is useful alone. Two endpoints
 * would mean two round trips, two loading states, and a window where the rail
 * shows a folder the grid has not heard of. The folder list is a handful of
 * rows with a count — it is cheaper to send than to coordinate.
 *
 * ## `/api/projects`, while storage still says `collections`
 *
 * The URL follows the product language, not the table name. `/api/collections`
 * stays for the studio's picker: renaming a route the studio depends on to make
 * a noun consistent would be churn with a regression attached.
 */

const VIEWS = ["all", "recent", "favorites", "archived"] as const;

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(400).optional(),
  folderId: z.string().min(1).optional(),
});

const querySchema = z.object({
  view: z.enum(VIEWS).catch("all"),
  folder: z.string().max(64).optional(),
  // Search reaches a Prisma `contains` filter, which cannot use a B-tree index.
  // Prisma parameterises, so this is not injection — it is a sequential scan
  // somebody else pays for. Bounded so one request cannot ask for an unbounded
  // one, and rate limiting bounds how often they can ask.
  q: z.string().trim().max(120).optional(),
});

export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "read",
    query: querySchema,
    context: "GET /api/projects",
  });
  if (gate instanceof NextResponse) return gate;

  const view: ProjectView = gate.query.view;
  const folder = gate.query.folder ?? null;
  const search = gate.query.q;

  try {
    const [projects, folders] = await Promise.all([
      listProjects({
        view,
        // "Unfiled" is a real selection, distinct from "no folder filter" —
        // hence an explicit null rather than an absent value.
        folderId:
          folder === null ? undefined : folder === "unfiled" ? null : folder,
        search,
      }),
      listFolders(),
    ]);

    return NextResponse.json({ projects, folders, view });
  } catch (error) {
    return projectResponse(error, "Could not load your projects.");
  }
}

export async function POST(request: NextRequest) {
  const gate = await guard(request, {
    policy: "mutation",
    body: createSchema,
    context: "POST /api/projects",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const project = await createProject(gate.body);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return projectResponse(error, "Could not create that project.");
  }
}
