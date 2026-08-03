import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { getProfile, updateProfile } from "@/services/community";
import { HANDLE_MAX, HANDLE_MIN } from "@/services/community/handles";
import { communityResponse } from "@/app/api/community/shared";

/**
 * The signed-in user's own profile.
 *
 * Separate from `/profiles/[handle]`, which is the public read. This one
 * answers "do I have a handle yet" without the caller needing to know it — the
 * question every publish flow asks first.
 *
 * `profile: null` when no handle has been claimed. Not a 404: having no public
 * profile is a normal state, and the sign-up flow does not create one.
 */

const schema = z.object({
  handle: z.string().trim().min(HANDLE_MIN).max(HANDLE_MAX).optional(),
  displayName: z.string().max(60).nullable().optional(),
  bio: z.string().max(400).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "read",
    context: "GET /api/community/profile",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "You need to be signed in." },
        { status: 401 },
      );
    }

    if (!user.handle) return NextResponse.json({ profile: null });

    return NextResponse.json({ profile: await getProfile(user.handle) });
  } catch (error) {
    return communityResponse(error, "Could not load your profile.");
  }
}

export async function PATCH(request: NextRequest) {
  const gate = await guard(request, {
    policy: "mutation",
    body: schema,
    context: "PATCH /api/community/profile",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    return NextResponse.json({ profile: await updateProfile(gate.body) });
  } catch (error) {
    return communityResponse(error, "Could not save your profile.");
  }
}
