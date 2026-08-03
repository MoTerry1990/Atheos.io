import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import { deleteProject, getProject, updateProject } from "@/services/projects";
import { projectResponse } from "@/app/api/projects/shared";

/**
 * One project.
 *
 *   GET     the project and its contents
 *   PATCH   rename, metadata, favourite, archive, move
 *   DELETE  remove the project — never the work inside it
 *
 * ## PATCH, not five verbs
 *
 * Rename, favourite, archive and move all write one row. The autosaving editor
 * sends whichever fields changed, so a single partial update is both fewer
 * round trips and fewer places to repeat the ownership filter. Every field is
 * optional and *absent means unchanged* — which is why `description` and
 * `folderId` are nullable rather than cleared by omission.
 */

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(400).nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  // Bounded on both axes. Tags are labels; 40 characters is a sentence and
  // twenty of them is a taxonomy nobody navigates.
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  hue: z.number().int().optional(),
  coverAssetId: z.string().min(1).nullable().optional(),
  folderId: z.string().min(1).nullable().optional(),
  isFavorite: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gate = await guard(request, {
    policy: "read",
    context: "GET /api/projects/[id]",
  });
  if (gate instanceof NextResponse) return gate;
  // Opt-in rather than automatic: a background refresh or a prefetch must not
  // reorder the Recent list. Only a real navigation asks for the mark.
  const markOpened = new URL(request.url).searchParams.get("open") === "1";

  try {
    return NextResponse.json({ project: await getProject(id, { markOpened }) });
  } catch (error) {
    return projectResponse(error, "Could not load that project.");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gate = await guard(request, {
    policy: "mutation",
    context: "PATCH /api/projects/[id]",
  });
  if (gate instanceof NextResponse) return gate;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400 },
    );
  }

  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Those changes are not valid.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ project: await updateProject(id, parsed.data) });
  } catch (error) {
    return projectResponse(error, "Could not save those changes.");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gate = await guard(request, {
    policy: "mutation",
    context: "DELETE /api/projects/[id]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    return NextResponse.json({ deleted: await deleteProject(id) });
  } catch (error) {
    return projectResponse(error, "Could not delete that project.");
  }
}
