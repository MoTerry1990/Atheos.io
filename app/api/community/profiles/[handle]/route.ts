import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import { getProfile, listPosts, setFollow } from "@/services/community";
import { communityResponse } from "@/app/api/community/shared";

/**
 * A public profile.
 *
 *   GET   the profile and its first page of posts
 *   POST  follow or unfollow
 *
 * The posts come back with the profile because the page renders both and
 * neither is useful alone — the same reasoning as the projects page's folder
 * rail and the billing screen's five panels.
 */

const schema = z.object({ action: z.enum(["follow", "unfollow"]) });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;

  // Public, and it discloses whether a handle exists — so it is one of the few
  // reads worth limiting for enumeration rather than for cost.
  const gate = await guard(request, {
    policy: "publicRead",
    auth: "optional",
    context: "GET /api/community/profiles/[handle]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const [profile, gallery] = await Promise.all([
      getProfile(handle),
      listPosts({ handle: handle.toLowerCase(), order: "recent" }),
    ]);

    return NextResponse.json({ profile, ...gallery });
  } catch (error) {
    return communityResponse(error, "Could not load that profile.");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;

  const gate = await guard(request, {
    policy: "mutation",
    context: "POST /api/community/profiles/[handle]",
  });
  if (gate instanceof NextResponse) return gate;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await setFollow(handle, parsed.data.action === "follow"),
    );
  } catch (error) {
    return communityResponse(error, "Could not update that.");
  }
}
