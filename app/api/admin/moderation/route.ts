import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import {
  listReported,
  resolveReport,
  setFeatured,
  unpublishPost,
} from "@/services/admin/moderation";
import { adminResponse } from "@/app/api/admin/shared";

/**
 * The moderation queue.
 *
 *   GET   reported comments, oldest first
 *   POST  remove, dismiss, unpublish a post, or feature one
 *
 * Every action needs a reason. Dismissing included: "reviewed, nothing wrong"
 * is a decision, and one nobody recorded is indistinguishable from a report
 * nobody read.
 */

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["remove", "dismiss"]),
    commentId: z.string().min(1),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("unpublish"),
    slug: z.string().min(1),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("feature"),
    slug: z.string().min(1),
    featured: z.boolean(),
    reason: z.string().trim().max(500).default(""),
  }),
]);

export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "admin",
    // Non-admins get 404 here, before any input is parsed — see the note on
    // `admin` in lib/api-guard.ts.
    auth: "optional",
    admin: true,
    context: "GET /api/admin/moderation",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    return NextResponse.json({ reports: await listReported() });
  } catch (error) {
    return adminResponse(error, "Could not load the moderation queue.");
  }
}

export async function POST(request: NextRequest) {
  const gate = await guard(request, {
    policy: "admin",
    // Non-admins get 404 here, before any input is parsed — see the note on
    // `admin` in lib/api-guard.ts. `auth: "optional"` so the guard itself never
    // 401s, which would confirm the route exists.
    auth: "optional",
    admin: true,
    body: schema,
    context: "POST /api/admin/moderation",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    switch (gate.body.action) {
      case "remove":
      case "dismiss":
        return NextResponse.json(
          await resolveReport({
            commentId: gate.body.commentId,
            action: gate.body.action,
            reason: gate.body.reason,
          }),
        );
      case "unpublish":
        return NextResponse.json(
          await unpublishPost({
            slug: gate.body.slug,
            reason: gate.body.reason,
          }),
        );
      case "feature":
        return NextResponse.json(
          await setFeatured({
            slug: gate.body.slug,
            featured: gate.body.featured,
            reason: gate.body.reason,
          }),
        );
    }
  } catch (error) {
    return adminResponse(error, "Could not apply that.");
  }
}
