import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard, withHeaders } from "@/lib/api-guard";
import {
  GenerationError,
  listGenerations,
  submitGeneration,
} from "@/services/generation";
import { isUsingMockProvider, listModels } from "@/services/ai/registry";
import { toGenerationDTO } from "@/features/studio/lib/dto";

/**
 * Generations API.
 *
 *   POST  submit a new generation
 *   GET   list this user's generations, plus the available models
 *
 * ## Authorisation is in the service, not here
 *
 * Every function in `services/generation.ts` calls `requireUser()` itself. That
 * is the Sprint 3 rule — layouts do not run for route handlers, so a route that
 * trusts middleware is one matcher edit away from being open. This file
 * validates input and shapes responses; it does not decide who may call it.
 *
 * ## Input is validated, not trusted
 *
 * A client can send anything. Zod rejects the shape, and the service rejects the
 * *semantics* — whether the model exists, whether it supports the operation,
 * whether the user can afford it. Both layers are necessary: schema validation
 * cannot know a credit balance.
 *
 * ## This is the most rate-limited endpoint in the product
 *
 * Every POST here spends credits and provider quota, and the credit check is
 * not a defence against volume — a user with a large balance can still burn our
 * provider allowance, and a user with none still costs us the round trip. The
 * `generate` policy allows twelve a minute, which is far more than anyone can
 * evaluate results at and far less than a loop needs.
 *
 * Rate-limit headers are echoed on success as well as on rejection, because the
 * studio polls: a client that can read `RateLimit-Remaining` can slow down on
 * its own instead of discovering the limit by hitting it.
 */

const submitSchema = z.object({
  operation: z.enum([
    "text-to-image",
    "image-to-image",
    "upscale",
    "remove-background",
    "variations",
    "text-to-video",
    "image-to-video",
  ]),
  modelId: z.string().min(1),
  // Capped rather than unbounded: an unbounded prompt is a cheap way to make
  // us pay to forward megabytes to a provider.
  prompt: z.string().max(4000).default(""),
  negativePrompt: z.string().max(2000).optional(),
  aspectRatio: z.string().max(12).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
  outputs: z.number().int().min(1).max(8).optional(),
  inputImageUrls: z.array(z.string().url()).max(4).optional(),
  inputStrength: z.number().min(0).max(1).optional(),
  scale: z.number().int().min(2).max(4).optional(),
  // Bounded well below any provider maximum. An unbounded duration is a cheap
  // way to run up a bill on our account.
  durationSeconds: z.number().int().min(1).max(30).optional(),
  cameraMotion: z.string().max(60).optional(),
  parentId: z.string().min(1).optional(),
  collectionId: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  const gate = await guard(request, {
    policy: "generate",
    body: submitSchema,
    context: "POST /api/generations",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const result = await submitGeneration(gate.body);
    return withHeaders(NextResponse.json(result, { status: 202 }), gate);
  } catch (error) {
    if (error instanceof GenerationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    // Never surface a raw exception: it can contain provider internals or our
    // own credentials.
    console.error("generation submit failed", error);
    return NextResponse.json(
      { error: "Something went wrong starting that generation." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    policy: "read",
    context: "GET /api/generations",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const generations = await listGenerations();

    return withHeaders(
      NextResponse.json({
        generations: generations.map(toGenerationDTO),
        models: listModels(),
        usingMockProvider: isUsingMockProvider(),
      }),
      gate,
    );
  } catch (error) {
    if (error instanceof GenerationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("generation list failed", error);
    return NextResponse.json(
      { error: "Could not load your generations." },
      { status: 500 },
    );
  }
}
