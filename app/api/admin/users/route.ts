import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/api-guard";

import { listUsers } from "@/services/admin/users";
import { adminResponse } from "@/app/api/admin/shared";

const querySchema = z.object({
  // Search reaches a Prisma `contains` filter, which cannot use a B-tree index.
  // Prisma parameterises, so this is not injection — it is a sequential scan
  // somebody else pays for. Bounded so one request cannot ask for an unbounded
  // one, and rate limiting bounds how often they can ask.
  q: z.string().trim().max(120).optional(),
  cursor: z.string().max(64).optional(),
});

export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "admin",
    // Non-admins get 404 here, before any input is parsed — see the note on
    // `admin` in lib/api-guard.ts. `auth: "optional"` so the guard itself never
    // 401s, which would confirm the route exists.
    auth: "optional",
    admin: true,
    query: querySchema,
    context: "GET /api/admin/users",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    return NextResponse.json(
      await listUsers({
        search: gate.query.q,
        cursor: gate.query.cursor,
      }),
    );
  } catch (error) {
    return adminResponse(error, "Could not load users.");
  }
}
