import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";

import { listFeaturedCreators } from "@/services/community";
import { communityResponse } from "@/app/api/community/shared";

/**
 * Featured creators.
 *
 * Editorial — `featuredAt` is set by us, never derived from follower count.
 * Returns an empty list until somebody has actually been featured, and the
 * interface says so rather than quietly showing the most-followed accounts
 * under a heading that claims editorial judgement.
 */
export async function GET(request: NextRequest) {
  // Public and unauthenticated, so the limit is keyed by IP.
  const gate = await guard(request, {
    policy: "publicRead",
    auth: "optional",
    context: "GET /api/community/creators",
  });
  if (gate instanceof NextResponse) return gate;
  try {
    return NextResponse.json({ creators: await listFeaturedCreators() });
  } catch (error) {
    return communityResponse(error, "Could not load featured creators.");
  }
}
