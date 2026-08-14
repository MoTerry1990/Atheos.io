import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/api-guard";
import { createApiKey, listApiKeys, revokeApiKey } from "@/services/api-keys";

/**
 * Managing the credentials that let other programs act as you.
 *
 * **Session only.** `guard` resolves the caller with `getCurrentUser()`, which
 * reads a Clerk session and nothing else — so an API key cannot mint another
 * API key. That is the important property here: a leaked key that can issue
 * more keys survives its own revocation, which turns an incident into a
 * permanent one.
 *
 * The same fact explains why the MCP route does not use `guard`. Everything
 * wrapped in the guard is browser-facing and stays that way; `/api/mcp` is the
 * programmatic surface, and it resolves the key itself.
 */

const createSchema = z.object({
  name: z.string().min(1).max(80),
});

export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "mutation",
    auth: "required",
    context: "GET /api/keys",
  });
  if (gate instanceof NextResponse) return gate;

  return NextResponse.json(
    { keys: await listApiKeys(gate.user!.id) },
    { headers: gate.headers },
  );
}

export async function POST(request: NextRequest) {
  const gate = await guard(request, {
    policy: "mutation",
    auth: "required",
    body: createSchema,
    context: "POST /api/keys",
  });
  if (gate instanceof NextResponse) return gate;

  const issued = await createApiKey(gate.user!.id, gate.body.name);

  // The only response that will ever contain the plaintext. The client must
  // show it now; there is no endpoint that can return it again.
  return NextResponse.json(issued, { status: 201, headers: gate.headers });
}

export async function DELETE(request: NextRequest) {
  const gate = await guard(request, {
    policy: "mutation",
    auth: "required",
    context: "DELETE /api/keys",
  });
  if (gate instanceof NextResponse) return gate;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "Which key?", code: "missing_id" },
      { status: 400, headers: gate.headers },
    );
  }

  const revoked = await revokeApiKey(gate.user!.id, id);

  // 404 rather than 403 when it is not theirs. Telling somebody a key exists
  // but belongs to another account is a fact they have no business learning.
  if (!revoked) {
    return NextResponse.json(
      { error: "No such key.", code: "not_found" },
      { status: 404, headers: gate.headers },
    );
  }

  return NextResponse.json({ revoked: true }, { headers: gate.headers });
}
