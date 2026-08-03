import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import {
  getItem,
  installItem,
  setFavorite,
  uninstallItem,
} from "@/services/marketplace";
import { marketplaceResponse } from "@/app/api/marketplace/shared";

/**
 * One marketplace item.
 *
 *   GET    the item, with this user's favourite and install state
 *   POST   favourite, unfavourite, install ("download") or uninstall
 *
 * ## One POST with an action, not four routes
 *
 * All four write the same two per-user facts about the same item. Four
 * endpoints would repeat the ownership check and the error mapping four times
 * to express a verb — and the interface calls them from the same two buttons.
 *
 * POST rather than PUT/DELETE on sub-resources: these are user actions on an
 * item, not a resource hierarchy anybody navigates.
 */

const schema = z.object({
  action: z.enum(["favorite", "unfavorite", "install", "uninstall"]),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const gate = await guard(request, {
    policy: "publicRead",
    auth: "optional",
    context: "GET /api/marketplace/[slug]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    return NextResponse.json({ item: await getItem(slug) });
  } catch (error) {
    return marketplaceResponse(error, "Could not load that item.");
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
    context: "POST /api/marketplace/[slug]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    switch (gate.body.action) {
      case "favorite":
        return NextResponse.json(await setFavorite(slug, true));
      case "unfavorite":
        return NextResponse.json(await setFavorite(slug, false));
      case "install":
        return NextResponse.json(await installItem(slug));
      case "uninstall":
        return NextResponse.json(await uninstallItem(slug));
    }
  } catch (error) {
    return marketplaceResponse(error, "Could not update that item.");
  }
}
