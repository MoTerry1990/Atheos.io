import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/api-guard";

import { getDailyActivity, getOverview } from "@/services/admin/analytics";
import { adminResponse } from "@/app/api/admin/shared";

/**
 * The dashboard's headline numbers, plus the activity series.
 *
 * Both in one request because they render together, and because two admin
 * endpoints means two `requireAdmin` round trips to the database for one page.
 */
const querySchema = z.object({
  // `Number(searchParams.get("days") ?? 30)` accepted anything: "abc" became
  // NaN and flowed into a date computation, and "100000" asked the database to
  // aggregate three centuries. Coerced, integral, and bounded to a year.
  days: z.coerce.number().int().min(1).max(365).default(30),
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
    context: "GET /api/admin/overview",
  });
  if (gate instanceof NextResponse) return gate;
  const { days } = gate.query;

  try {
    const [overview, activity] = await Promise.all([
      getOverview(),
      getDailyActivity(Number.isFinite(days) ? days : 30),
    ]);

    return NextResponse.json({ overview, activity });
  } catch (error) {
    return adminResponse(error, "Could not load the dashboard.");
  }
}
