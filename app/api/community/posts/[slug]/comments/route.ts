import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import { addComment, listComments } from "@/services/community";
import { communityResponse } from "@/app/api/community/shared";

/**
 * Comments on a post.
 *
 * The body is capped at 2,000 characters. Not a guess at what somebody wants to
 * say — an unbounded text column reachable by anyone with an account is a
 * storage-exhaustion vector, and a comment that long is not a comment.
 */

const schema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const gate = await guard(request, {
    policy: "publicRead",
    auth: "optional",
    context: "GET /api/community/posts/[slug]/comments",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    return NextResponse.json({ comments: await listComments(slug) });
  } catch (error) {
    return communityResponse(error, "Could not load the comments.");
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
    context: "POST /api/community/posts/[slug]/comments",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const comment = await addComment(slug, gate.body.body);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return communityResponse(error, "Could not post that comment.");
  }
}
