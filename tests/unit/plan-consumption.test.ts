import { describe, expect, it } from "vitest";

import {
  checkConsumption,
  generationIdForPlan,
  reservationKeyForPlan,
} from "@/services/ai/plan-consumption";

/**
 * One plan, one paid generation.
 *
 * ## Why this is derivation rather than bookkeeping
 *
 * `CreditTransaction.idempotencyKey` is already `@unique` and reservations
 * already write `reserve:{generationId}`. Deriving the generation id from the
 * token means a replay lands on the same key and Postgres refuses it — no
 * migration, and no in-memory set that would look correct in development and
 * fail on the second serverless instance.
 */

const TOKEN_A = "eyJhIjoxfQ.signature-a";
const TOKEN_B = "eyJhIjoyfQ.signature-b";

describe("the derived generation id", () => {
  it("is stable for the same token", () => {
    // The whole guarantee: same token, same id, forever.
    expect(generationIdForPlan(TOKEN_A)).toBe(generationIdForPlan(TOKEN_A));
  });

  it("differs for different tokens", () => {
    expect(generationIdForPlan(TOKEN_A)).not.toBe(generationIdForPlan(TOKEN_B));
  });

  it("is uuid-shaped, so the rest of the system reads it as opaque", () => {
    expect(generationIdForPlan(TOKEN_A)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("leaks nothing about the token", () => {
    const id = generationIdForPlan(TOKEN_A);
    expect(id).not.toContain("signature");
    expect(TOKEN_A).not.toContain(id);
  });

  it("produces the reservation key the ledger already uses", () => {
    expect(reservationKeyForPlan(TOKEN_A)).toBe(
      `reserve:${generationIdForPlan(TOKEN_A)}`,
    );
  });
});

describe("replay and concurrency", () => {
  it("allows a first submission", () => {
    const result = checkConsumption({
      token: TOKEN_A,
      existingGenerationIds: [],
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a replay after the generation exists", () => {
    /**
     * Covers double-click, browser retry, a second tab and a token copied
     * between sessions — all of them arrive as the same token and derive the
     * same id.
     */
    const first = checkConsumption({
      token: TOKEN_A,
      existingGenerationIds: [],
    });
    const replay = checkConsumption({
      token: TOKEN_A,
      existingGenerationIds: [first.generationId],
    });
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe("already_consumed");
    // And it names the same generation, so the caller can return the original
    // instead of an error the user cannot act on.
    expect(replay.generationId).toBe(first.generationId);
  });

  it("still allows a genuinely different plan", () => {
    const first = checkConsumption({
      token: TOKEN_A,
      existingGenerationIds: [],
    });
    const other = checkConsumption({
      token: TOKEN_B,
      existingGenerationIds: [first.generationId],
    });
    // Planning twice is legitimate — a user may think and plan again.
    expect(other.ok).toBe(true);
  });

  it("refuses a client key reused with a different token", () => {
    /**
     * The pairing a unique constraint cannot see. A caller reuses the key that
     * already succeeded, but sends a *new* plan: the keys match, the tokens do
     * not, and the second plan would otherwise look like a retry of the first.
     */
    const first = checkConsumption({
      token: TOKEN_A,
      existingGenerationIds: [],
    });
    const smuggled = checkConsumption({
      token: TOKEN_B,
      clientIdempotencyKey: "key-123",
      existingGenerationIds: [first.generationId],
      keyByGenerationId: { [first.generationId]: "key-123" },
    });
    expect(smuggled.ok).toBe(false);
    expect(smuggled.reason).toBe("idempotency_mismatch");
  });

  it("accepts the same key with the same token", () => {
    // An honest retry: same plan, same key. It is caught as already_consumed
    // rather than as a mismatch, which is the accurate reason.
    const first = checkConsumption({
      token: TOKEN_A,
      existingGenerationIds: [],
    });
    const retry = checkConsumption({
      token: TOKEN_A,
      clientIdempotencyKey: "key-123",
      existingGenerationIds: [first.generationId],
      keyByGenerationId: { [first.generationId]: "key-123" },
    });
    expect(retry.reason).toBe("already_consumed");
  });

  it("does not depend on process memory", () => {
    /**
     * Stated as a test because it is the property most easily lost. The
     * function holds no state between calls — every decision comes from the
     * ids it is handed, which come from the database.
     */
    const a = checkConsumption({ token: TOKEN_A, existingGenerationIds: [] });
    const b = checkConsumption({ token: TOKEN_A, existingGenerationIds: [] });
    expect(a).toEqual(b);
  });
});
