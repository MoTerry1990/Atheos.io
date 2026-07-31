import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

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
 */

const submitSchema = z.object({
  operation: z.enum([
    "text-to-image",
    "image-to-image",
    "upscale",
    "remove-background",
    "variations",
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
  parentId: z.string().min(1).optional(),
  collectionId: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400 },
    );
  }

  const parsed = submitSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Those settings are not valid.",
        // Field-level detail so the studio can point at the offending control
        // rather than showing a generic banner.
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const result = await submitGeneration(parsed.data);
    return NextResponse.json(result, { status: 202 });
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

export async function GET() {
  try {
    const generations = await listGenerations();

    return NextResponse.json({
      generations: generations.map(toGenerationDTO),
      models: listModels(),
      usingMockProvider: isUsingMockProvider(),
    });
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
