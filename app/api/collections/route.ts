import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import {
  CollectionError,
  createCollection,
  listCollections,
} from "@/services/collections";

/**
 * Projects.
 *
 *   GET   this user's projects
 *   POST  create one
 *
 * Authorisation lives in the service, as everywhere else: layouts do not run
 * for route handlers, so a route that trusts middleware is one matcher edit
 * away from being open.
 */

const createSchema = z.object({
  // Bounded so a project name stays a label. The unique constraint is on the
  // full string, so an unbounded one would also make the index unbounded.
  name: z.string().trim().min(1).max(80),
  description: z.string().max(400).optional(),
});

export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "read",
    context: "GET /api/collections",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    return NextResponse.json({ collections: await listCollections() });
  } catch (error) {
    return toResponse(error, "Could not load your projects.");
  }
}

export async function POST(request: NextRequest) {
  const gate = await guard(request, {
    policy: "mutation",
    body: createSchema,
    context: "POST /api/collections",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const collection = await createCollection(gate.body);
    return NextResponse.json({ collection }, { status: 201 });
  } catch (error) {
    return toResponse(error, "Could not create that project.");
  }
}

function toResponse(error: unknown, fallback: string) {
  if (error instanceof CollectionError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  // Never surface a raw exception: it can carry query text or connection
  // details.
  console.error("collections request failed", error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
