import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/api-guard";
import {
  MAX_SCENES,
  createSequence,
  listSequences,
} from "@/services/sequences";
import { errorResponse } from "@/lib/api-response";

/**
 * Sequences.
 *
 * `policy: "generate"` rather than `"mutation"`: one call here submits up to
 * sixteen video generations, so it is the most expensive request in the
 * product by an order of magnitude. Rate-limiting it as an ordinary write
 * would let a loop spend a month's credits in a minute.
 */

const schema = z.object({
  title: z.string().max(120).optional(),
  modelId: z.string().min(1),
  scenes: z.array(z.string().min(1).max(2000)).min(1).max(MAX_SCENES),
  aspectRatio: z.string().max(16).optional(),
  clipSeconds: z.number().int().min(1).max(30),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
});

export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "mutation",
    auth: "required",
    context: "GET /api/sequences",
  });
  if (gate instanceof NextResponse) return gate;

  return NextResponse.json(
    { sequences: await listSequences() },
    { headers: gate.headers },
  );
}

export async function POST(request: NextRequest) {
  const gate = await guard(request, {
    policy: "generate",
    auth: "required",
    body: schema,
    context: "POST /api/sequences",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    return NextResponse.json(await createSequence(gate.body), {
      status: 201,
      headers: gate.headers,
    });
  } catch (error) {
    return errorResponse(error, "POST /api/sequences");
  }
}
