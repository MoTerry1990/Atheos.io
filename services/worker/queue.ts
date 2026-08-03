import "server-only";

import { prisma } from "@/lib/prisma";
import type { GenerationStatus } from "@/lib/generated/prisma/enums";

/**
 * The job queue.
 *
 * ## Why the database is the queue
 *
 * There is no Redis, no SQS and no broker in this project, and adding one to
 * run at most a few thousand jobs a day would be infrastructure to operate for
 * no benefit. Postgres does this correctly with `SKIP LOCKED`, and the jobs are
 * already rows — a separate queue would mean two systems that can disagree
 * about whether a generation exists.
 *
 * The honest trade: this does not scale to millions of jobs a minute. It scales
 * a very long way past where this product is, and the day it does not, the
 * claim function is the only thing that changes.
 *
 * ## `FOR UPDATE SKIP LOCKED` is the whole design
 *
 * The failure this prevents: two workers select the same QUEUED row, both see
 * it, both submit it to a provider, and the user is charged twice for one
 * generation.
 *
 * A plain `SELECT ... WHERE status = 'QUEUED'` followed by an `UPDATE` has
 * exactly that race. `SKIP LOCKED` makes the read itself exclusive: a row
 * another transaction has locked is *invisible* to this one, so two concurrent
 * workers see disjoint sets of jobs and neither waits on the other.
 *
 * This is the one piece of the worker that cannot be verified by reading it,
 * so it is verified against real Postgres in `tests/db/worker-queue.test.ts`
 * with two genuinely concurrent claims.
 *
 * ## Leases, not locks
 *
 * A claimed job records `lockedAt` and `lockedBy`. If a worker dies mid-run —
 * a deploy, an OOM, a serverless timeout — nothing releases the claim. So a
 * claim is a **lease**: any RUNNING job whose `lockedAt` is older than
 * `LEASE_MS` is reclaimable.
 *
 * Without that, one crashed worker strands a job in RUNNING permanently, and
 * the user waits forever for something nobody is doing.
 */

/**
 * How long a worker may hold a job before another may reclaim it.
 *
 * Generous, because video generation legitimately takes minutes and reclaiming
 * a job that is still running means submitting it to a provider twice. The
 * worker heartbeats while it works, so a live worker refreshes its lease and
 * only a genuinely dead one loses it.
 */
export const LEASE_MS = 5 * 60_000;

/** Terminal states. A job in one of these is never claimed again. */
export const TERMINAL: readonly GenerationStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
];

export interface ClaimedJob {
  id: string;
  userId: string;
  provider: string;
  model: string;
  operation: string;
  status: GenerationStatus;
  providerJobId: string | null;
  attemptCount: number;
}

/**
 * Atomically take up to `limit` runnable jobs.
 *
 * Runnable means:
 *   - QUEUED with no scheduled time, or a scheduled time that has passed; or
 *   - RETRYING whose backoff has elapsed; or
 *   - RUNNING whose lease has expired (the previous worker died).
 *
 * The whole thing is one statement. Splitting it into a select and an update
 * reopens the double-claim race that `SKIP LOCKED` exists to close.
 */
export async function claimJobs(
  workerId: string,
  limit = 5,
  now: Date = new Date(),
): Promise<ClaimedJob[]> {
  const leaseCutoff = new Date(now.getTime() - LEASE_MS);

  return prisma.$queryRaw<ClaimedJob[]>`
    WITH runnable AS (
      SELECT "id"
      FROM "generations"
      WHERE
        (
          "status" IN ('QUEUED', 'RETRYING')
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
        )
        OR (
          "status" = 'RUNNING'
          AND "lockedAt" IS NOT NULL
          AND "lockedAt" < ${leaseCutoff}
        )
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "generations" AS g
    SET
      "status" = 'RUNNING',
      "lockedAt" = ${now},
      "lockedBy" = ${workerId},
      "startedAt" = COALESCE(g."startedAt", ${now}),
      "attemptCount" = g."attemptCount" + 1
    FROM runnable
    WHERE g."id" = runnable."id"
    RETURNING
      g."id", g."userId", g."provider", g."model",
      g."operation"::text AS operation, g."status", g."providerJobId",
      g."attemptCount"`;
}

/**
 * Refresh a lease while work is still in progress.
 *
 * Called between provider polls. A worker that stops heartbeating loses its
 * jobs after `LEASE_MS`, which is exactly what should happen to a worker that
 * has stopped.
 */
export async function heartbeat(
  jobId: string,
  workerId: string,
  progress?: number,
): Promise<void> {
  await prisma.generation.updateMany({
    // Scoped by `lockedBy`: a worker that has already lost its lease must not
    // be able to extend it, or two workers would both believe they own the job.
    where: { id: jobId, lockedBy: workerId },
    data: {
      lockedAt: new Date(),
      ...(progress !== undefined
        ? { progress: Math.max(0, Math.min(100, Math.round(progress))) }
        : {}),
    },
  });
}

export async function markSucceeded(
  jobId: string,
  workerId: string,
): Promise<void> {
  await prisma.generation.updateMany({
    where: { id: jobId, lockedBy: workerId },
    data: {
      status: "SUCCEEDED",
      progress: 100,
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      nextAttemptAt: null,
    },
  });
}

/**
 * Schedule another attempt.
 *
 * The job returns to RETRYING with a future `nextAttemptAt`, and the lease is
 * released so any worker can pick it up when the time comes. Backoff lives in
 * the row rather than in a sleeping process, which is the only form that
 * survives a restart.
 */
export async function markRetrying(
  jobId: string,
  workerId: string,
  delayMs: number,
): Promise<void> {
  await prisma.generation.updateMany({
    where: { id: jobId, lockedBy: workerId },
    data: {
      status: "RETRYING",
      nextAttemptAt: new Date(Date.now() + delayMs),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

export async function markFailed(
  jobId: string,
  workerId: string,
  error: string,
): Promise<void> {
  await prisma.generation.updateMany({
    where: { id: jobId, lockedBy: workerId },
    data: {
      status: "FAILED",
      // Truncated: a provider error can carry a stack, and this string is shown
      // to a user.
      error: error.slice(0, 1000),
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      nextAttemptAt: null,
    },
  });
}

/**
 * Cancel a job.
 *
 * Not scoped by `lockedBy` — the *user* is cancelling, and they do not know
 * which worker holds it. Scoped by owner instead, and refuses to touch a job
 * that has already finished: cancelling a succeeded generation would throw away
 * work the user has already been charged for.
 */
export async function cancelJob(
  jobId: string,
  userId: string,
): Promise<boolean> {
  const { count } = await prisma.generation.updateMany({
    where: { id: jobId, userId, status: { notIn: [...TERMINAL] } },
    data: {
      status: "CANCELED",
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      nextAttemptAt: null,
    },
  });

  return count > 0;
}

/**
 * Append a line to a job's history.
 *
 * Persisted rather than written to stdout because this is the answer to "what
 * happened to my generation" — asked by a user, days later, about a job nobody
 * was watching. `console.log` cannot answer that.
 *
 * Never throws. A failure to write a log line must not fail the job it is
 * describing, which would be the logging system causing the outage it exists to
 * explain.
 */
export async function log(
  generationId: string,
  level: "info" | "warn" | "error",
  message: string,
  // `InputJsonValue`-compatible rather than `Record<string, unknown>`: Prisma's
  // Json input type excludes `undefined` values, which an open record allows.
  context?: Record<string, string | number | boolean | null>,
): Promise<void> {
  try {
    await prisma.generationLog.create({
      data: {
        generationId,
        level,
        message: message.slice(0, 2000),
        ...(context ? { context } : {}),
      },
    });
  } catch (error) {
    console.error(`[worker] could not write log for ${generationId}`, error);
  }
}

/** Jobs waiting, running or retrying. For the admin status page. */
export async function queueDepth(): Promise<{
  queued: number;
  running: number;
  retrying: number;
}> {
  const [queued, running, retrying] = await Promise.all([
    prisma.generation.count({ where: { status: "QUEUED" } }),
    prisma.generation.count({ where: { status: "RUNNING" } }),
    prisma.generation.count({ where: { status: "RETRYING" } }),
  ]);

  return { queued, running, retrying };
}
