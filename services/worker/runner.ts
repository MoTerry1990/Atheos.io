import "server-only";

import { randomUUID } from "node:crypto";

import { auditFreeGrants } from "@/services/billing/free-grant";
import { sweepRateLimitBuckets } from "@/lib/rate-limit";

import { prisma } from "@/lib/prisma";
import { pollWithHealth } from "@/services/ai/manager";
import {
  FAILURE_CODES,
  settleFailedDelivery,
  type FailureCode,
} from "@/services/billing/settlement";
import { settleSuccess } from "@/services/generation";
import { nextAttempt } from "@/services/ai/retry";
import type { ProviderError } from "@/services/ai/types";
import {
  claimJobs,
  heartbeat,
  log,
  markFailed,
  markRetrying,
  queueDepth,
} from "@/services/worker/queue";
import {
  MAX_WEBHOOK_ATTEMPTS,
  deliver,
  pendingDeliveries,
  type WebhookPayload,
} from "@/services/worker/webhooks";

/**
 * One pass of the worker.
 *
 * ## What this replaces
 *
 * The browser. Since Sprint 7 the client has been the job runner: it submitted,
 * then polled, and a closed tab stopped a generation advancing until somebody
 * reopened the studio. Every report since has named it, and this is the thing
 * that fixes it.
 *
 * The studio still polls — but now it is *reading* a job the server owns rather
 * than *driving* one. Closing the tab changes nothing about whether the work
 * completes.
 *
 * ## A tick is bounded, and that is the design
 *
 * `runTick` claims a handful of jobs, advances each once, and returns. It does
 * not loop until the queue is empty.
 *
 * Bounded because the caller might be a serverless function with a hard
 * deadline, and a tick that runs past it is killed mid-job — which is survivable
 * (the lease expires and another worker reclaims it) but wasteful. Advancing
 * every job by one step and returning means progress is proportional to tick
 * frequency, which is a knob an operator can turn.
 *
 * ## Advancing means polling, not submitting
 *
 * Submission already happened: `services/generation.ts` submits and records a
 * `providerJobId` when the user presses the button, because that is when
 * credits are debited and the user needs to know immediately whether it was
 * accepted. The worker's job is everything after that.
 *
 * A claimed job with **no** `providerJobId` is therefore an anomaly — a crash
 * between the row being written and the provider accepting it. It is failed
 * rather than resubmitted: resubmitting risks a double charge, and failing
 * refunds cleanly.
 */

export interface TickResult {
  workerId: string;
  claimed: number;
  advanced: number;
  completed: number;
  failed: number;
  retrying: number;
  webhooksDelivered: number;
  depth: { queued: number; running: number; retrying: number };
  /**
   * Free accounts topped up this tick.
   *
   * Nothing to do with the job queue — it rides along because the cron that
   * calls this is the only scheduled execution the deployment has, and a
   * second one on Vercel's Hobby plan is not available. Reported separately so
   * a tick that grants nothing is still distinguishable from one that never
   * tried.
   */
  /**
   * The one-time signup grants, counted rather than issued.
   *
   * Sprint 4 removed the monthly renewal — see `services/billing/free-grant.ts`
   * for why a perpetual free allowance is the one cost that grows with signups
   * and not with revenue. What is left is an invariant check: `duplicated`
   * should always be zero, and `missing` should be zero unless provisioning
   * failed for somebody.
   */
  freeGrants: { granted: number; missing: number; duplicated: number };
  /** Expired rate-limit windows deleted. */
  rateLimitRowsSwept: number;
  durationMs: number;
}

/** Jobs per tick. Small: a tick should finish well inside its budget. */
const BATCH_SIZE = 5;

/**
 * Stop claiming when less than this remains of the tick's budget.
 *
 * Claiming a job we cannot advance means holding a lease we will not use, and
 * the job waits out the whole lease before anyone else can take it.
 */
const BUDGET_MS = 45_000;

export async function runTick(): Promise<TickResult> {
  const startedAt = Date.now();

  // Identifies the lease holder. A UUID per tick rather than a stable name so
  // that a restarted worker never inherits a lease it did not take.
  const workerId = `w_${randomUUID().slice(0, 8)}`;

  const result: TickResult = {
    workerId,
    claimed: 0,
    advanced: 0,
    completed: 0,
    failed: 0,
    retrying: 0,
    webhooksDelivered: 0,
    depth: { queued: 0, running: 0, retrying: 0 },
    freeGrants: { granted: 0, missing: 0, duplicated: 0 },
    rateLimitRowsSwept: 0,
    durationMs: 0,
  };

  // Housekeeping first, outside the job loop's time budget, and each guarded
  // separately. Neither may take the queue down: a missed audit is recoverable
  // tomorrow and a missed sweep costs a few stale rows, while a stalled worker
  // means nobody's generations finish.
  try {
    result.freeGrants = await auditFreeGrants();

    if (result.freeGrants.duplicated > 0) {
      // Should be impossible — the idempotency key is unique-constrained. If it
      // ever fires, credits have been granted twice and the constraint is not
      // doing its job, which is worth a loud line rather than a metric.
      console.error(
        `worker tick: ${result.freeGrants.duplicated} accounts hold more than one signup grant`,
      );
    }
  } catch (error) {
    console.error("worker tick: free grant audit failed", error);
  }

  try {
    result.rateLimitRowsSwept = await sweepRateLimitBuckets();
  } catch (error) {
    console.error("worker tick: rate limit sweep failed", error);
  }

  const jobs = await claimJobs(workerId, BATCH_SIZE);
  result.claimed = jobs.length;

  for (const job of jobs) {
    if (Date.now() - startedAt > BUDGET_MS) {
      // Out of budget. The remaining jobs keep their lease and are reclaimed
      // when it expires — no work is lost, it is only delayed.
      await log(job.id, "info", "deferred to the next tick (budget reached)", {
        workerId,
      });
      break;
    }

    await advance(job, workerId, result);
    result.advanced += 1;
  }

  result.webhooksDelivered = await flushWebhooks();
  result.depth = await queueDepth();
  result.durationMs = Date.now() - startedAt;

  return result;
}

async function advance(
  job: Awaited<ReturnType<typeof claimJobs>>[number],
  workerId: string,
  result: TickResult,
): Promise<void> {
  if (!job.providerJobId) {
    // Claimed but never submitted — a crash between writing the row and the
    // provider accepting it. Resubmitting risks a double charge; failing
    // refunds cleanly.
    await log(job.id, "error", "no provider job id — cannot advance", {
      workerId,
      attempt: job.attemptCount,
    });
    await markFailed(job.id, workerId, "The job was never submitted.");
    result.failed += 1;
    return;
  }

  try {
    const providerJob = await pollWithHealth(job.provider, job.providerJobId);

    if (providerJob.progress !== undefined) {
      await heartbeat(job.id, workerId, providerJob.progress * 100);
    }

    if (providerJob.state === "succeeded") {
      /**
       * Settle properly, rather than only flipping the status.
       *
       * This used to call `markSucceeded`, which sets `status: "SUCCEEDED"` and
       * nothing else. The provider's output was never downloaded, never written
       * to R2, no `assets` row was created and no cost was recorded — so a job
       * the worker advanced reported success with nothing attached, and the
       * cost engine saw a completed generation it could not price.
       *
       * It went unnoticed for six sprints because the worker had never actually
       * run against a provider. `settleSuccess` is the same function the
       * client-driven poll uses, so both paths now mean the same thing by
       * "succeeded", and it releases the lease in the same transaction.
       */
      const outputs = providerJob.outputs ?? [];

      if (outputs.length === 0) {
        // A provider reporting success with no outputs is a failure we would
        // otherwise record as a success — the user is charged for nothing.
        await handleFailure(
          job.id,
          workerId,
          job.attemptCount,
          {
            code: "unknown",
            retryable: false,
            message:
              "The provider reported success but returned no output, so there " +
              "is nothing to deliver. Most often the output expired before it " +
              "was stored.",
          },
          result,
        );
        return;
      }

      // `collectionId` lives in the parameters the submit step stored verbatim.
      // The worker's claim does not carry it, so it is read here rather than
      // widening `ClaimedJob` for one optional field.
      const row = await prisma.generation.findUnique({
        where: { id: job.id },
        select: { parameters: true },
      });
      const parameters = row?.parameters as { collectionId?: string } | null;

      await settleSuccess(job.id, job.userId, outputs, {
        collectionId: parameters?.collectionId,
      });

      await log(job.id, "info", "succeeded", {
        workerId,
        provider: job.provider,
        attempt: job.attemptCount,
        outputs: outputs.length,
      });
      result.completed += 1;
      return;
    }

    if (providerJob.state === "failed") {
      await handleFailure(
        job.id,
        workerId,
        job.attemptCount,
        providerJob.error ?? {
          code: "unknown",
          retryable: true,
          message: "The provider reported a failure with no detail.",
        },
        result,
      );
      return;
    }

    if (providerJob.state === "canceled") {
      // Through settlement, not `markFailed`: a cancelled job delivered
      // nothing, so the credits come back like any other undelivered run.
      const cancelled = await settleFailedDelivery({
        generationId: job.id,
        workerId,
        code: FAILURE_CODES.PROVIDER_CANCELED,
        message: "The provider cancelled this job.",
      });
      await log(job.id, "warn", "cancelled by provider", {
        workerId,
        financial: cancelled.financial,
      });
      result.failed += 1;
      return;
    }

    // Still running. The heartbeat above refreshed the lease, so the job stays
    // ours until the next tick.
    await heartbeat(job.id, workerId);
    await log(job.id, "info", "still running", {
      workerId,
      state: providerJob.state,
    });
  } catch (error) {
    await handleFailure(
      job.id,
      workerId,
      job.attemptCount,
      isProviderError(error)
        ? error
        : {
            code: "unknown",
            retryable: true,
            message: "The provider failed in a way we did not recognise.",
          },
      result,
    );
  }
}

function isProviderError(error: unknown): error is ProviderError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "retryable" in error
  );
}

/**
 * Retry or give up, using the same policy the Provider Manager uses.
 *
 * Deliberately not a second policy. Two places deciding what is retryable is
 * two places to disagree about whether a content filter is worth another
 * attempt — and the answer must be the same whether the decision is made
 * during submit or during polling.
 */
async function handleFailure(
  jobId: string,
  workerId: string,
  attemptCount: number,
  error: ProviderError,
  result: TickResult,
): Promise<void> {
  const next = nextAttempt(error, attemptCount);

  if (next) {
    await markRetrying(jobId, workerId, next.delayMs);
    await log(jobId, "warn", `retrying in ${next.delayMs}ms`, {
      workerId,
      code: error.code,
      attempt: next.attempt,
    });
    result.retrying += 1;
    return;
  }

  /**
   * Permanent failure settles the money as well as the status.
   *
   * `markFailed` only ever set `status = 'FAILED'`. The customer's credits
   * stayed spent, and because the worker had never run in production nobody
   * noticed until the first real tick failed a job and left a user 90 credits
   * short. `settleFailedDelivery` is the single path that transitions *and*
   * reverses, by whichever financial model that generation used.
   */
  const settlement = await settleFailedDelivery({
    generationId: jobId,
    workerId,
    code: permanentCode(error.code, error.message),
    message: error.message,
  });

  await log(jobId, "error", "failed permanently", {
    workerId,
    code: error.code,
    attempts: attemptCount,
    financial: settlement.financial,
  });
  result.failed += 1;
}

/**
 * Translate a provider error code into a stored, machine-readable one.
 *
 * The provider's vocabulary is not a contract — it changes when they change it
 * — so it is mapped once, here, into codes support and reporting can rely on.
 */
function permanentCode(code: string, message: string): FailureCode {
  // `empty_output` is not part of `ProviderErrorCode` and should not be — that
  // union describes what providers report, and "succeeded with nothing
  // attached" is our interpretation of a success, not their error.
  if (/returned no output/i.test(message)) return FAILURE_CODES.EMPTY_OUTPUT;
  if (code === "canceled" || code === "cancelled") {
    return FAILURE_CODES.PROVIDER_CANCELED;
  }

  if (code === "timeout" || code === "rate_limit") {
    return FAILURE_CODES.RETRIES_EXHAUSTED;
  }
  return FAILURE_CODES.PROVIDER_FAILED;
}

/**
 * Deliver outstanding callbacks.
 *
 * Runs after job processing so a job that reached a terminal state in *this*
 * tick gets its callback in the same pass rather than waiting for the next one.
 */
async function flushWebhooks(): Promise<number> {
  const pending = await pendingDeliveries(10);
  let delivered = 0;

  for (const job of pending) {
    if (!job.webhookUrl) continue;

    const outputs = await prisma.asset.findMany({
      where: { generationId: job.id, deletedAt: null },
      select: { storageKey: true, mimeType: true },
    });

    const payload: WebhookPayload = {
      event:
        job.status === "SUCCEEDED"
          ? "generation.completed"
          : job.status === "CANCELED"
            ? "generation.canceled"
            : "generation.failed",
      generationId: job.id,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
      ...(outputs.length
        ? {
            outputs: outputs.map((asset) => ({
              url: asset.storageKey,
              mimeType: asset.mimeType,
            })),
          }
        : {}),
      ...(job.error ? { error: job.error } : {}),
    };

    const outcome = await deliver(job.id, job.webhookUrl, payload);

    if (outcome.delivered) {
      delivered += 1;
      await log(job.id, "info", "webhook delivered");
    } else {
      await log(job.id, "warn", `webhook failed: ${outcome.error}`, {
        remaining: MAX_WEBHOOK_ATTEMPTS,
      });
    }
  }

  return delivered;
}
