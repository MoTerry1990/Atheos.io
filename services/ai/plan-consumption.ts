import { createHash } from "node:crypto";

/**
 * One plan, one paid generation — enforced by the database, not by memory.
 *
 * ## Why no migration was needed
 *
 * `CreditTransaction.idempotencyKey` is already `String? @unique`, and every
 * reservation already writes `reserve:{generationId}`. That unique constraint is
 * a durable single-consumption primitive sitting in the schema: the second
 * insert of the same key is rejected by Postgres, not by application logic that
 * a concurrent request can race past.
 *
 * So a plan consumes by deriving its generation id **deterministically from the
 * token**. A replay produces the same id, which produces the same reservation
 * key, which the database refuses. A double-click, a browser retry, two tabs and
 * a copied token all collapse onto the same row.
 *
 * An in-memory set would have looked like it worked in development and failed
 * on the second serverless instance.
 *
 * ## Why the token and not the brief
 *
 * The brief can legitimately be planned twice — a user may open the composer,
 * think, and plan again. Two plans are two tokens and two legitimate
 * generations. It is the *token* that must be single-use.
 */

/** Namespaced so a plan id can never collide with an unrelated uuid. */
const NAMESPACE = "atheos:creative-plan:v1";

/**
 * A stable UUIDv5-shaped id derived from the token.
 *
 * Shaped like a uuid because the column is a uuid and the rest of the system
 * reads generation ids as opaque. The bytes are a SHA-256 of the token, so it
 * carries no secret and cannot be reversed to one.
 */
export function generationIdForPlan(token: string): string {
  const digest = createHash("sha256")
    .update(`${NAMESPACE}:${token}`)
    .digest("hex");

  // Version 5, RFC 4122 variant. Not a real name-based uuid, but the same
  // shape and the same guarantee: same input, same id, forever.
  const v = digest.slice(0, 32).split("");
  v[12] = "5";
  v[16] = ((parseInt(v[16], 16) & 0x3) | 0x8).toString(16);
  const hex = v.join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** The reservation key this plan will write. Collides on replay, by design. */
export function reservationKeyForPlan(token: string): string {
  return `reserve:${generationIdForPlan(token)}`;
}

export type ConsumptionRejection = "already_consumed" | "idempotency_mismatch";

export interface ConsumptionCheck {
  ok: boolean;
  generationId: string;
  reservationKey: string;
  reason?: ConsumptionRejection;
}

/**
 * Decide whether this submission may proceed, before touching the database.
 *
 * The database is still the authority — this is the cheap check that avoids a
 * pointless round trip and, more importantly, catches the mismatched pairing
 * that a unique constraint cannot see: the same idempotency key sent with a
 * *different* token, which is a client trying to launder a second plan through
 * a key that already succeeded.
 */
export function checkConsumption(input: {
  token: string;
  /** The client's own key, if it sent one. */
  clientIdempotencyKey?: string;
  /** Generation ids already recorded for this user's plans. */
  existingGenerationIds: readonly string[];
  /** What key the client used last time, keyed by generation id. */
  keyByGenerationId?: Readonly<Record<string, string>>;
}): ConsumptionCheck {
  const generationId = generationIdForPlan(input.token);
  const reservationKey = reservationKeyForPlan(input.token);

  if (input.existingGenerationIds.includes(generationId)) {
    return {
      ok: false,
      generationId,
      reservationKey,
      reason: "already_consumed",
    };
  }

  /**
   * The same client key must not arrive with a different token.
   *
   * Otherwise a caller could reuse a key that already produced a generation to
   * smuggle a second plan past the constraint — the keys would match, the
   * tokens would not, and the second plan would look like a retry of the first.
   */
  if (input.clientIdempotencyKey && input.keyByGenerationId) {
    for (const [existingId, key] of Object.entries(input.keyByGenerationId)) {
      if (key === input.clientIdempotencyKey && existingId !== generationId) {
        return {
          ok: false,
          generationId,
          reservationKey,
          reason: "idempotency_mismatch",
        };
      }
    }
  }

  return { ok: true, generationId, reservationKey };
}
