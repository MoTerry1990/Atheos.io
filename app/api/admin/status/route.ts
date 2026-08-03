import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";

import { getSystemStatus } from "@/services/admin/status";
import { adminResponse } from "@/app/api/admin/shared";

/**
 * System status.
 *
 * Admin-only despite being read-only. The check output names which credentials
 * are absent, which is a map of the deployment's gaps — useful to us, and
 * useful to somebody probing it.
 */
export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "admin",
    // Non-admins get 404 here, before any input is parsed — see the note on
    // `admin` in lib/api-guard.ts. `auth: "optional"` so the guard itself never
    // 401s, which would confirm the route exists.
    auth: "optional",
    admin: true,
    context: "GET /api/admin/status",
  });
  if (gate instanceof NextResponse) return gate;
  try {
    return NextResponse.json(await getSystemStatus());
  } catch (error) {
    return adminResponse(error, "Could not run the status checks.");
  }
}
