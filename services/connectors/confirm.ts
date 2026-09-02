import "server-only";

import { prisma } from "@/lib/prisma";
import {
  CAPABILITY_VERSION,
  quoteKeyFor,
  readPlanToken,
  type ConnectorQuoteRequest,
} from "@/services/ai/plan-token";
import { generationIdForPlan } from "@/services/ai/plan-consumption";
import { COMPILER_VERSION } from "@/services/ai/compile-for-model";
import type { Caller } from "@/services/ai/model-policy";
import { findModel, priceFor, providerForModel } from "@/services/ai/registry";
import type { GenerationOperation } from "@/services/ai/types";
import { reserveWithin } from "@/services/billing/ledger";
import { isStorageConfigured } from "@/services/storage/assets";
import {
  dispatchToProvider,
  GenerationError,
  InsufficientCredits,
  preflightGeneration,
} from "@/services/generation";
import {
  connectorModelById,
  DurationError,
  exactDuration,
  resolveConnectorModel,
} from "@/services/connectors/catalogue";
import { normaliseRequest, requestHash } from "@/services/connectors/prepare";

/**
 * Spend a quote. The only place a connector can cause a charge.
 *
 * ## What the caller may say, and what it may not
 *
 * Three inputs: who they are — resolved from their credential, never from the
 * request — an opaque token, and an idempotency key. That is the whole
 * surface. There is no field for a price, an internal model id, a role, a
 * provider, or a request hash, because every one of those is something a
 * client would eventually send a *different* value for than the one it was
 * quoted. The settings come out of the token's signature; the price is
 * recomputed from the registry and compared.
 *
 * ## Why the ordering is what it is
 *
 * Read the steps as a sequence of increasingly expensive commitments:
 *
 *   1-3  Cryptography. Free, and rejects a forgery without a query.
 *   4-5  One read. Rejects a replay, an expired quote, someone else's quote.
 *   6-9  Policy, settings, price. Rejects work we may not do or may not do at
 *        that price — still before any write.
 *  10-14 One transaction: claim, register, reserve, create. Every one of these
 *        can be undone only by rolling back the others, so they are together.
 *    15  The provider, outside the transaction.
 *
 * A licence check *after* a reservation would charge somebody for a model we
 * are not allowed to run and then depend on a release to put it back. A price
 * check after the claim would consume the quote to tell them it moved.
 *
 * ## The rollback that matters
 *
 * If the reservation fails, everything above it in the transaction goes with
 * it: the quote is not consumed, the idempotency record does not exist, and no
 * generation row survives. A customer who is briefly short of credits has lost
 * nothing but the call — their quote is still spendable. That is asserted
 * against real PostgreSQL in `tests/db/connector-confirm.test.ts`, not argued
 * for here.
 */

export type ConfirmFailure =
  /** Unreadable, unsigned, unknown, or not this caller's. One code, on purpose. */
  | "invalid_quote"
  | "quote_expired"
  | "quote_consumed"
  | "model_unavailable"
  | "model_setting_unavailable"
  | "requote_required"
  | "idempotency_conflict"
  | "idempotency_in_flight"
  | "insufficient_credits"
  | "service_unavailable";

export interface ConfirmResult {
  ok: boolean;
  generationId?: string;
  credits?: number;
  /** True when this call returned an earlier confirmation rather than making one. */
  replayed?: boolean;
  reason?: ConfirmFailure;
  /** Safe to show anyone. Names no vendor, no licence and no other model. */
  message?: string;
}

const UNAVAILABLE = "That model is not available.";

/**
 * Refusals, worded for someone who cannot see our logs.
 *
 * `invalid_quote` covers four different failures — malformed, forged, unknown,
 * belongs to another account — and says so as one. Distinguishing them would
 * tell an integrator with a stolen token which half of it was wrong, and tell
 * anyone that a given quote id exists.
 */
const MESSAGES: Record<ConfirmFailure, string> = {
  invalid_quote:
    "That quote is not valid. Ask for a new one with prepare_generation.",
  quote_expired: "That quote has expired. Ask for a new one.",
  quote_consumed:
    "That quote has already been used. Ask for a new one to generate again.",
  model_unavailable: UNAVAILABLE,
  model_setting_unavailable:
    "Those settings are no longer available for that model. Ask for a new quote.",
  requote_required:
    "The price for those settings has changed since the quote. Ask for a new one.",
  idempotency_conflict:
    "That idempotency key was already used for a different request. Use a new key.",
  idempotency_in_flight:
    "A confirmation with that key is still in progress. Retry shortly.",
  insufficient_credits: "You do not have enough credits for this generation.",
  service_unavailable:
    "Generation is temporarily unavailable. No credits were spent.",
};

function fail(reason: ConfirmFailure): ConfirmResult {
  return { ok: false, reason, message: MESSAGES[reason] };
}

/** What the transaction decided, so a refusal can roll back rather than commit. */
type Outcome =
  | { kind: "created"; generationId: string }
  | { kind: "replayed"; generationId: string }
  | { kind: "refused"; reason: ConfirmFailure };

/**
 * Thrown to roll the transaction back while carrying the reason out of it.
 *
 * A `return` from inside `$transaction` commits. Every refusal below has
 * written something it must not keep — an idempotency record with no
 * generation, most importantly — so refusals leave by exception and the
 * outcome rides along.
 */
class Abort extends Error {
  constructor(readonly outcome: Outcome) {
    super("connector confirmation aborted");
  }
}

/** How long a retry is worth remembering. A day covers any sane client. */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const OPERATION_FOR: Record<string, GenerationOperation> = {
  IMAGE: "text-to-image",
  VIDEO: "text-to-video",
  AUDIO: "text-to-audio",
};

export async function confirmGeneration(input: {
  /** The token `prepare_generation` returned. Opaque to us until verified. */
  token: string;
  /** The client's retry key. Scoped to this user; two customers may share one. */
  idempotencyKey: string;
  /** Resolved from the credential, never from the request body. */
  caller: Caller;
  userId: string;
  nowMs?: number;
}): Promise<ConfirmResult> {
  const nowMs = input.nowMs ?? Date.now();

  if (!input.idempotencyKey?.trim() || input.idempotencyKey.length > 200) {
    return {
      ok: false,
      reason: "invalid_quote",
      message: "Send an idempotency key of up to 200 characters.",
    };
  }

  // ---- 1. Signature, expiry, owner ---------------------------------------
  const opened = readPlanToken({
    token: input.token,
    userId: input.userId,
    nowMs,
  });

  if (!opened.ok) {
    return fail(
      opened.reason === "expired" ? "quote_expired" : "invalid_quote",
    );
  }

  const payload = opened.payload!;
  const quoted: ConnectorQuoteRequest | undefined = payload.connectorRequest;

  // A Studio plan carries no settings, because the browser sends its brief
  // back with the confirmation. It cannot be confirmed headlessly, and
  // guessing what it meant is exactly the client authority this avoids.
  if (!quoted) return fail("invalid_quote");

  /**
   * A quote priced by a capability table or compiler we no longer run
   * describes work that would not be produced now. Requote rather than honour
   * it: the number was true when it was given and is not any more.
   */
  if (
    payload.capabilityVersion !== CAPABILITY_VERSION ||
    payload.compilerVersion !== COMPILER_VERSION
  ) {
    return fail("requote_required");
  }

  // ---- 2. The request hash, derived here from the signed settings ---------
  //
  // Never taken from the caller. The hash is what distinguishes a retry from a
  // key reused for something else, so a client that could supply it could
  // make any two calls look like one.
  const derivedHash = requestHash(
    normaliseRequest({
      publicModelId: quoted.publicModelId,
      prompt: quoted.prompt,
      durationSeconds: quoted.durationSeconds,
      outputs: quoted.outputs,
      aspectRatio: quoted.aspectRatio,
      negativePrompt: quoted.negativePrompt,
      credits: payload.quotedCredits,
    }),
  );

  /**
   * A retry is answered before the quote is examined.
   *
   * Ordering that had to be corrected: the quote checks came first, so the
   * second call of a legitimate retry was refused with `quote_consumed` — the
   * quote having been spent by the *first half of the same call*. That is the
   * exact failure the idempotency table exists to prevent, arriving through
   * the front door.
   *
   * So a matching record short-circuits everything below it. It is a read, and
   * the transaction still holds the authority for the concurrent case: two
   * confirmations arriving together both find nothing here and are separated
   * by the constraint, not by this.
   */
  const prior = await prisma.connectorIdempotency.findUnique({
    where: {
      userId_key: { userId: input.userId, key: input.idempotencyKey },
    },
  });

  if (prior) {
    if (prior.requestHash !== derivedHash) return fail("idempotency_conflict");
    if (!prior.generationId) return fail("idempotency_in_flight");

    const original = await prisma.generation.findUnique({
      where: { id: prior.generationId },
      select: { creditsCost: true },
    });

    return {
      ok: true,
      replayed: true,
      generationId: prior.generationId,
      credits: original?.creditsCost,
    };
  }

  // ---- 3. The quote's key, which is not the quote -------------------------
  const jtiHash = quoteKeyFor(payload.jti);

  // ---- 4-5. Load it, and check it is ours, current and unspent ------------
  const quote = await prisma.connectorQuote.findUnique({ where: { jtiHash } });

  if (!quote || quote.userId !== input.userId) return fail("invalid_quote");
  if (quote.requestHash !== derivedHash) return fail("invalid_quote");
  if (quote.expiresAt.getTime() <= nowMs) return fail("quote_expired");
  if (quote.consumedAt) return fail("quote_consumed");

  // ---- 6. Policy and audience, revalidated at spend time ------------------
  //
  // Not inherited from the quote. A model may have been withdrawn, or a
  // caller's audience narrowed, in the ten minutes since. The quote is a price,
  // never a permission.
  const internalId = resolveConnectorModel(quoted.publicModelId, input.caller);
  const catalogueModel = connectorModelById(quoted.publicModelId, input.caller);
  if (!internalId || !catalogueModel) return fail("model_unavailable");

  const model = findModel(internalId);
  if (!model) return fail("model_unavailable");

  // ---- 7. Settings, revalidated the same way ------------------------------
  let durationSeconds: number | undefined;
  try {
    durationSeconds = exactDuration(catalogueModel, quoted.durationSeconds);
  } catch (error) {
    if (error instanceof DurationError)
      return fail("model_setting_unavailable");
    throw error;
  }

  const outputs = quoted.outputs;
  if (
    !Number.isInteger(outputs) ||
    outputs < 1 ||
    outputs > catalogueModel.maxOutputs
  ) {
    return fail("model_setting_unavailable");
  }

  if (
    quoted.aspectRatio &&
    catalogueModel.aspectRatios.length > 0 &&
    !catalogueModel.aspectRatios.includes(quoted.aspectRatio)
  ) {
    return fail("model_setting_unavailable");
  }

  // ---- 8-9. The price now, against the price then -------------------------
  const credits = priceFor(internalId, outputs, durationSeconds);
  if (credits !== payload.quotedCredits) return fail("requote_required");

  // Checked before spending, as in the Studio path: discovering storage is
  // misconfigured after the provider has run is the expensive order.
  if (!isStorageConfigured() || !providerForModel(internalId)) {
    return fail("service_unavailable");
  }

  let preflight: Awaited<ReturnType<typeof preflightGeneration>>;
  try {
    preflight = await preflightGeneration({
      userId: input.userId,
      modelId: internalId,
      model,
    });
  } catch (error) {
    if (error instanceof GenerationError) {
      // Plan, breaker and rate limits speak for themselves and have already
      // been worded for a customer. Nothing has been written.
      return {
        ok: false,
        reason: "service_unavailable",
        message: error.message,
      };
    }
    throw error;
  }

  const operation = OPERATION_FOR[model.modality] ?? "text-to-image";
  const generationId = generationIdForPlan(input.token);

  let insufficient = false;

  // ---- 10-14. One transaction, or none of it ------------------------------
  let outcome: Outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      /**
       * The idempotency record goes in *first*, deliberately.
       *
       * `ON CONFLICT DO NOTHING` waits for a concurrent inserter to finish
       * before deciding, so a twin request arriving at the same instant blocks
       * here and then reads the committed result — rather than racing past to
       * create a second generation. It is also why a plain `INSERT` and a
       * caught `23505` would be wrong: a constraint violation inside a
       * transaction aborts it, and the row we would then need to read is
       * unreadable.
       */
      const claimedKey = await tx.$queryRaw<{ key: string }[]>`
        INSERT INTO connector_idempotency ("key", "userId", "requestHash", "expiresAt")
        VALUES (${input.idempotencyKey}, ${input.userId}, ${derivedHash},
                ${new Date(nowMs + IDEMPOTENCY_TTL_MS)})
        ON CONFLICT ("userId", "key") DO NOTHING
        RETURNING "key"
      `;

      if (claimedKey.length === 0) {
        const existing = await tx.connectorIdempotency.findUnique({
          where: {
            userId_key: { userId: input.userId, key: input.idempotencyKey },
          },
        });

        // The key is in use for a different call. Not a retry — a client bug,
        // and answering it with the first call's generation would be worse.
        if (!existing || existing.requestHash !== derivedHash) {
          throw new Abort({ kind: "refused", reason: "idempotency_conflict" });
        }

        // Same key, same request: the same call arriving twice. A committed
        // record always has a generation, because both are written together —
        // so a null one means a writer that has not landed.
        if (!existing.generationId) {
          throw new Abort({ kind: "refused", reason: "idempotency_in_flight" });
        }

        throw new Abort({
          kind: "replayed",
          generationId: existing.generationId,
        });
      }

      /**
       * Claim the quote, as one statement.
       *
       * `WHERE "consumedAt" IS NULL` makes the check and the write atomic. A
       * read followed by a write would leave a window a second transaction can
       * step into, and the thing on the other side of that window is a second
       * charge.
       */
      const consumed = await tx.$executeRaw`
        UPDATE connector_quote
           SET "consumedAt" = now()
         WHERE "jtiHash" = ${jtiHash} AND "consumedAt" IS NULL
      `;

      if (consumed !== 1) {
        throw new Abort({ kind: "refused", reason: "quote_consumed" });
      }

      const created = await tx.generation.create({
        data: {
          // Derived from the token, so a replay collides on the primary key
          // inside the transaction — refused by the database rather than by
          // application logic a concurrent request could race past.
          id: generationId,
          userId: input.userId,
          modality: model.modality,
          operation:
            model.modality === "VIDEO"
              ? "TEXT_TO_VIDEO"
              : model.modality === "AUDIO"
                ? "TEXT_TO_AUDIO"
                : "TEXT_TO_IMAGE",
          provider: model.providerId,
          model: internalId,
          prompt: quoted.prompt,
          negativePrompt: quoted.negativePrompt || null,
          parameters: {
            operation,
            aspectRatio: quoted.aspectRatio,
            outputs,
            durationSeconds,
            inputImageUrls: [],
            // How this generation was authorised, for an audit that needs to
            // tell a connector confirmation from a Studio one. No token, no
            // key, no prompt copy — the key is the customer's own string and
            // has no business in a permanent record.
            source: "connector",
          },
          creditsCost: credits,
          status: "QUEUED",
        },
      });

      const reserved = await reserveWithin(tx, {
        userId: input.userId,
        generationId: created.id,
        amount: credits,
        metadata: {
          modelId: internalId,
          outputs,
          durationSeconds,
          tier: preflight.entitledTier,
          source: "connector",
        },
      });

      if (!reserved.ok) {
        insufficient = true;
        /**
         * Takes the claim, the record and the generation with it.
         *
         * This is the case the whole ordering was built for: someone briefly
         * short of credits must not lose their quote. Nothing above has
         * committed, so after this rolls back the quote is unspent and the
         * key is free.
         */
        throw new InsufficientCredits();
      }

      await tx.connectorIdempotency.update({
        where: {
          userId_key: { userId: input.userId, key: input.idempotencyKey },
        },
        data: { generationId: created.id },
      });

      return { kind: "created", generationId: created.id } as Outcome;
    });
  } catch (error) {
    if (error instanceof Abort) outcome = error.outcome;
    else if (insufficient) return fail("insufficient_credits");
    else if ((error as { code?: string }).code === "P2002") {
      /**
       * A unique violation, which here can only be the generation's primary
       * key — the same token confirmed twice. Unreachable while the quote
       * claim above works, and answered honestly rather than as a 500 if it
       * ever is not.
       */
      return fail("quote_consumed");
    } else throw error;
  }

  if (outcome.kind === "refused") return fail(outcome.reason);

  if (outcome.kind === "replayed") {
    /**
     * The retry answer. Returns the original generation rather than a refusal,
     * which is the entire reason the idempotency table exists — and it does
     * not dispatch again, because that generation already reached a provider.
     */
    return {
      ok: true,
      replayed: true,
      generationId: outcome.generationId,
      credits,
    };
  }

  // ---- 15. The provider, outside the transaction --------------------------
  //
  // A failure here has already released the reservation and marked the
  // generation failed — `dispatchToProvider` owns that, and owns it for both
  // callers. What is left is to say so without a stack trace, and without
  // naming the vendor that declined.
  try {
    const dispatched = await dispatchToProvider({
      generation: { id: outcome.generationId },
      model,
      input: {
        operation,
        modelId: internalId,
        prompt: quoted.prompt,
        negativePrompt: quoted.negativePrompt,
        aspectRatio: quoted.aspectRatio,
        outputs,
        durationSeconds,
      },
      userId: input.userId,
      outputs,
      durationSeconds,
      cost: credits,
      isFree: preflight.free,
    });

    return { ok: true, generationId: dispatched.generationId, credits };
  } catch (error) {
    if (error instanceof GenerationError) {
      return {
        ok: false,
        reason: "service_unavailable",
        message: `${error.message} Your credits were returned.`,
      };
    }
    throw error;
  }
}
