import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/api-guard";
import { submitScene } from "@/services/sequences";
import { errorResponse } from "@/lib/api-response";

/**
 * Submit the next shot in a sequence.
 *
 * Called once per shot by the browser, which extracts the last frame of the
 * previous clip, uploads it, and passes the URL here. That round trip is why
 * the chain is client-driven: the frame comes from the ffmpeg build running in
 * the page, and the provider needs a URL it can fetch.
 *
 * `policy: "generate"` — each call spends credits on a video clip.
 */

const schema = z.object({
  index: z.number().int().min(0).max(63),
  modelId: z.string().min(1),
  clipSeconds: z.number().min(1).max(30),
  aspectRatio: z.string().max(16).optional(),
  /**
   * Storage key of the previous clip's final frame, from `/api/uploads`.
   *
   * A **key**, not a URL. The provider fetches whatever we hand it, so
   * accepting a URL would turn this endpoint into a request forwarder aimed at
   * anything the caller names — an SSRF with our credentials on it. The
   * absolute URL is built server-side from our own bucket, so the only thing a
   * caller can point at is an object in our storage.
   */
  frameKey: z
    .string()
    .max(512)
    .regex(/^[\w./-]+$/)
    .optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await guard(request, {
    policy: "generate",
    auth: "required",
    body: schema,
    context: "POST /api/sequences/[id]/scenes",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const { id } = await params;
    const { index, ...options } = gate.body;

    return NextResponse.json(await submitScene(id, index, options), {
      headers: gate.headers,
    });
  } catch (error) {
    return errorResponse(error, "POST /api/sequences/[id]/scenes");
  }
}
