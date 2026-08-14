import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { getSequence } from "@/services/sequences";
import { errorResponse } from "@/lib/api-response";

/**
 * One sequence and the state of every clip in it.
 *
 * Polled by the page while clips render. Cheap by design — the status is
 * derived from the scenes' generation rows rather than stored, so this never
 * reports a sequence as still generating because a status write was lost.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await guard(request, {
    policy: "mutation",
    auth: "required",
    context: "GET /api/sequences/[id]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const { id } = await params;
    return NextResponse.json(await getSequence(id), { headers: gate.headers });
  } catch (error) {
    return errorResponse(error, "GET /api/sequences/[id]");
  }
}
