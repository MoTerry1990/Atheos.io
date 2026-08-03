import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/api-guard";

import { listPosts } from "@/services/community";
import type { GalleryOrder } from "@/services/community/types";
import { communityResponse } from "@/app/api/community/shared";

/**
 * The public gallery.
 *
 * **Public on purpose.** No authentication. Signing in adds `liked`, `mine` and
 * `following` to each item; it is not a condition of seeing published work. A
 * gallery that requires an account before showing anything is a gallery nobody
 * arrives at from a shared link.
 *
 * Cursor pagination rather than page numbers: the default ordering is recency,
 * and new posts arriving mid-scroll shift every offset and duplicate rows
 * across pages.
 */

const ORDERS = ["trending", "recent", "featured"] as const;

const querySchema = z.object({
  // Unknown values fall back to "recent" rather than 400ing: this is a public
  // gallery reached from links, and a stale bookmark should still render.
  order: z.enum(ORDERS).catch("recent"),
  handle: z.string().max(64).optional(),
  following: z.string().max(4).optional(),
  cursor: z.string().max(64).optional(),
});

export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "publicRead",
    auth: "optional",
    query: querySchema,
    context: "GET /api/community/posts",
  });
  if (gate instanceof NextResponse) return gate;

  const order: GalleryOrder = gate.query.order;

  try {
    return NextResponse.json(
      await listPosts({
        order,
        handle: gate.query.handle,
        following: gate.query.following === "1",
        cursor: gate.query.cursor,
      }),
    );
  } catch (error) {
    return communityResponse(error, "Could not load the gallery.");
  }
}
