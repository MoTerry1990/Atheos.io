import "server-only";

import { requireApiUser } from "@/lib/auth";
import { inStage } from "@/services/delivery";
import { isAdmin } from "@/services/admin/auth";
import { prisma } from "@/lib/prisma";
import { estimateCost } from "@/services/ai/cost";
import {
  captureReservation,
  releaseReservation,
  reserveWithin,
} from "@/services/billing/ledger";
import {
  costEntry,
  worstCaseCostMicroUsd,
} from "@/services/billing/model-costs";
import { isFreeTier, planConfigFor } from "@/services/billing/plan-config";
import {
  blockMessage,
  gateGeneration,
  recordSpend,
} from "@/services/billing/spending";
import {
  checkGenerationLimits,
  limitMessage,
} from "@/services/limits/generation-limits";
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
import {
  AnimationSourceError,
  resolveAnimationSource,
} from "@/services/ai/animate-source";
import type { CreativeBrief } from "@/services/ai/creative-brief";
import type { ImageBrief } from "@/services/ai/image-brief";
import {
  DirectorError,
  resolveDirectorSubmission,
} from "@/services/ai/director-submit";
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
 * ## Reserve, capture, release — Sprint 4
 *
 * Credits move through three steps rather than one, and the mechanics live in
 * `services/billing/ledger.ts`:
 *
 *   **reserve**  atomically, in the same transaction that creates the
 *                generation row, *before* the provider is called. The debit is
 *                a conditional UPDATE, so two simultaneous requests cannot
 *                both spend the same credits — the failure this replaces.
 *   **capture**  once the provider has accepted the work. From here it is
 *                billable and no longer refundable.
 *   **release**  when submission fails before any billable provider work. The
 *                customer pays nothing for a request that never ran.
 *
 * ## Why credits are reserved before the provider is called
 *
 * The alternative — charge on success — sounds fairer and is unworkable. A
 * provider call that succeeds while our response is lost would produce work we
 * never charged for, and there is no way to reconcile it afterwards. Reserving
 * first means the worst case is a release, which is a recoverable state we
 * control.
 *
 * The reservation and the generation row commit in **one transaction**. A debit
 * with no generation is theft; a generation with no debit is free inference.
 *
 * ## Credits pay for a delivered asset, not for a provider call
 *
 * This file used to say the opposite: that a failure after capture was not
 * refunded, because Replicate bills for GPU time whether or not the output was
 * usable, and refunding would mean paying for the run *and* returning the money.
 *
 * Sprint 5C.2 showed what that policy does in practice. Replicate produced a
 * valid image, Atheos failed to store it, and the customer was left four credits
 * poorer with nothing to show — which the code considered correct, because the
 * charge had been captured. It also turned out that capture happens at
 * *submission*, so "after capture" meant "always", and the refund path built the
 * sprint before could never run at all.
 *
 * The rule now: **the customer pays for a durable asset they can use.** If
 * Atheos fails to deliver one, the credits go back, whatever the provider did
 * and whatever it cost us. That cost is real and is not erased — it stays on
 * `costMicroUsd` so the margin report and the spending breaker still see it —
 * but it is Atheos's loss to absorb, not the customer's to fund.
 *
 * A generation that *did* deliver is never refunded. That is the other half of
 * the rule, and `settleFailedDelivery` checks for an asset row twice, the second
 * time inside the transaction, before reversing anything.
 *
 * ## Everything is idempotent, by database constraint
 *
 * A failing job may be polled many times — by several open tabs, or by a client
 * retrying. Every financial write carries a unique `idempotencyKey`, so the
 * second attempt is rejected by Postgres rather than by application logic
 * somebody forgets to write.
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
    /**
     * Seconds until the caller should retry. Rendered as `Retry-After`.
     *
     * Only set on 429s. A client that is told to back off and given no number
     * either gives up or retries immediately, and both are wrong.
     */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

/**
 * Thrown inside the reservation transaction purely to roll it back.
 *
 * Never thrown to a caller: `reservationFailure` converts it into a
 * `GenerationError` with the balance the caller needs to see. It exists because
 * a rollback has to be an exception, and a `GenerationError` thrown from inside
 * would be indistinguishable from a real one thrown by a nested call.
 *
 * Exported only so that conversion can be tested by constructing one. Nothing
 * outside this module should throw it.
 */
export class InsufficientCredits extends Error {}

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
  /** "1K" | "2K" | "4K", for image models that size by class. */
  imageResolution?: string;
  durationSeconds?: number;
  cameraMotion?: string;
  /**
   * The owned image to animate. An id, never a URL.
   *
   * A URL from a client is an instruction to fetch whatever it likes on our
   * credentials; an id is a claim the server checks against a row it owns.
   */
  sourceAssetId?: string;
  /** Generation this derives from, for lineage. */
  parentId?: string;
  /** Collection to file the results into on success. */
  collectionId?: string;

  /**
   * Creative Director: the signed plan, the brief it was signed over, and the
   * user's explicit confirmation.
   *
   * When the Director is enabled these are required and `prompt` is ignored —
   * the server recompiles from the brief. When it is disabled they are absent
   * and the existing path runs unchanged.
   */
  planToken?: string;
  confirmedBrief?: CreativeBrief | ImageBrief;
  planConfirmed?: boolean;
  clientIdempotencyKey?: string;
}

/**
 * Turn a failed reservation into the answer the caller should get.
 *
 * Extracted from the `.catch` it used to live inside so it can be tested at
 * all: reaching that block through `submitGeneration` means standing up the
 * provider, the catalogue, the limiter and the ledger, and a translation this
 * small should not need any of them.
 *
 * Anything unrecognised is returned unchanged, so a genuine fault still reaches
 * the route's 500 and its log.
 */
export function reservationFailure(
  error: unknown,
  context: { cost: number; balance: number; director: boolean },
): unknown {
  if (error instanceof InsufficientCredits) {
    return new GenerationError(
      `This needs ${context.cost} credits and you have ${context.balance}.`,
      402,
      "insufficient_credits",
    );
  }

  /**
   * The deterministic id collided: this plan token has been submitted before.
   *
   * The refusal itself is the database's, and that is deliberate — a unique
   * primary key cannot be raced past the way an application-level check can.
   * But an unhandled `P2002` left the route to translate it, and the route's
   * fallback is a 500 reading "Something went wrong starting that generation."
   *
   * Observed live during the Step 3 proof: a replayed token was correctly
   * refused and correctly not charged, and the caller was told the server had
   * broken. A replay is not a server fault.
   *
   * Gated on `director` because only the Director path sets a deterministic id.
   * Everywhere else a `P2002` means something genuinely unexpected, and
   * swallowing it as "already submitted" would hide it.
   */
  if (
    context.director &&
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  ) {
    return new GenerationError(
      "That plan has already been submitted.",
      409,
      "plan_already_submitted",
    );
  }

  return error;
}

/** Submit a generation. Returns the persisted job id. */
export async function submitGeneration(input: SubmitInput) {
  const user = await requireApiUser();

  /**
   * The Creative Director gate.
   *
   * Returns null when the feature is off, and everything below runs exactly as
   * it did. When it is on, a request without a confirmed plan is refused — so
   * the old client-built-prompt shape cannot be used to bypass planning — and
   * the compiled prompt replaces whatever the client sent.
   */
  /**
   * The source picture for "animate this", resolved from an owned asset id.
   *
   * Resolved **here**, not in the browser and not from anything the browser
   * sent. `sourceAssetId` is opaque; `resolveAnimationSource` turns it into a
   * signed URL only after proving the row belongs to this user, and a foreign
   * id is a 404 rather than a fetch.
   *
   * This is the half of "now make this image a video" that was missing
   * entirely: the audited follow-up generation recorded `inputImageUrls: []`
   * and `parentId: null`, so the picture the user was looking at reached
   * nothing and no link was kept to say it had been meant to.
   */
  let animationSource: Awaited<
    ReturnType<typeof resolveAnimationSource>
  > | null = null;
  if (input.sourceAssetId) {
    try {
      animationSource = await resolveAnimationSource({
        userId: user.id,
        assetId: input.sourceAssetId,
      });
    } catch (error) {
      if (error instanceof AnimationSourceError) {
        throw new GenerationError(error.message, error.status, error.code);
      }
      throw error;
    }
  }

  const resolvedReferenceUrls =
    animationSource?.status === "resolved" ? [animationSource.url] : [];

  let director: ReturnType<typeof resolveDirectorSubmission> = null;
  try {
    director = resolveDirectorSubmission({
      userId: user.id,
      planToken: input.planToken,
      brief: input.confirmedBrief,
      confirmed: input.planConfirmed,
      clientIdempotencyKey: input.clientIdempotencyKey,
      referenceUrls: resolvedReferenceUrls,
    });
  } catch (error) {
    if (error instanceof DirectorError) {
      throw new GenerationError(error.message, error.status, error.code);
    }
    throw error;
  }

  if (director) {
    // The client's prompt, model and duration are overridden, not merged. A
    // merge would leave a path for client text to reach the provider.
    input = {
      ...input,
      modelId: director.modelId,
      prompt: director.prompt,
      negativePrompt: director.negativePrompt,
      durationSeconds: director.durationSeconds ?? input.durationSeconds,
      aspectRatio: director.aspectRatio ?? input.aspectRatio,
      imageResolution: director.imageResolution ?? input.imageResolution,
      /**
       * References are replaced, not merged.
       *
       * The Director's URLs were minted from asset ids this user was proved to
       * own. Merging would let a client-supplied URL ride along beside them —
       * and a URL from a client is an instruction to fetch whatever it likes on
       * our credentials.
       */
      ...(director.inputImageUrls
        ? { inputImageUrls: director.inputImageUrls }
        : {}),
      /**
       * The parent-child link, finally written.
       *
       * `Generation.parentId` has existed since Sprint 4 and this path never
       * set it, which is why the audited "make this image a video" record shows
       * `parentId: null` beside an image it was derived from. No migration was
       * needed to fix that — only for something to write the column.
       */
      ...(animationSource?.status === "resolved" &&
      animationSource.parentGenerationId
        ? { parentId: animationSource.parentGenerationId }
        : {}),
    };
  }

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

  /**
   * The price, decided here and nowhere else.
   *
   * Never read from the request. A client that can name its own price is a
   * client that will name zero, and `/api/mcp` plus API keys mean the client is
   * not always a browser we shipped.
   */
  const cost = priceFor(input.modelId, outputs, durationSeconds);

  // ---- Plan, spending controls, abuse controls -------------------------
  //
  // All three run *before* any credit moves. A request that is going to be
  // refused should be refused without a ledger write, because every avoidable
  // financial mutation is one more chance for its reversal to be the thing
  // that fails.
  const subscription = await prisma.subscription.findUnique({
    where: { userId: user.id },
    select: { planTier: true, status: true },
  });

  // A subscription that is past due, unpaid or cancelled is not an entitlement.
  // Reading `planTier` without reading `status` is how somebody keeps a paid
  // tier's concurrency after their card stops working.
  const entitledTier =
    subscription && ["ACTIVE", "TRIALING"].includes(subscription.status)
      ? subscription.planTier
      : "FREE";

  const plan = planConfigFor(entitledTier);
  const free = isFreeTier(entitledTier);

  if (!plan.eligibleModalities.includes(model.modality)) {
    throw new GenerationError(
      `${model.displayName} is not included in the ${plan.displayName} plan.`,
      403,
      "plan_ineligible",
    );
  }

  const entry = costEntry(input.modelId);
  const gate = await gateGeneration({
    modelId: input.modelId,
    provider: model.providerId,
    isFree: free,
    requestCostMicroUsd: entry ? worstCaseCostMicroUsd(entry) : null,
  });

  if (!gate.allowed) {
    // 503 rather than 402: nothing is wrong with the request or the account.
    // The service has declined to spend, which is a server-side condition.
    throw new GenerationError(blockMessage(gate.reason!), 503, gate.reason!);
  }

  const limits = await checkGenerationLimits({
    userId: user.id,
    tier: entitledTier,
    // Drives the per-modality daily cap. Free is ten images a day; video is
    // capped at two and separately unreachable from that plan.
    modality: model.modality,
  });

  if (!limits.allowed) {
    throw new GenerationError(
      limitMessage(limits),
      429,
      limits.reason!,
      limits.retryAfterSeconds,
    );
  }

  // ---- Reserve and record together, or not at all ----------------------
  //
  // `insufficientBalance` is carried out of the transaction rather than thrown
  // from inside it, because throwing is how the generation row is rolled back
  // and the caller still needs to know *why* it was rolled back.
  let insufficientBalance: number | null = null;

  const generation = await prisma
    .$transaction(async (tx) => {
      const created = await tx.generation.create({
        data: {
          /**
           * Derived from the plan token when the Director is on, so a replayed
           * token collides on the primary key inside this transaction — the
           * database refuses the second generation rather than application
           * logic a concurrent request could race past.
           */
          ...(director ? { id: director.generationId } : {}),
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
            imageResolution: input.imageResolution,
            seed: input.seed,
            outputs,
            inputImageUrls: input.inputImageUrls ?? [],
            inputStrength: input.inputStrength,
            scale: input.scale,
            durationSeconds,
            cameraMotion: input.cameraMotion,
            collectionId: input.collectionId,
            // Sanitised planning record: hashes and counts, no URLs or payloads.
            ...(director ? { creativePlan: director.planMetadata } : {}),
          },
          creditsCost: cost,
          status: "QUEUED",
        },
      });

      const reserved = await reserveWithin(tx, {
        userId: user.id,
        generationId: created.id,
        amount: cost,
        metadata: {
          modelId: model.id,
          outputs,
          durationSeconds,
          tier: entitledTier,
        },
      });

      if (!reserved.ok) {
        insufficientBalance = reserved.balance;
        // Rolls the generation row back with it. A generation nobody paid for
        // must not survive the request that failed to pay for it.
        throw new InsufficientCredits();
      }

      return created;
    })
    .catch((error: unknown) => {
      throw reservationFailure(error, {
        cost,
        balance: insufficientBalance ?? 0,
        director: Boolean(director),
      });
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
      imageResolution: input.imageResolution,
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

    /**
     * The provider has accepted the work. Capture.
     *
     * This is the line that divides refundable from billable. Everything before
     * it can be released in full; everything after it has GPU time attached
     * that Replicate will invoice whether or not the output is any good.
     *
     * The month's spend estimate is incremented here rather than on success for
     * the same reason: a job that fails after acceptance still costs money, and
     * a breaker that only counts successes undercounts exactly the runs that
     * are going wrong.
     */
    const estimate = estimateCost(model, outputs, { durationSeconds });

    await captureReservation({
      userId: user.id,
      generationId: generation.id,
      amount: cost,
      providerCostMicroUsd: estimate.costMicroUsd,
    });

    await recordSpend({ costMicroUsd: estimate.costMicroUsd, isFree: free });

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

    /**
     * Say what actually happened, to the one person who can fix it.
     *
     * `insufficient_provider_credit` is a 402 from the vendor: **our** account
     * has run dry, not the user's. The generic message calls that "temporarily
     * unavailable", which reads as an outage on our side and is unactionable —
     * and for a normal user it is the right thing to say, because the fix is
     * not theirs to make and naming a vendor's billing state to a stranger is
     * an operational detail they did not ask for.
     *
     * For an admin it is exactly the wrong message. The account owner is the
     * only person who can top the provider up, and they can only do it if they
     * are told that is the problem. This cost a round trip and half an hour of
     * looking for a bug that was not there.
     */
    const isOwner = await isAdmin().catch(() => false);

    const publicMessage =
      providerFailure?.message ?? "The generation could not be started.";

    const message =
      isOwner && providerFailure?.code === "insufficient_provider_credit"
        ? "The provider account is out of credit — top it up at replicate.com/account/billing. (Shown because you are an admin; other users see a generic message.)"
        : publicMessage;

    /**
     * Submission failed, so the provider never accepted the work.
     *
     * Nothing was billed and the credits go back in full. `releaseReservation`
     * checks for a capture row before paying out, so if the failure somehow
     * happened *after* acceptance — a network error reading a response to a
     * request the provider already queued — it refuses, and the generation is
     * left for manual review rather than being refunded for work we owe money
     * for.
     */
    await releaseReservation({
      userId: user.id,
      generationId: generation.id,
      amount: cost,
      reason: providerFailure?.code ?? "provider_submit_failed",
    });

    // The *stored* failure keeps the public wording: it is read back on the
    // generation row by whoever opens it, admin or not.
    await failGeneration(generation.id, publicMessage);

    throw new GenerationError(
      message,
      502,
      providerFailure?.code ?? "provider_error",
    );
  }
}

/**
 * Give credits back, once, and only when we are not on the hook for them.
 *
 * ## What changed in Sprint 4
 *
 * This used to refund unconditionally. Every failed generation returned the
 * customer's credits — including the ones that failed *after* Replicate had
 * accepted the job and started billing us for GPU time. Atheos paid for the run
 * and handed the money back, so the worst-behaved generations were the most
 * expensive ones, and a model in a bad state cost twice per attempt.
 *
 * `releaseReservation` now checks for a capture row first and refuses if one
 * exists. That refusal is deliberate and it is not silent: it emits
 * `credit.release.refused`, and the generation becomes reviewable through
 * `listCapturedFailures()` below.
 *
 * The decision belongs in the ledger rather than here because there are three
 * call sites — failure, cancellation and the worker — and a policy enforced in
 * three places is a policy enforced in two.
 *
 * Generations created before this sprint carry a `spend:` key and no `capture:`
 * row, so they release normally. The change is not retroactive.
 */
async function refund(
  generationId: string,
  userId: string,
  amount: number,
  reason: string,
) {
  if (amount <= 0) return;

  await releaseReservation({ userId, generationId, amount, reason });
}

/**
 * Failed generations we were billed for and did not refund.
 *
 * The review queue, derived rather than stored: a generation is on it when it
 * has a capture row, no release row, and a terminal failure status. Deriving it
 * means there is no flag to forget to set and no flag to forget to clear.
 *
 * Read by the admin dashboard. Refunding one is a `manual_adjustment`, made
 * deliberately by a person who has looked at it — which is the correct amount
 * of friction for money we have already spent.
 */
export async function listCapturedFailures(limit = 50) {
  const failures = await prisma.generation.findMany({
    where: { status: { in: ["FAILED", "CANCELED"] } },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      userId: true,
      model: true,
      creditsCost: true,
      error: true,
      createdAt: true,
    },
  });

  if (failures.length === 0) return [];

  const keys = failures.flatMap((generation) => [
    `capture:${generation.id}`,
    `release:${generation.id}`,
  ]);

  const rows = await prisma.creditTransaction.findMany({
    where: { idempotencyKey: { in: keys } },
    select: { idempotencyKey: true },
  });

  const seen = new Set(rows.map((row) => row.idempotencyKey));

  return failures.filter(
    (generation) =>
      seen.has(`capture:${generation.id}`) &&
      !seen.has(`release:${generation.id}`),
  );
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

  await refund(
    generationId,
    generation.userId,
    generation.creditsCost,
    "generation_failed",
  );
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

  for (const [index, output] of outputs.entries()) {
    // Sequential rather than parallel: a batch of four large files fetched at
    // once is the shape most likely to hit a serverless memory ceiling, and
    // the latency saved is not worth the failure mode.
    const asset = await storeGeneratedAsset({
      userId,
      generationId,
      sourceUrl: output.sourceUrl,
      mimeType: output.mimeType,
      // Part of the deterministic storage key, so re-running this delivery
      // rewrites the same objects instead of accumulating duplicates.
      index,
    });
    stored.push({ asset, output });
  }

  await inStage("asset_transaction", () =>
    prisma.$transaction(async (tx) => {
      for (const { asset, output } of stored) {
        /**
         * Idempotent by storage key.
         *
         * The key is derived from the generation, the output index and the
         * content hash, so a redelivery of the same output produces the same
         * key. Finding it already present means an earlier attempt got this far
         * — most likely one that uploaded to R2 and then failed before the
         * transaction committed — and creating a second row for one file would
         * show the customer their image twice and double the storage report.
         *
         * A `findFirst` rather than a unique constraint because adding one is a
         * migration, and this transaction already serialises the only writer.
         */
        const existing = await tx.asset.findFirst({
          where: { generationId, storageKey: asset.storageKey },
          select: { id: true },
        });

        if (existing) continue;

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
    }),
  );
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
    await refund(
      generation.id,
      user.id,
      generation.creditsCost,
      "provider_canceled",
    );
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

  await refund(generation.id, user.id, generation.creditsCost, "user_canceled");

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
