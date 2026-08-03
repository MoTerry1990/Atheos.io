import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import { deleteComment, reportComment } from "@/services/community";
import { communityResponse } from "@/app/api/community/shared";

/**
 * One comment.
 *
 *   DELETE  remove it — the comment's author, or the post's
 *   POST    report it
 *
 * Report is a POST rather than a DELETE because reporting removes nothing. It
 * sets a timestamp for a human to look at, and the interface says plainly that
 * there is no automated moderation — a report button that implies review nobody
 * performs is worse than none, because it tells somebody the problem is handled.
 */

const schema = z.object({ action: z.literal("report") });

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gate = await guard(request, {
    policy: "mutation",
    context: "DELETE /api/community/comments/[id]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    await deleteComment(id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return communityResponse(error, "Could not remove that comment.");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gate = await guard(request, {
    policy: "mutation",
    body: schema,
    context: "POST /api/community/comments/[id]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    await reportComment(id);
    return NextResponse.json({ reported: true });
  } catch (error) {
    return communityResponse(error, "Could not report that comment.");
  }
}
