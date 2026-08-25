import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard, withHeaders } from "@/lib/api-guard";
import {
  GenerationError,
  listGenerations,
  submitGeneration,
} from "@/services/generation";
import { isUsingMockProvider, listModels } from "@/services/ai/registry";
import { isAdmin } from "@/services/admin/auth";
import {
  isOfferedToOwner,
  isPubliclyOffered,
} from "@/services/ai/model-policy";
import {
  catalogueModelId,
  toPublicGenerationFrom,
  toPublicModel,
} from "@/features/studio/lib/public-model";
import { toStudioModel } from "@/features/studio/lib/dto";
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
    "text-to-audio",
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
  // Not `.int()`: wan-2.2's longer clip is 121 frames at 16fps, which is 7.5
  // seconds. Rounding it to 8 in the schema would reject the exact value the
  // studio sends for the model's own maximum.
  durationSeconds: z.number().min(1).max(30).optional(),
  cameraMotion: z.string().max(60).optional(),
  parentId: z.string().min(1).optional(),
  collectionId: z.string().min(1).optional(),
  /**
   * Creative Director. Optional in the schema because the flag may be off; the
   * *service* requires them when it is on, which is where the decision belongs
   * — a route schema cannot read a feature flag's runtime state safely.
   */
  /**
   * The image to animate, as an owned asset id.
   *
   * Never a URL. The service resolves it against `Asset.userId` and mints a
   * signed link itself — a URL here would be an instruction to fetch whatever
   * the caller likes on our credentials.
   */
  sourceAssetId: z.string().max(120).optional(),
  planToken: z.string().max(4096).optional(),
  // Shape-checked loosely here and hash-checked against the signed token in
  // the service. Validating its structure twice would not add safety: the hash
  // is what proves it is the brief that was confirmed.
  confirmedBrief: z.unknown().optional(),
  planConfirmed: z.boolean().optional(),
  clientIdempotencyKey: z.string().max(200).optional(),
  /**
   * The composer's inputs, before assembly.
   *
   * Stored alongside the expanded prompt so "reuse settings" can restore what
   * was *typed* rather than what was sent. Bounded like every other free-text
   * field, and the preset list is capped because it is a set of ids, not prose.
   */
  promptSource: z
    .object({
      text: z.string().max(4000),
      presetIds: z.array(z.string().max(120)).max(24),
      camera: z.object({
        shot: z.string().max(120).nullable(),
        angle: z.string().max(120).nullable(),
        lens: z.string().max(120).nullable(),
        lighting: z.string().max(120).nullable(),
      }),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  const gate = await guard(request, {
    policy: "generate",
    body: submitSchema,
    context: "POST /api/generations",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    /**
     * The client speaks public ids; the server speaks catalogue ids.
     *
     * Refused rather than passed through when it does not map. A client that
     * sends `replicate/veo-3.1` is either an old build or someone probing, and
     * accepting it would keep the internal path a working input forever —
     * which is exactly what makes a provider swap a breaking change.
     */
    const catalogueId = catalogueModelId(gate.body.modelId);
    if (!catalogueId) {
      return NextResponse.json(
        { error: "That model is not available.", code: "unknown_model" },
        { status: 400 },
      );
    }

    const result = await submitGeneration({
      ...gate.body,
      modelId: catalogueId,
      // The brief is carried as `unknown` through the schema and proved by the
      // token's hash in the service. Casting here rather than re-validating its
      // shape: a structurally valid brief that is not *the confirmed one* would
      // pass a schema and still be a forgery, and only the hash catches that.
      confirmedBrief: gate.body.confirmedBrief as never,
    });
    return withHeaders(NextResponse.json(result, { status: 202 }), gate);
  } catch (error) {
    if (error instanceof GenerationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        {
          status: error.status,
          /**
           * `Retry-After` on a 429, and only on a 429.
           *
           * A client told to back off with no number either gives up or
           * retries immediately, and both are wrong — the second is what turns
           * one impatient user into the load the limiter was defending
           * against. The value comes from the limiter's own window, so it is
           * the real answer rather than a guess.
           */
          headers: error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : undefined,
        },
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
    const viewerIsOwner = await isAdmin().catch(() => false);

    return withHeaders(
      NextResponse.json({
        /**
         * Public shapes only, both of them.
         *
         * The list carried `providerId` and provider-prefixed ids, and each
         * generation carried `modelId: "replicate/…"`. Measured on the live
         * API before this change: 56 occurrences of the provider's name in a
         * single response a browser receives.
         */
        generations: generations.map((row) =>
          toPublicGenerationFrom(toGenerationDTO(row)),
        ),
        /**
         * Only models this caller may actually run.
         *
         * A model that cannot run must not be advertised, or the picker offers
         * something every submission refuses — and in Score's case it was
         * offered at 20 credits.
         *
         * The owner's list is wider by exactly the owner-evaluation set, and
         * the widening happens here rather than in the client so that a
         * customer's response never even mentions those models exist. It is
         * resolved from the session; a blocked model is in neither list.
         */
        models: listModels()
          .filter((model) =>
            viewerIsOwner
              ? isOfferedToOwner(model.id)
              : isPubliclyOffered(model.id),
          )
          .map((model) => toPublicModel(toStudioModel(model))),
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
