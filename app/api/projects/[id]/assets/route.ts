import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import { addAssetsToCollection } from "@/services/collections";
import { removeAssetsFromProject } from "@/services/projects";
import { projectResponse } from "@/app/api/projects/shared";

/**
 * A project's contents.
 *
 *   POST    file results into it
 *   DELETE  take them out
 *
 * **DELETE removes membership, not the work.** The assets keep their rows,
 * their files and their place in every other project. That distinction is the
 * whole reason a join table exists here, and it is worth being explicit about
 * at the one endpoint where somebody might expect otherwise.
 */

const schema = z.object({
  // Bounds the `IN` clause the service builds. A batch is a selection on a
  // page, not a library.
  assetIds: z.array(z.string().min(1)).min(1).max(100),
});

async function parse(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return null;
  }

  const parsed = schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gate = await guard(request, {
    policy: "mutation",
    context: "POST /api/projects/[id]/assets",
  });
  if (gate instanceof NextResponse) return gate;

  const body = await parse(request);
  if (!body) {
    return NextResponse.json(
      { error: "Nothing valid to save." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await addAssetsToCollection(id, body.assetIds));
  } catch (error) {
    return projectResponse(error, "Could not save to that project.");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gate = await guard(request, {
    policy: "mutation",
    context: "DELETE /api/projects/[id]/assets",
  });
  if (gate instanceof NextResponse) return gate;

  const body = await parse(request);
  if (!body) {
    return NextResponse.json(
      { error: "Nothing valid to remove." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await removeAssetsFromProject(id, body.assetIds));
  } catch (error) {
    return projectResponse(error, "Could not remove those from the project.");
  }
}
