import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/api-guard";

import {
  categoryCounts,
  listItems,
  type MarketplaceView,
} from "@/services/marketplace";
import { CATEGORIES } from "@/services/marketplace/types";
import { marketplaceResponse } from "@/app/api/marketplace/shared";
import type { MarketplaceKind } from "@/lib/generated/prisma/enums";

/**
 * Browse the marketplace.
 *
 * ## Public
 *
 * No authentication required. Signing in adds favourite and install state to
 * each item; it is not a condition of seeing what is on offer. A marketplace
 * nobody can look at before registering is a marketplace nobody registers for.
 *
 * The `favorites` and `installed` views are the exception in practice — they
 * return nothing for a signed-out caller, which is correct rather than an
 * error: they have no favourites.
 *
 * ## Categories come back with the items
 *
 * The filter row and the grid render together. Two endpoints would mean two
 * round trips and a window where the counts describe a different filter than
 * the results.
 */

const KINDS = [
  "TEMPLATE",
  "PROMPT_PACK",
  "STYLE_PACK",
  "CHARACTER",
  "VOICE_PACK",
] as const;

const VIEWS = ["all", "favorites", "installed"] as const;

const querySchema = z.object({
  // `.catch` rather than a hard failure, for the same reason as the gallery:
  // these are shareable URLs and an unknown facet should degrade to the
  // default view, not to an error page.
  kind: z.enum(KINDS).optional().catch(undefined),
  category: z.enum(CATEGORIES).optional().catch(undefined),
  view: z.enum(VIEWS).catch("all"),
  // Search reaches a Prisma `contains` filter, which cannot use a B-tree index.
  // Prisma parameterises, so this is not injection — it is a sequential scan
  // somebody else pays for. Bounded so one request cannot ask for an unbounded
  // one, and rate limiting bounds how often they can ask.
  q: z.string().trim().max(120).optional(),
});

export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "publicRead",
    auth: "optional",
    query: querySchema,
    context: "GET /api/marketplace",
  });
  if (gate instanceof NextResponse) return gate;

  const kind: MarketplaceKind | undefined = gate.query.kind;
  const category: string | undefined = gate.query.category;
  const view: MarketplaceView = gate.query.view;

  try {
    const items = await listItems({
      kind,
      category,
      search: gate.query.q,
      view,
    });

    return NextResponse.json({
      items,
      // Counts are for the *kind* currently selected, not the whole catalogue —
      // otherwise the row offers categories that would return nothing.
      categories: categoryCounts(kind),
      view,
    });
  } catch (error) {
    return marketplaceResponse(error, "Could not load the marketplace.");
  }
}
