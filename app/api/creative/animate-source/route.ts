import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard, withHeaders } from "@/lib/api-guard";
import {
  AnimationSourceError,
  resolveAnimationSource,
} from "@/services/ai/animate-source";
import { creativeDirectorReady } from "@/services/ai/plan-token";

/**
 * "Now make this image a video" — which image?
 *
 *   POST  resolve the picture the user means, or ask them
 *
 * ## What this endpoint refuses to be
 *
 * It never takes a URL. The audited benchmark video ran `TEXT_TO_VIDEO` with
 * `inputImageUrls: []` on a model with no image input, so the reference problem
 * was not "we sent the wrong URL" — nothing was sent at all. The fix is not to
 * let the browser name a file; it is to let the browser name an **asset id** and
 * have the server decide whether that id belongs to the caller.
 *
 * A URL from a client is an instruction to fetch whatever the client likes, on
 * our credentials and our bill. An id is a claim we can check against a row.
 *
 * ## It returns a decision, not a picture
 *
 * `resolved` carries a short-lived signed URL because the *next* step needs one.
 * `choose` carries labels and ids and no URLs at all — a picker does not need
 * fetchable links to every candidate, and minting them would hand out six.
 */

const sourceSchema = z.object({
  /** Opaque and owned. The only thing the browser may name. */
  assetId: z.string().max(120).optional(),
  /** Narrow to one project. Projects are Collections today. */
  collectionId: z.string().max(120).optional(),
});

export async function POST(request: NextRequest) {
  // Same 404-not-403 as the planning endpoint: a disabled feature should not
  // confirm its own existence.
  if (!creativeDirectorReady().ready) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const gate = await guard(request, {
    policy: "read",
    body: sourceSchema,
    context: "POST /api/creative/animate-source",
  });
  if (gate instanceof NextResponse) return gate;

  /**
   * The caller the guard already resolved.
   *
   * Not `requireUser()`. That helper *redirects* a session-less caller to sign
   * in, which is right for a page and wrong for an API route — it would refuse
   * a valid API key with a redirect rather than serve it. The guard has already
   * resolved a session or a key and returned 401 if neither held, so
   * `gate.user` is non-null here and its provisioning branch was unreachable
   * anyway: the guard 401s on a missing row before this line is reached.
   */
  const user = gate.user!;

  try {
    const source = await resolveAnimationSource({
      userId: user.id,
      assetId: gate.body.assetId,
      collectionId: gate.body.collectionId,
    });

    if (source.status === "resolved") {
      /**
       * The signed URL is deliberately not returned to the browser.
       *
       * The client needs to know *that* an image resolved and what it looks
       * like dimensionally, so it can show "animating this picture" and so the
       * planner can reason about shape. It does not need a fetchable link, and
       * returning one would put a credential-bearing URL in a response body for
       * no purpose. Submission re-resolves from the id.
       */
      return withHeaders(
        NextResponse.json({
          status: "resolved",
          assetId: source.assetId,
          width: source.width,
          height: source.height,
          parentGenerationId: source.parentGenerationId,
        }),
        gate,
      );
    }

    return withHeaders(NextResponse.json(source), gate);
  } catch (error) {
    if (error instanceof AnimationSourceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("animate-source failed", error);
    return NextResponse.json(
      { error: "Could not work out which image to animate." },
      { status: 500 },
    );
  }
}
