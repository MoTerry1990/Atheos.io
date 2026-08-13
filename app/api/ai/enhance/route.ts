import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/api-guard";
import { enhancePrompt } from "@/services/ai/enhance";

/**
 * Expand a short idea into a full prompt.
 *
 * **POST, not GET**, even though it reads nothing: it costs a provider call,
 * and a GET would be prefetched on link hover and cached by anything between
 * here and the browser.
 *
 * Auth is required despite the call being free. Not for the credits — there are
 * none — but because an unauthenticated text-generation endpoint on a public
 * domain is a free LLM with our name on the invoice, and the rate limiter keys
 * on the caller, which is far weaker for an anonymous IP behind a VPN.
 *
 * Always 200. The service returns the original text when the model is down or
 * throttled, and a failed *assist* is not a failed *request* — the studio must
 * not show an error banner over a prompt the user can still submit.
 */

const schema = z.object({
  prompt: z.string().min(1).max(2000),
  modality: z.enum(["image", "video"]).default("image"),
});

export async function POST(request: NextRequest) {
  const gate = await guard(request, {
    policy: "enhance",
    body: schema,
    context: "POST /api/ai/enhance",
  });
  if (gate instanceof NextResponse) return gate;

  const { prompt, modality } = gate.body;
  const result = await enhancePrompt(prompt, modality);

  return NextResponse.json(result, { headers: gate.headers });
}
