import "server-only";

import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { findModel } from "@/services/ai/registry";
import { creditsFor } from "@/services/ai/pricing";
import { GenerationError, submitGeneration } from "@/services/generation";

/**
 * Sequences — long-form video, assembled from many short clips.
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
 * ## Credits are reserved by submitting, not by a separate hold
 *
 * There is no "reserve" concept in the ledger and adding one would mean a new
 * transaction type, a new expiry, and a new way for credits to get stuck. So
 * every clip is submitted up front: each debit is a real generation, and the
 * existing automatic refund covers each failure. A sequence that fails halfway
 * refunds exactly the clips that failed and keeps the ones that worked — which
 * is the behaviour the spec asks for, obtained by doing nothing special.
 *
 * The affordability check still happens first, against the whole sequence, so
 * a user cannot start sixteen clips with credits for four and discover it on
 * clip five.
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

  const model = findModel(input.modelId);
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

  // Submitted one at a time, in cut order.
  //
  // Serial rather than `Promise.all`: the provider throttles hard when the
  // account balance is low, and sixteen simultaneous submissions is how a
  // sequence half-fails on 429s that have nothing to do with the prompts. The
  // clips render concurrently on the provider's side regardless — this only
  // paces the submissions.
  for (const scene of sequence.scenes) {
    try {
      const { generationId } = await submitGeneration({
        operation: "text-to-video",
        modelId: model.id,
        prompt: scene.prompt,
        aspectRatio: input.aspectRatio,
        durationSeconds: input.clipSeconds,
        outputs: 1,
        seed,
      });

      await prisma.scene.update({
        where: { id: scene.id },
        data: { generationId },
      });
    } catch (error) {
      // One scene failing must not abandon the ones already submitted — they
      // are real generations that will finish and be worth keeping. The scene
      // stays without a generation and reads as failed.
      console.error(
        `sequence ${sequence.id}: scene ${scene.index} could not be submitted`,
        error,
      );

      if (
        error instanceof GenerationError &&
        error.code === "insufficient_credits"
      ) {
        // Nothing later will succeed either.
        break;
      }
    }
  }

  return getSequence(sequence.id);
}

/**
 * A sequence with its scenes and their clips.
 *
 * Scoped to the caller in the query rather than checked afterwards — the
 * ownership test belongs in the `where`, not in a branch somebody can forget.
 */
export async function getSequence(id: string) {
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
