import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import { publishAsset, setCollectionShared } from "@/services/community";
import { communityResponse } from "@/app/api/community/shared";

/**
 * Publishing.
 *
 * Two things can go public and they are separate decisions: one generated
 * result, or a whole project. Sharing a project does **not** publish what is
 * inside it — the shared view shows only assets that were themselves published,
 * enforced in the service.
 *
 * `showPrompt` is a third, separate decision. The prompt is the part people
 * most want to see and the part a professional is most likely to consider their
 * method.
 */

const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("asset"),
    assetId: z.string().min(1),
    caption: z.string().max(600).optional(),
    showPrompt: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("collection"),
    collectionId: z.string().min(1),
    shared: z.boolean(),
  }),
]);

export async function POST(request: NextRequest) {
  const gate = await guard(request, {
    policy: "mutation",
    body: schema,
    context: "POST /api/community/publish",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    if (gate.body.kind === "asset") {
      return NextResponse.json(
        await publishAsset({
          assetId: gate.body.assetId,
          caption: gate.body.caption,
          showPrompt: gate.body.showPrompt,
        }),
        { status: 201 },
      );
    }

    return NextResponse.json(
      await setCollectionShared(gate.body.collectionId, gate.body.shared),
    );
  } catch (error) {
    return communityResponse(error, "Could not publish that.");
  }
}
