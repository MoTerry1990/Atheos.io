import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import { deleteFolder, updateFolder } from "@/services/projects";
import { projectResponse } from "@/app/api/projects/shared";

/**
 * One folder.
 *
 *   PATCH   rename or recolour
 *   DELETE  remove the folder — its projects survive, unfiled
 *
 * The delete response reports how many projects were unfiled, so the interface
 * can say "3 projects moved to Unfiled" rather than leaving the user to
 * discover where their work went.
 */

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  hue: z.number().int().min(0).max(360).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gate = await guard(request, {
    policy: "mutation",
    body: patchSchema,
    context: "PATCH /api/folders/[id]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    return NextResponse.json({ folder: await updateFolder(id, gate.body) });
  } catch (error) {
    return projectResponse(error, "Could not save that folder.");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gate = await guard(request, {
    policy: "mutation",
    context: "DELETE /api/folders/[id]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    return NextResponse.json(await deleteFolder(id));
  } catch (error) {
    return projectResponse(error, "Could not delete that folder.");
  }
}
