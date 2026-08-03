import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import { createFolder, listFolders } from "@/services/projects";
import { projectResponse } from "@/app/api/projects/shared";

/**
 * Folders.
 *
 * The list also comes back with `GET /api/projects`, because the page needs
 * both at once. This endpoint exists for the case where only the rail changed —
 * after creating or renaming a folder — and refetching every project card to
 * learn one new name would be wasteful.
 */

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  hue: z.number().int().min(0).max(360).optional(),
});

export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "read",
    context: "GET /api/folders",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    return NextResponse.json({ folders: await listFolders() });
  } catch (error) {
    return projectResponse(error, "Could not load your folders.");
  }
}

export async function POST(request: NextRequest) {
  const gate = await guard(request, {
    policy: "mutation",
    body: createSchema,
    context: "POST /api/folders",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const folder = await createFolder(gate.body);
    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    return projectResponse(error, "Could not create that folder.");
  }
}
