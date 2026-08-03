import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";

import { duplicateProject } from "@/services/projects";
import { projectResponse } from "@/app/api/projects/shared";

/**
 * Duplicate a project.
 *
 * A POST with no body: the new name is generated server-side because
 * `(userId, name)` is unique and the obvious answer — "Copy of X" — is already
 * taken by the second duplicate. Asking the user for a name they cannot know is
 * free would be a dialog that exists to reject them.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Duplication copies every asset row in the project, so it is markedly more
  // expensive than the mutations it shares a policy with.
  const gate = await guard(request, {
    policy: "mutation",
    context: "POST /api/projects/[id]/duplicate",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const project = await duplicateProject(id);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return projectResponse(error, "Could not duplicate that project.");
  }
}
