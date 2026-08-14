import "server-only";

import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { estimateCost } from "@/services/ai/cost";
import {
  findModel,
  isUsingMockProvider,
  priceFor,
  providerForModel,
} from "@/services/ai/registry";
import {
  OPERATIONS_REQUIRING_INPUT,
  type GenerationOperation,
  type GenerationOutput,
  type GenerationRequest,
  type ProviderError,
} from "@/services/ai/types";
import {
  isStorageConfigured,
  storeGeneratedAsset,
} from "@/services/storage/assets";
import type {
  AssetKind,
  GenerationOperation as DbOperation,
} from "@/lib/generated/prisma/enums";

/**
 * The generation pipeline.
 *
 * Everything between "the user pressed Generate" and "there is an asset in
 * their library". The interesting parts are all about money and durability:
 *
 *   submit    validate → debit credits → call provider → persist the job
 *   poll      ask the provider → on success copy to storage → on failure refund
 *
 * ## Why credits are debited before the provider is called
 *
 * The alternative — charge on success — sounds fairer and is unworkable. A
 * provider call that succeeds while our response is lost would produce work we
 * never charged for, and there is no way to reconcile it afterwards. Debiting
 * first means the worst case is a refund, which is a recoverable state we
 * control.
 *
 * The debit and the generation row commit in **one transaction**. A debit with
 * no generation is theft; a generation with no debit is free inference.
 *
 * ## Refunds are idempotent
 *
 * A failing job may be polled many times — by several open tabs, or by a client
 * retrying. The refund carries `idempotencyKey = refund:{generationId}`, which
 * is unique-constrained, so the second attempt is rejected by the database
 * rather than by application logic somebody forgets to write.
 */

const OPERATION_TO_DB: Record<GenerationOperation, DbOperation> = {
  "text-to-image": "TEXT_TO_IMAGE",
  "image-to-image": "IMAGE_TO_IMAGE",
  upscale: "UPSCALE",
  "remove-background": "REMOVE_BACKGROUND",
  variations: "VARIATIONS",
  "text-to-video": "TEXT_TO_VIDEO",
  "image-to-video": "IMAGE_TO_VIDEO",
  "text-to-audio": "TEXT_TO_AUDIO",
};

/**
 * The signed-in user, or a 401.
 *
 * Deliberately **not** `requireUser()`. That helper redirects, which is correct
 * for a page and wrong for an API: a JSON client asking to generate would get a
 * 307 pointing at an HTML sign-in page, and would report it as a parse error
 * rather than as "you are signed out".
 *
 * Same guarantee, different failure mode for a different caller.
 */
export class GenerationError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly code: string = "invalid_request",
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

export interface SubmitInput {
  operation: GenerationOperation;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  seed?: number;
  outputs?: number;
  inputImageUrls?: string[];
  inputStrength?: number;
  scale?: number;
  durationSeconds?: number;
  cameraMotion?: string;
  /** Generation this derives from, for lineage. */
  parentId?: string;
  /** Collection to file the results into on success. */
  collectionId?: string;
}

/** Submit a generation. Returns the persisted job id. */
export async function submitGeneration(input: SubmitInput) {
  const user = await requireApiUser();

  const model = findModel(input.modelId);
  if (!model) {
    throw new GenerationError(
      "That model is not available.",
      400,
      "unknown_model",
    );
  }

  if (!model.capabilities.operations.includes(input.operation)) {
    throw new GenerationError(
      `${model.displayName} cannot perform that operation.`,
      400,
      "unsupported_operation",
    );
  }

  if (
    OPERATIONS_REQUIRING_INPUT.has(input.operation) &&
    !(input.inputImageUrls ?? []).length
  ) {
    throw new GenerationError(
      "This operation needs a source image.",
      400,
      "missing_input",
    );
  }

  // Checked *before* spending anything. Finding out storage is misconfigured
  // after the provider has run is the expensive order to discover it.
  if (!isStorageConfigured()) {
    throw new GenerationError(
      "Storage is not configured, so results could not be saved. Generation is disabled.",
      503,
      "storage_unavailable",
    );
  }

  const provider = providerForModel(input.modelId);
  if (!provider) {
    throw new GenerationError(
      "No provider is configured for that model.",
      503,
      "provider_unavailable",
    );
  }

  const outputs = Math.min(
    Math.max(1, input.outputs ?? 1),
    model.capabilities.maxOutputs,
  );

  const durationSeconds = resolveDuration(model, input.durationSeconds);
  const cost = priceFor(input.modelId, outputs, durationSeconds);

  if (user.creditBalance < cost) {
    throw new GenerationError(
      `This needs ${cost} credits and you have ${user.creditBalance}.`,
      402,
      "insufficient_credits",
    );
  }

  // Debit and record together, or not at all.
  const generation = await prisma.$transaction(async (tx) => {
    const created = await tx.generation.create({
      data: {
        userId: user.id,
        modality: model.modality,
        operation: OPERATION_TO_DB[input.operation],
        provider: model.providerId,
        model: model.id,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt || null,
        parentId: input.parentId ?? null,
        // Stored verbatim so a generation can be replayed exactly, even after
        // our own parameter mapping changes.
        parameters: {
          operation: input.operation,
          aspectRatio: input.aspectRatio,
          seed: input.seed,
          outputs,
          inputImageUrls: input.inputImageUrls ?? [],
          inputStrength: input.inputStrength,
          scale: input.scale,
          durationSeconds,
          cameraMotion: input.cameraMotion,
          collectionId: input.collectionId,
        },
        creditsCost: cost,
        status: "QUEUED",
      },
    });

    const updated = await tx.user.update({
      where: { id: user.id },
      data: { creditBalance: { decrement: cost } },
    });

    await tx.creditTransaction.create({
      data: {
        userId: user.id,
        amount: -cost,
        reason: "GENERATION_SPEND",
        balanceAfter: updated.creditBalance,
        generationId: created.id,
        idempotencyKey: `spend:${created.id}`,
      },
    });

    return created;
  });

  // Provider call happens *outside* the transaction. Holding a database
  // transaction open across a network call to a third party is how connection
  // pools get exhausted by one slow vendor.
  try {
    const request: GenerationRequest = {
      operation: input.operation,
      modelId: input.modelId,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      aspectRatio: input.aspectRatio,
      seed: input.seed,
      outputs,
      inputImageUrls: input.inputImageUrls,
      inputStrength: input.inputStrength,
      scale: input.scale,
      durationSeconds,
      cameraMotion: input.cameraMotion,
    };

    const job = await provider.submit(request);

    await prisma.generation.update({
      where: { id: generation.id },
      data: {
        providerJobId: job.providerJobId,
        status: job.state === "running" ? "RUNNING" : "QUEUED",
        startedAt: new Date(),
      },
    });

    // A synchronous provider (OpenAI) is already finished. Settle it now rather
    // than making the client poll for something we already have.
    if (job.state === "succeeded" && job.outputs?.length) {
      await settleSuccess(generation.id, user.id, job.outputs, input);
    }

    return {
      generationId: generation.id,
      usingMockProvider: isUsingMockProvider(),
    };
  } catch (error) {
    const providerFailure = error as ProviderError;
    await failGeneration(
      generation.id,
      providerFailure?.message ?? "The generation could not be started.",
    );
    throw new GenerationError(
      providerFailure?.message ?? "The generation could not be started.",
      502,
      providerFailure?.code ?? "provider_error",
    );
  }
}

/**
 * Refund, once.
 *
 * The unique `idempotencyKey` is what makes "once" true. Without it, a job
 * polled by three open tabs refunds three times.
 */
async function refund(generationId: string, userId: string, amount: number) {
  if (amount <= 0) return;

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { creditBalance: { increment: amount } },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          amount,
          reason: "GENERATION_REFUND",
          balanceAfter: updated.creditBalance,
          generationId,
          idempotencyKey: `refund:${generationId}`,
        },
      });
    });
  } catch {
    // Unique violation: already refunded. Not an error — it is the constraint
    // doing exactly its job.
  }
}

async function failGeneration(generationId: string, message: string) {
  const generation = await prisma.generation.findUnique({
    where: { id: generationId },
    select: { id: true, userId: true, creditsCost: true, status: true },
  });
  if (!generation || generation.status === "FAILED") return;

  await prisma.generation.update({
    where: { id: generationId },
    data: { status: "FAILED", error: message, completedAt: new Date() },
  });

  await refund(generationId, generation.userId, generation.creditsCost);
}

/**
 * The clip length we will actually generate and charge for.
 *
 * Snapped to a duration the model declares, not merely bounded. The request
 * schema caps duration at 30s, which stops the obvious abuse but still lets a
 * client ask a 5-or-10-second model for 7 — and a provider handed 7 will round
 * it silently, so the user gets a clip they did not choose at a price that does
 * not match it. Snapping here makes the stored parameters, the charge and the
 * output describe the same thing.
 *
 * Returns undefined for image models, so nothing about video leaks into an
 * image request.
 */
function resolveDuration(
  model: { capabilities: { durations?: readonly number[] } },
  requested: number | undefined,
): number | undefined {
  const durations = model.capabilities.durations;
  if (!durations?.length) return undefined;
  if (requested === undefined) return Math.min(...durations);

  return durations.reduce((best, option) =>
    Math.abs(option - requested) < Math.abs(best - requested) ? option : best,
  );
}

function assetKindFor(mimeType: string): AssetKind {
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  if (mimeType.startsWith("image/")) return "IMAGE";
  return "OTHER";
}

/** Copy outputs into storage, record the assets, mark the job succeeded. */
/**
 * Store the outputs, record the assets, price the job and mark it succeeded.
 *
 * Exported because **the worker needs it too**, and until Sprint 26 it did not
 * have it. `services/worker/runner.ts` called `markSucceeded`, which only sets
 * `status: "SUCCEEDED"` — it never downloaded the provider's output, never
 * wrote it to R2, never created the `assets` rows and never recorded the cost.
 * A job advanced by the worker therefore reported success with nothing attached
 * and no cost accounted for. Nobody noticed because the worker had never run.
 *
 * One implementation, two callers: the client-driven poll and the worker.
 * Duplicating settlement would mean two places that could disagree about what
 * "succeeded" means, on the path that spends money.
 */
export async function settleSuccess(
  generationId: string,
  userId: string,
  // The provider contract's own output type rather than a structural copy of
  // it. The copy drifted the moment video added `durationMs`, which is the
  // argument against restating a type you already import.
  outputs: readonly GenerationOutput[],
  input?: Pick<SubmitInput, "collectionId">,
) {
  const stored: {
    asset: Awaited<ReturnType<typeof storeGeneratedAsset>>;
    output: (typeof outputs)[number];
  }[] = [];

  for (const output of outputs) {
    // Sequential rather than parallel: a batch of four large files fetched at
    // once is the shape most likely to hit a serverless memory ceiling, and
    // the latency saved is not worth the failure mode.
    const asset = await storeGeneratedAsset({
      userId,
      generationId,
      sourceUrl: output.sourceUrl,
      mimeType: output.mimeType,
    });
    stored.push({ asset, output });
  }

  await prisma.$transaction(async (tx) => {
    for (const { asset, output } of stored) {
      const created = await tx.asset.create({
        data: {
          userId,
          generationId,
          kind: assetKindFor(asset.mimeType),
          source: "GENERATED",
          storageKey: asset.storageKey,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          width: output.width ?? null,
          height: output.height ?? null,
          durationMs: output.durationMs ?? null,
          checksum: asset.checksum,
        },
      });

      // Project saving: file the result straight into a collection when the
      // request asked for one.
      if (input?.collectionId) {
        await tx.collectionAsset
          .create({
            data: { collectionId: input.collectionId, assetId: created.id },
          })
          .catch(() => undefined);
      }
    }

    /**
     * Record what this generation cost us, and the units of work behind it.
     *
     * Sprint 19 added these columns and its own report closed with "nothing
     * writes the telemetry columns yet — until the pipeline writes them, this
     * sprint's persistence work is a schema with nothing in it". This is the
     * line that closes that.
     *
     * Written in the **same transaction** as the status change. A generation
     * that is SUCCEEDED but has no cost row is a hole in the margin report that
     * nothing will ever fill, because the provider response is gone by then.
     *
     * Counts are derived from what was actually stored, not from what was
     * requested. A model that returned three images when four were asked for
     * costs three, and a report built on the request would overstate it.
     */
    const images = stored.filter(
      ({ asset }) => assetKindFor(asset.mimeType) === "IMAGE",
    ).length;

    const generationRow = await tx.generation.findUnique({
      where: { id: generationId },
      select: { model: true, parameters: true },
    });

    /**
     * Seconds of video produced.
     *
     * Preferred from the provider, which knows the truth. **Falls back to the
     * duration the user asked for**, because most providers — Replicate among
     * them — return a URL and nothing else.
     *
     * Without the fallback this was always 0, and since video is priced
     * per second (`perSecondMicroUsd`) that made every clip cost
     * `90_000 x 0 = 0`. The cost engine recorded video as **free**, which is
     * the one number a margin report cannot survive being wrong about, and it
     * was wrong in the flattering direction.
     *
     * The requested duration is a good fallback: it is what the model was
     * asked for and what the user was charged for, so a mismatch between it
     * and the delivered clip is a provider bug worth seeing rather than
     * quietly absorbing.
     */
    const reportedSeconds = stored.reduce(
      (total, { output }) =>
        total + Math.round((output.durationMs ?? 0) / 1000),
      0,
    );

    const requestedSeconds =
      (generationRow?.parameters as { durationSeconds?: number } | null)
        ?.durationSeconds ?? 0;

    const videoSeconds =
      reportedSeconds > 0
        ? reportedSeconds
        : // Only for video: an image job has no duration and must stay 0 so
          // "no video" and "a zero-length video" remain distinguishable.
          assetKindFor(stored[0]?.asset.mimeType ?? "") === "VIDEO"
          ? requestedSeconds * stored.length
          : 0;

    // The model is read from the row rather than threaded through the
    // signature: `settleSuccess` is called from two places and both already
    // have the generation id, so a parameter would be the same lookup written
    // twice. `findModel` returns null for a model that has since been retired,
    // in which case the cost is genuinely unknown and recorded as null.

    const model = generationRow ? findModel(generationRow.model) : null;

    const cost = model
      ? estimateCost(model, stored.length, {
          durationSeconds: videoSeconds || undefined,
        })
      : { costMicroUsd: null };

    await tx.generation.update({
      where: { id: generationId },
      data: {
        status: "SUCCEEDED",
        completedAt: new Date(),
        // Null when the model has no cost basis. Never zero — a zero here
        // would make an unpriced model the most profitable in the report.
        costMicroUsd: cost.costMicroUsd,
        // Null rather than 0 for a modality this job did not produce, so
        // "no images" and "not an image job" stay distinguishable in a SUM.
        imageCount: images || null,
        videoSeconds: videoSeconds || null,
        // Release the worker lease in the same write that marks the job done.
        //
        // Only the worker ever sets these; on the client-driven path they are
        // already null and this is a no-op. Doing it here rather than in a
        // second update is what makes settlement atomic: a crash between
        // "SUCCEEDED" and "lease released" would leave a finished job that
        // `claimJobs` still considers locked, and it would sit until the lease
        // expired five minutes later for no reason.
        progress: 100,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null,
      },
    });
  });
}

/**
 * Poll a generation and advance it.
 *
 * Scoped by the signed-in user — the id alone is never enough to read someone
 * else's job. This is the IDOR that a "just look it up by id" implementation
 * would have.
 */
export async function pollGeneration(generationId: string) {
  const user = await requireApiUser();

  const generation = await prisma.generation.findFirst({
    where: { id: generationId, userId: user.id },
    include: {
      assets: {
        where: { deletedAt: null },
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          durationMs: true,
        },
      },
    },
  });

  if (!generation) {
    throw new GenerationError("Generation not found.", 404, "not_found");
  }

  // Terminal states need no provider call.
  if (
    generation.status === "SUCCEEDED" ||
    generation.status === "FAILED" ||
    generation.status === "CANCELED"
  ) {
    return generation;
  }

  const provider = providerForModel(generation.model);
  if (!provider || !generation.providerJobId) {
    await failGeneration(generation.id, "The provider is no longer available.");
    return prisma.generation.findFirstOrThrow({
      where: { id: generationId },
      include: { assets: true },
    });
  }

  const job = await provider.poll(generation.providerJobId);

  if (job.state === "succeeded" && job.outputs?.length) {
    const parameters = generation.parameters as {
      collectionId?: string;
    } | null;
    await settleSuccess(generation.id, user.id, job.outputs, {
      collectionId: parameters?.collectionId,
    });
  } else if (job.state === "failed") {
    await failGeneration(
      generation.id,
      job.error?.message ?? "The generation failed.",
    );
  } else if (job.state === "canceled") {
    await prisma.generation.update({
      where: { id: generation.id },
      data: { status: "CANCELED", completedAt: new Date() },
    });
    await refund(generation.id, user.id, generation.creditsCost);
  } else if (job.state === "running" && generation.status !== "RUNNING") {
    await prisma.generation.update({
      where: { id: generation.id },
      data: { status: "RUNNING" },
    });
  }

  return prisma.generation.findFirstOrThrow({
    where: { id: generationId },
    include: {
      assets: {
        where: { deletedAt: null },
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          durationMs: true,
        },
      },
    },
  });
}

/** Cancel a running generation and refund it. */
export async function cancelGeneration(generationId: string) {
  const user = await requireApiUser();

  const generation = await prisma.generation.findFirst({
    where: { id: generationId, userId: user.id },
  });
  if (!generation) {
    throw new GenerationError("Generation not found.", 404, "not_found");
  }
  if (generation.status === "SUCCEEDED" || generation.status === "FAILED") {
    return generation;
  }

  const provider = providerForModel(generation.model);
  if (provider?.cancel && generation.providerJobId) {
    // Best effort. The user's intent is honoured locally regardless of whether
    // the vendor supports cancellation.
    await provider.cancel(generation.providerJobId).catch(() => undefined);
  }

  await prisma.generation.update({
    where: { id: generation.id },
    data: { status: "CANCELED", completedAt: new Date() },
  });

  await refund(generation.id, user.id, generation.creditsCost);

  return prisma.generation.findFirstOrThrow({ where: { id: generationId } });
}

/** Recent generations for the signed-in user, newest first. */
export async function listGenerations(limit = 40) {
  const user = await requireApiUser();

  return prisma.generation.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      assets: {
        where: { deletedAt: null },
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          durationMs: true,
        },
      },
    },
  });
}
