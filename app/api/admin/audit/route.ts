import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/api-guard";

import { listAudit } from "@/services/admin/auth";
import { adminResponse } from "@/app/api/admin/shared";

/**
 * The audit trail.
 *
 * Readable by any admin, deliberately: a log only its author can read is not
 * oversight. Nothing writes here through the API — entries are created by the
 * actions they describe, in the same transaction.
 */
const querySchema = z.object({
  // Bounded, because it reaches a database filter. An unbounded free string is
  // not an injection risk through Prisma, but it is a cheap way to make us scan.
  action: z.string().max(64).optional(),
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
    context: "GET /api/admin/audit",
  });
  if (gate instanceof NextResponse) return gate;
  const { action } = gate.query;

  try {
    return NextResponse.json({ entries: await listAudit({ action }) });
  } catch (error) {
    return adminResponse(error, "Could not load the audit log.");
  }
}
