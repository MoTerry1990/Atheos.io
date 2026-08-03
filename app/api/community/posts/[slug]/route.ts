import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import { getPost, setLike, unpublishPost } from "@/services/community";
import { communityResponse } from "@/app/api/community/shared";

/**
 * One post.
 *
 *   GET     the post, with the viewer's like state
 *   POST    like, unlike, or take it down
 *
 * Reading is public; every action needs an account. The service enforces that
 * — this file shapes the request and the response, and decides nothing about
 * who may call it.
 */

const schema = z.object({
  action: z.enum(["like", "unlike", "unpublish"]),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const gate = await guard(request, {
    policy: "publicRead",
    auth: "optional",
    context: "GET /api/community/posts/[slug]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    return NextResponse.json({ post: await getPost(slug) });
  } catch (error) {
    return communityResponse(error, "Could not load that post.");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const gate = await guard(request, {
    policy: "mutation",
    body: schema,
    context: "POST /api/community/posts/[slug]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    switch (gate.body.action) {
      case "like":
        return NextResponse.json(await setLike(slug, true));
      case "unlike":
        return NextResponse.json(await setLike(slug, false));
      case "unpublish":
        await unpublishPost(slug);
        return NextResponse.json({ published: false });
    }
  } catch (error) {
    return communityResponse(error, "Could not update that post.");
  }
}
