import "server-only";

import { createHash } from "node:crypto";

import type { Caller } from "@/services/ai/model-policy";
import {
  rejectImpossibleAudio,
  type AudioIntent,
} from "@/services/ai/audio-routing";
import { prisma } from "@/lib/prisma";
import {
  issuePlanToken,
  PLAN_TTL_SECONDS,
  quoteKeyFor,
} from "@/services/ai/plan-token";
import { priceFor } from "@/services/ai/registry";
import {
  connectorModelById,
  DurationError,
  exactDuration,
  resolveConnectorModel,
  type ConnectorModel,
} from "@/services/connectors/catalogue";

/**
 * Quote a generation. Charge nothing, create nothing, call nobody.
 *
 * ## Why this is a service and not a route
 *
 * The Studio authenticates with a Clerk session; MCP authenticates with an API
 * key that resolves to a user. Those are two front doors into one decision —
 * may this person run this model, with these settings, at what price — and the
 * moment each door answers it separately they start to disagree. MCP already
 * proved that: it had its own catalogue and offered Score at 20 credits while
 * every other surface refused it.
 *
 * So `caller` arrives as a resolved value. Nothing here reads a session, a
 * header or a request field to decide who is asking, which also means there is
 * no field a client could set to become the owner.
 *
 * ## What "prepare" is allowed to touch
 *
 * Nothing. No ledger row, no generation, no provider. The only output is a
 * description and a signed token, and the token is what makes the price
 * binding — `confirmGeneration` re-derives the hash and refuses anything that
 * moved in between.
 */

/** What a caller asks for. Public ids and settings; never a price. */
export interface PrepareRequest {
  publicModelId: string;
  prompt: string;
  durationSeconds?: number;
  outputs?: number;
  aspectRatio?: string;
  negativePrompt?: string;
  /**
   * What the caller wants to happen to sound.
   *
   * Defaults to `AUTO`, which is "whatever the model does" and can never
   * conflict. The other two are promises, and a promise a model cannot keep is
   * refused here rather than discovered after the credits are gone.
   */
  audio?: AudioIntent;
}

export type PrepareFailure =
  "model_unavailable" | "model_setting_unavailable" | "invalid_request";

/** What a caller gets back. Nothing in here names a vendor. */
export interface PreparedGeneration {
  model: {
    id: string;
    name: string;
    modality: ConnectorModel["modality"];
    audio: ConnectorModel["audio"];
    audioNote: string;
  };
  settings: {
    durationSeconds?: number;
    outputs: number;
    aspectRatio?: string;
  };
  credits: number;
  estimatedWaitSeconds: { min: number; max: number };
  expiresAtMs: number;
  /**
   * Always true. Present so an agent reading the response has to notice that
   * a second, explicit step exists rather than inferring it from the shape.
   */
  confirmationRequired: true;
  /** Opaque. Carries no readable model id, price or account. */
  token: string;
}

export interface PrepareResult {
  ok: boolean;
  prepared?: PreparedGeneration;
  /**
   * The row `recordQuote` writes. **Not part of the response.**
   *
   * Kept beside `prepared` rather than written here so this function stays
   * synchronous, hermetic and free of database access — the same reason
   * `resolveDirectorSubmission` takes resolved references rather than
   * resolving them. `prepareAndRecordGeneration` is what puts the two
   * together, and it is the only thing a route should call.
   */
  quoteRecord?: {
    jtiHash: string;
    userId: string;
    requestHash: string;
    publicModelId: string;
    quotedCredits: number;
    capabilityVersion: number;
    compilerVersion: number;
    expiresAt: Date;
  };
  /**
   * Digest of the normalised request. **Not part of the response.**
   *
   * Sits beside `prepared` rather than inside it so a route can persist it
   * with the quote without it reaching a caller. `confirmGeneration` recomputes
   * the same digest from the verified token and compares: equal means a retry
   * of the same call, different means an idempotency key reused for something
   * else.
   *
   * A digest, never the prompt — the row this ends up in is operational
   * bookkeeping, not a copy of what the customer wrote.
   */
  requestHash?: string;
  reason?: PrepareFailure;
  /** Safe to show anyone. Names no vendor, no licence and no other model. */
  message?: string;
}

const UNAVAILABLE = "That model is not available.";

/**
 * The settings a quote is bound to, in a fixed order.
 *
 * Hashed into the token, so confirming with anything different changes the
 * hash and fails verification. Order is fixed because two objects with the
 * same values and different key order would otherwise hash differently and
 * refuse a legitimate confirmation.
 */
export function normaliseRequest(input: {
  publicModelId: string;
  prompt: string;
  durationSeconds?: number;
  outputs: number;
  aspectRatio?: string;
  negativePrompt?: string;
  credits: number;
}): string {
  return JSON.stringify([
    input.publicModelId,
    input.prompt,
    input.durationSeconds ?? null,
    input.outputs,
    input.aspectRatio ?? null,
    input.negativePrompt ?? null,
    input.credits,
  ]);
}

/** Stable digest of a normalised request. Never the prompt itself. */
export function requestHash(normalised: string): string {
  return createHash("sha256").update(normalised).digest("hex");
}

export function prepareGeneration(
  request: PrepareRequest,
  caller: Caller,
  userId: string,
  nowMs: number = Date.now(),
): PrepareResult {
  if (!request.prompt?.trim()) {
    return {
      ok: false,
      reason: "invalid_request",
      message: "Describe what you want to make.",
    };
  }

  /**
   * Policy before anything else.
   *
   * Returns null for an unknown id, a provider path, a blocked model or one
   * this caller may not run — without distinguishing between them, because
   * "that exists but is not for you" tells an integrator an owner-only
   * catalogue exists.
   */
  const internalId = resolveConnectorModel(request.publicModelId, caller);
  const model = connectorModelById(request.publicModelId, caller);

  if (!internalId || !model) {
    return { ok: false, reason: "model_unavailable", message: UNAVAILABLE };
  }

  let durationSeconds: number | undefined;
  try {
    durationSeconds = exactDuration(model, request.durationSeconds);
  } catch (error) {
    if (error instanceof DurationError) {
      return {
        ok: false,
        reason: "model_setting_unavailable",
        message: `That clip length is not available. ${error.message}`,
      };
    }
    throw error;
  }

  const outputs = request.outputs ?? 1;
  if (!Number.isInteger(outputs) || outputs < 1 || outputs > model.maxOutputs) {
    return {
      ok: false,
      reason: "model_setting_unavailable",
      message:
        model.maxOutputs === 1
          ? "This model produces a single output per generation."
          : `Choose a whole number of outputs between 1 and ${model.maxOutputs}.`,
    };
  }

  if (
    request.aspectRatio &&
    model.aspectRatios.length > 0 &&
    !model.aspectRatios.includes(request.aspectRatio)
  ) {
    return {
      ok: false,
      reason: "model_setting_unavailable",
      message: `Choose one of: ${model.aspectRatios.join(", ")}.`,
    };
  }

  /**
   * Audio, checked on the server and not only in the composer.
   *
   * Placed with the other settings and *before* `priceFor`, because an
   * impossible combination must be refused without a price ever being quoted
   * — a quote is an offer, and offering silence from a model that cannot be
   * silent is an offer we would have to withdraw after taking the money.
   *
   * `rejectImpossibleAudio` had existed for a while as "the server-side rule"
   * and was called by nothing. This is the call.
   */
  const audioProblem = rejectImpossibleAudio({
    modelId: internalId,
    intent: request.audio ?? "AUTO",
  });

  if (audioProblem) {
    return {
      ok: false,
      reason: "model_setting_unavailable",
      message: audioProblem,
    };
  }

  // The one function that knows a price. Nothing here holds a copy, and no
  // figure from the request is read.
  const credits = priceFor(internalId, outputs, durationSeconds);

  const normalised = normaliseRequest({
    publicModelId: request.publicModelId,
    prompt: request.prompt,
    durationSeconds,
    outputs,
    aspectRatio: request.aspectRatio,
    negativePrompt: request.negativePrompt,
    credits,
  });

  /**
   * Signed with the same machinery the Studio's plan uses.
   *
   * A second token format would be a second verifier to keep correct. The
   * payload binds the caller, the public model, the normalised settings and
   * the quoted price; `briefHash` covers the whole object, so changing any of
   * them between prepare and confirm changes the hash.
   */
  const { token, payload } = issuePlanToken({
    userId,
    brief: {
      version: 1,
      originalPrompt: request.prompt,
      kind: "sequence",
      publicModelId: request.publicModelId,
      mode: "single",
      durationSeconds: durationSeconds ?? 0,
      outputs,
      clips: 1,
    },
    modelId: request.publicModelId,
    quotedCredits: credits,
    /**
     * Carried inside the signature so confirmation needs nothing from the
     * client but the token itself. The settings here are the *resolved* ones —
     * the duration that survived `exactDuration`, not the one that was asked
     * for — so confirming re-validates what was quoted rather than what was
     * typed.
     */
    connectorRequest: {
      publicModelId: request.publicModelId,
      prompt: request.prompt,
      durationSeconds,
      outputs,
      aspectRatio: request.aspectRatio,
      negativePrompt: request.negativePrompt,
    },
    nowMs,
  });

  const hash = requestHash(normalised);

  return {
    ok: true,
    requestHash: hash,
    quoteRecord: {
      jtiHash: quoteKeyFor(payload.jti),
      userId,
      requestHash: hash,
      publicModelId: request.publicModelId,
      quotedCredits: credits,
      capabilityVersion: payload.capabilityVersion,
      compilerVersion: payload.compilerVersion,
      expiresAt: new Date(payload.expiresAtMs),
    },
    prepared: {
      model: {
        id: model.id,
        name: model.name,
        modality: model.modality,
        audio: model.audio,
        audioNote: model.audioNote,
      },
      settings: {
        durationSeconds,
        outputs,
        aspectRatio: request.aspectRatio,
      },
      credits,
      estimatedWaitSeconds: {
        min: model.modality === "VIDEO" ? 60 : 5,
        max: model.modality === "VIDEO" ? 300 : 30,
      },
      expiresAtMs: payload.expiresAtMs,
      confirmationRequired: true,
      token,
    },
  };
}

/**
 * Quote, and remember that we did.
 *
 * The row is what makes a quote spendable exactly once. It holds no prompt,
 * no token and no provider — only the fact that a price was offered to an
 * account, what it was, and whether it has been taken up.
 *
 * A failed quote writes nothing, which is the reason the write is here rather
 * than at the top: an unavailable model must not leave a row behind.
 */
export async function prepareAndRecordGeneration(
  request: PrepareRequest,
  caller: Caller,
  userId: string,
  nowMs: number = Date.now(),
): Promise<PrepareResult> {
  const result = prepareGeneration(request, caller, userId, nowMs);
  if (!result.ok || !result.quoteRecord) return result;

  await prisma.connectorQuote.create({ data: result.quoteRecord });
  return result;
}

export { PLAN_TTL_SECONDS };
