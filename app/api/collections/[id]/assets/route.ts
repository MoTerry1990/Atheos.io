import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import { CollectionError, addAssetsToCollection } from "@/services/collections";

/**
 * Add results to a project.
 *
 * A separate route from generation submission on purpose. `POST /api/generations`
 * already accepts a `collectionId` and files the outputs on success, which
 * covers "I know where this is going before I make it". This covers the far
 * more common case: looking at a result, deciding it is worth keeping, and
 * filing it — including results from a previous session.
 */

const schema = z.object({
  // Capped because it bounds the `IN` clause the service builds. A batch is a
  // handful of outputs, not a library.
  assetIds: z.array(z.string().min(1)).min(1).max(50),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gate = await guard(request, {
    policy: "mutation",
    body: schema,
    context: "POST /api/collections/[id]/assets",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const result = await addAssetsToCollection(id, gate.body.assetIds);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CollectionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("add to collection failed", error);
    return NextResponse.json(
      { error: "Could not save to that project." },
      { status: 500 },
    );
  }
}
