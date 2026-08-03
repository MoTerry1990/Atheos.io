import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";

import { getCurrentUser } from "@/lib/auth";
import { listInstalled } from "@/services/marketplace";
import { marketplaceResponse } from "@/app/api/marketplace/shared";

/**
 * What this user has installed.
 *
 * Read by the studio, not by the marketplace page — the marketplace already
 * gets install state on every listing. This exists so the composer can offer
 * installed prompt and style packs without loading the whole catalogue and
 * filtering it client-side.
 *
 * Returns the stored **snapshots**, so the composer shows what was installed
 * rather than what the repository has since become. See
 * `services/marketplace/index.ts` for why that distinction is load-bearing.
 *
 * An empty array for a signed-out caller rather than a 401: this is called
 * alongside the studio's own bootstrap, and failing it would take the studio
 * down over an optional enhancement.
 */
export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "read",
    context: "GET /api/marketplace/installed",
  });
  if (gate instanceof NextResponse) return gate;
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ installed: [] });

    return NextResponse.json({ installed: await listInstalled(user.id) });
  } catch (error) {
    return marketplaceResponse(error, "Could not load your installed items.");
  }
}
