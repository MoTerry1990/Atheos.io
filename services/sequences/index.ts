import "server-only";

import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { requireApiUser } from "@/lib/auth";
import { findModel } from "@/services/ai/registry";
import { catalogueModelId } from "@/services/ai/public-ids";
import { creditsFor } from "@/services/ai/pricing";
import { pollGeneration, submitGeneration } from "@/services/generation";

/**
 * Sequences — long-form video, chained shot by shot.
 *
 * No model generates two minutes in one call; the ceiling is 7.5 to 12 seconds.
 * Every product that appears to make long AI video is stitching, and this is
 * where Atheos does it. `SEQUENCES_SPEC.md` has the arithmetic behind the
 * two-minute cap — briefly: sixteen clips is about half an hour of rendering,
 * and past that independently generated clips drift far enough that the end of
 * the video is a different film from the start.
 *
 * ## Scenes are ordinary generations
 *
 * A clip goes through `submitGeneration` like anything else, so it inherits
 * credits, retries, refunds, R2 storage and the worker. A Sequence is a
 * container and an ordering. Building a second pipeline for it would have
 * meant a parallel implementation of the most expensive code in the product.
 *
 * ## Shots are chained, not generated in parallel
 *
 * Each shot after the first starts from the **last frame of the one before
 * it**, passed as an image-to-video input. That is the difference between one
 * continuous piece and six clips of six different people wearing the same
 * jumper — a shared seed constrains style, but carries no face, room or light
 * direction between clips.
 *
 * The consequence is that a sequence is necessarily serial: shot three cannot
 * start until shot two has rendered. Slower than firing them all at once, and
 * the only way to get continuity out of models that have no memory between
 * calls.
 *
 * ## Credits are spent per shot, as it is submitted
 *
 * There is no "reserve" concept in the ledger and adding one would mean a new
 * transaction type, a new expiry, and a new way for credits to get stuck. Each
 * shot is an ordinary generation with the existing automatic refund, so a
 * sequence that breaks halfway refunds the failures and keeps what worked.
 *
 * The affordability check still runs first against the *whole* sequence, so
 * nobody starts sixteen shots with credits for four and finds out on shot five.
 */

export class SequenceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly code: string = "sequence_error",
  ) {
    super(message);
    this.name = "SequenceError";
  }
}

/** The cap, and the reason it is not higher, are in SEQUENCES_SPEC.md. */
export const MAX_SEQUENCE_SECONDS = 120;
export const MAX_SCENES = 16;

export interface CreateSequenceInput {
  title?: string;
  modelId: string;
  /** One prompt per shot, in cut order. */
  scenes: string[];
  aspectRatio?: string;
  /** Seconds per clip. Must be one the model actually offers. */
  clipSeconds: number;
  /**
   * Shared across every clip.
   *
   * The single most effective coherence measure available: same seed with a
   * different prompt keeps lighting and style from wandering between shots.
   * Generated when absent rather than left undefined, because "no seed" means
   * a different random one per clip, which is the failure this prevents.
   */
  seed?: number;
}

export async function createSequence(input: CreateSequenceInput) {
  const user = await requireApiUser();

  /**
   * The client sends a public id, and only a public id.
   *
   * `catalogueModelId` refuses a `provider/model` path outright, which is the
   * point: accepting one here would have kept the internal path a working
   * input on a route the studio's own contract had already closed, and a
   * provider swap would then break sequences alone.
   */
  const catalogueId = catalogueModelId(input.modelId);
  const model = catalogueId ? findModel(catalogueId) : undefined;
  if (!model || model.modality !== "VIDEO") {
    throw new SequenceError("That model does not generate video.", 400);
  }

  const prompts = input.scenes.map((p) => p.trim()).filter(Boolean);

  if (prompts.length === 0) {
    throw new SequenceError("A sequence needs at least one scene.", 400);
  }
  if (prompts.length > MAX_SCENES) {
    throw new SequenceError(
      `A sequence is capped at ${MAX_SCENES} scenes. Split it into two.`,
      400,
    );
  }

  const durations = model.capabilities.durations ?? [];
  if (durations.length > 0 && !durations.includes(input.clipSeconds)) {
    throw new SequenceError(
      `${model.displayName} generates ${durations.join(" or ")} second clips.`,
      400,
    );
  }

  const totalSeconds = prompts.length * input.clipSeconds;
  if (totalSeconds > MAX_SEQUENCE_SECONDS) {
    throw new SequenceError(
      `That is ${totalSeconds} seconds. The cap is ${MAX_SEQUENCE_SECONDS}.`,
      400,
    );
  }

  // Priced with the same function the studio quotes from, so the estimate and
  // the debit cannot disagree — the one place a rounding difference becomes a
  // billing dispute.
  const perClip = creditsFor(model, 1, input.clipSeconds);
  const total = perClip * prompts.length;

  if (user.creditBalance < total) {
    throw new SequenceError(
      `This sequence costs ${total} credits and you have ${user.creditBalance}.`,
      402,
      "insufficient_credits",
    );
  }

  // Range chosen to fit a signed 32-bit column and every provider's seed field.
  const seed = input.seed ?? Math.floor(Math.random() * 2_000_000_000);

  const sequence = await prisma.sequence.create({
    data: {
      userId: user.id,
      title: input.title?.trim().slice(0, 120) || null,
      status: "GENERATING",
      targetSeconds: totalSeconds,
      seed,
      creditsCost: total,
      scenes: {
        create: prompts.map((prompt, index) => ({ index, prompt })),
      },
    },
    include: { scenes: { orderBy: { index: "asc" } } },
  });

  // Only the first shot is submitted here.
  //
  // The rest are chained by the client, each one starting from the last frame
  // of the shot before it — see `submitScene`. That cannot happen server-side:
  // the frame is extracted with the ffmpeg that runs in the browser, and the
  // provider needs a URL it can fetch, so the round trip through R2 has to be
  // driven from there.
  try {
    const { generationId } = await submitGeneration({
      operation: "text-to-video",
      modelId: model.id,
      prompt: sequence.scenes[0]!.prompt,
      aspectRatio: input.aspectRatio,
      durationSeconds: input.clipSeconds,
      outputs: 1,
      seed,
    });

    await prisma.scene.update({
      where: { id: sequence.scenes[0]!.id },
      data: { generationId },
    });
  } catch (error) {
    console.error(`sequence ${sequence.id}: opening shot failed`, error);
    throw error;
  }

  return getSequence(sequence.id);
}

/**
 * Submit one shot, continuing from the previous one.
 *
 * ## Why this is image-to-video
 *
 * `frameUrl` is the last frame of the preceding clip, uploaded by the browser.
 * Passing it as the input image makes the model *start* on that image, so the
 * shots join instead of cutting between two similar-looking scenes.
 *
 * The old approach — every shot generated independently from a shared seed —
 * produced six clips of six different people wearing the same jumper. A seed
 * constrains style; it does not carry a face, a room or a light direction from
 * one clip to the next.
 *
 * Falls back to text-to-video when there is no frame, which is both the opening
 * shot and the case where the previous clip failed. A broken chain should cost
 * continuity, not the rest of the video.
 */
export async function submitScene(
  sequenceId: string,
  index: number,
  options: {
    modelId: string;
    clipSeconds: number;
    aspectRatio?: string;
    /** Storage key, not a URL — see the route's schema for why. */
    frameKey?: string;
  },
) {
  const user = await requireApiUser();

  const scene = await prisma.scene.findFirst({
    // Ownership in the query, not in a branch after it.
    where: { index, sequence: { id: sequenceId, userId: user.id } },
    include: { sequence: { select: { seed: true } } },
  });

  if (!scene) throw new SequenceError("No such scene.", 404, "not_found");

  // Already submitted. Returning quietly rather than throwing: the client
  // retries a chain step after a dropped poll, and a double-submit here would
  // charge twice for one shot.
  if (scene.generationId) return getSequence(sequenceId);

  // Same public-id resolution as `createSequence`.
  const catalogueId = catalogueModelId(options.modelId);
  const model = catalogueId ? findModel(catalogueId) : undefined;
  if (!model || model.modality !== "VIDEO") {
    throw new SequenceError("That model does not generate video.", 400);
  }

  // Built here, from our own bucket, so a caller cannot aim the provider at an
  // arbitrary host.
  const frameUrl = options.frameKey
    ? `${env.NEXT_PUBLIC_R2_PUBLIC_URL}/${options.frameKey}`
    : undefined;

  const { generationId } = await submitGeneration({
    operation: frameUrl ? "image-to-video" : "text-to-video",
    modelId: model.id,
    prompt: scene.prompt,
    aspectRatio: options.aspectRatio,
    durationSeconds: options.clipSeconds,
    outputs: 1,
    seed: scene.sequence.seed ?? undefined,
    ...(frameUrl ? { inputImageUrls: [frameUrl] } : {}),
  });

  await prisma.scene.update({
    where: { id: scene.id },
    data: { generationId },
  });

  return getSequence(sequenceId);
}

/**
 * A sequence with its scenes and their clips.
 *
 * Scoped to the caller in the query rather than checked afterwards — the
 * ownership test belongs in the `where`, not in a branch somebody can forget.
 */
export async function getSequence(id: string, advance = true) {
  const user = await requireApiUser();

  const sequence = await prisma.sequence.findFirst({
    where: { id, userId: user.id },
    include: {
      scenes: {
        orderBy: { index: "asc" },
        include: {
          generation: {
            select: {
              id: true,
              status: true,
              progress: true,
              error: true,
              assets: {
                where: { deletedAt: null },
                select: { id: true, storageKey: true, mimeType: true },
              },
            },
          },
        },
      },
    },
  });

  if (!sequence) throw new SequenceError("No such sequence.", 404, "not_found");

  /**
   * Advance every clip that has not settled.
   *
   * `pollGeneration` is what asks the provider whether a job is done and, when
   * it is, downloads the output to R2 and settles the credits. In the studio
   * the browser drives it. A sequence has no such loop, so clips rendered on
   * Replicate, finished there, and Atheos never noticed — the page sat on
   * "QUEUED" indefinitely.
   *
   * In parallel, and each failure swallowed: one clip that cannot be polled
   * must not stop the others from being read, and the page reloading is the
   * retry.
   */
  const pending = sequence.scenes
    .filter(
      (scene) =>
        scene.generation &&
        (scene.generation.status === "QUEUED" ||
          scene.generation.status === "RUNNING"),
    )
    .map((scene) => scene.generation!.id);

  // `advance` guards the recursion below. A clip that is still rendering stays
  // QUEUED after being polled, so re-reading would find it pending again and
  // poll forever. One pass per request; the page polling every five seconds is
  // what makes the next one happen.
  if (advance && pending.length > 0) {
    await Promise.all(
      pending.map((generationId) =>
        pollGeneration(generationId).catch(() => undefined),
      ),
    );

    // Re-read, because the polls above may have settled several of them and the
    // snapshot taken before is now stale.
    return getSequence(id, false);
  }

  const states = sequence.scenes.map(
    (scene) => scene.generation?.status ?? "FAILED",
  );
  const done = states.every(
    (state) =>
      state === "SUCCEEDED" || state === "FAILED" || state === "CANCELED",
  );
  const anySucceeded = states.some((state) => state === "SUCCEEDED");

  // Derived rather than stored, so a sequence cannot sit in GENERATING because
  // the write that should have moved it on was lost.
  const status: typeof sequence.status = sequence.outputAssetId
    ? "SUCCEEDED"
    : !done
      ? "GENERATING"
      : anySucceeded
        ? "STITCHING"
        : "FAILED";

  return { ...sequence, status };
}

export async function listSequences(limit = 30) {
  const user = await requireApiUser();

  return prisma.sequence.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { scenes: { select: { id: true } } },
  });
}
