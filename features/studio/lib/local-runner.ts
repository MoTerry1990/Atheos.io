import { dimensionsFor, findModel } from "@/features/studio/data/models";
import { estimateCost } from "@/store/studio-store";
import type { StudioJob, StudioParams } from "@/features/studio/types";

/**
 * A local job-lifecycle harness. **This is not AI, and it does not call one.**
 *
 * Sprint 5 builds the interface and its state management; providers arrive in
 * Sprint 6. That left a problem: a queue, a progress indicator, a preview panel
 * and a history are all *state machines*, and a state machine that never
 * transitions cannot be evaluated or reviewed. Jobs would sit at "queued"
 * forever and nobody could tell working code from broken code.
 *
 * So this drives the lifecycle — queued → running → succeeded/failed — on
 * timers, so every state the UI must handle can actually be reached.
 *
 * ## What it deliberately does not do
 *
 * It does not generate imagery, call a model, or claim to. Its "outputs" are a
 * hue and a seed; the preview renders those as an obvious procedural gradient,
 * and the studio shows a persistent banner stating that no provider is
 * connected. Producing something that *looked* like model output would
 * misrepresent the product to anyone reviewing it, which is a worse failure
 * than an unverifiable queue.
 *
 * ## It fails on purpose, sometimes
 *
 * One in eight jobs fails. Failure is the state most likely to be built badly,
 * because it is the one a developer never sees while testing a happy path — and
 * on a real AI platform it is common. A harness that always succeeds would let
 * a broken error state ship.
 *
 * ## Sprint 6 deletes this file
 *
 * Its replacement is a server-side pipeline: a provider adapter submits, a job
 * record persists, and the client polls. The **shape** it produces —
 * `StudioJob` — is what the components consume, so they do not change.
 */

const FAILURE_RATE = 1 / 8;

/** Deterministic-ish hue so a given seed always previews the same way. */
function hueFor(seed: number, index: number): number {
  return (seed * 7 + index * 53) % 360;
}

export function createJob(params: StudioParams): StudioJob {
  const model = findModel(params.modelId);

  return {
    id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    status: "queued",
    // Snapshot, not reference. The composer keeps changing after submit, and
    // history must record what was actually run.
    params: structuredClone(params),
    modelName: model.displayName,
    creditCost: estimateCost(params),
    progress: 0,
    outputs: [],
    error: null,
    createdAt: Date.now(),
    completedAt: null,
  };
}

export interface RunnerHandle {
  cancel: () => void;
}

/**
 * Drive a job through its lifecycle.
 *
 * Returns a handle so the caller can cancel — which must also stop the timers,
 * or a cancelled job keeps emitting progress into a store that no longer has it.
 */
export function runJob(
  job: StudioJob,
  callbacks: {
    onUpdate: (patch: Partial<StudioJob>) => void;
    onSettled: () => void;
  },
): RunnerHandle {
  const model = findModel(job.params.modelId);

  // Compressed against `typicalSeconds` so the interface can be exercised
  // without waiting three minutes for a video job.
  const totalMs = Math.min(2000 + model.typicalSeconds * 40, 9000);
  const tickMs = 120;

  // Progress is measured against the wall clock, not by counting ticks.
  // Browsers throttle setInterval to ~1s in a background tab, so a
  // tick-counting version advances at a fraction of real time — and "start a
  // generation, switch tabs" is the normal way people use a tool like this.
  const startedAt = Date.now();
  let cancelled = false;

  const startTimer = setTimeout(() => {
    if (cancelled) return;
    callbacks.onUpdate({ status: "running" });
  }, 400);

  const interval = setInterval(() => {
    if (cancelled) return;

    const ratio = Math.min(1, (Date.now() - startedAt) / totalMs);

    // Video models report nothing useful for long stretches, so the harness
    // reproduces that: null progress exercises the indeterminate bar, which is
    // a genuinely different UI path from a determinate one.
    callbacks.onUpdate({
      progress: model.modality === "VIDEO" ? null : ratio,
    });

    if (ratio < 1) return;

    clearInterval(interval);

    const failed = Math.random() < FAILURE_RATE;
    const seed = job.params.seed ?? Math.floor(Math.random() * 2_147_483_647);
    const { width, height } = dimensionsFor(
      job.params.aspectRatio,
      job.params.resolution,
    );

    callbacks.onUpdate(
      failed
        ? {
            status: "failed",
            progress: null,
            completedAt: Date.now(),
            error:
              "The provider rejected this request. Your credits have not been charged.",
          }
        : {
            status: "succeeded",
            progress: 1,
            completedAt: Date.now(),
            outputs: Array.from({ length: job.params.outputs }, (_, index) => ({
              id: `${job.id}_${index}`,
              hue: hueFor(seed, index),
              seed: seed + index,
              width,
              height,
            })),
          },
    );

    callbacks.onSettled();
  }, tickMs);

  return {
    cancel: () => {
      cancelled = true;
      clearTimeout(startTimer);
      clearInterval(interval);
    },
  };
}
