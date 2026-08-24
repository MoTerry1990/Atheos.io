import { describe, expect, it, vi } from "vitest";

/**
 * What a caller is told when a reservation fails.
 *
 * ## The bug this pins
 *
 * Observed during the live Step 3 proof. A plan token was submitted twice. The
 * second attempt was refused exactly as designed — the Director derives a
 * deterministic generation id, so the replay collided on the primary key inside
 * the transaction, no second row was written and no second reservation was
 * taken. The defence worked.
 *
 * The *answer* was wrong: `500 Something went wrong starting that generation.`
 * A replay is not a server fault, and telling a client the server broke is how
 * a client that lost its first response decides to try a third time.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { GenerationError, InsufficientCredits, reservationFailure } =
  await import("@/services/generation");

const CONTEXT = { cost: 90, balance: 10, director: true };

/** A unique-constraint violation, as Prisma reports one. */
const collision = Object.assign(new Error("Unique constraint failed"), {
  code: "P2002",
  meta: { target: ["id"] },
});

describe("a replayed plan", () => {
  it("is a 409, not a 500", () => {
    const result = reservationFailure(collision, CONTEXT);

    expect(result).toBeInstanceOf(GenerationError);
    expect((result as InstanceType<typeof GenerationError>).status).toBe(409);
    expect((result as InstanceType<typeof GenerationError>).code).toBe(
      "plan_already_submitted",
    );
  });

  it("says what happened in the customer's terms", () => {
    const result = reservationFailure(collision, CONTEXT) as InstanceType<
      typeof GenerationError
    >;

    expect(result.message).toBe("That plan has already been submitted.");
    // Not the internal vocabulary. "P2002" and "constraint" mean nothing to
    // whoever is reading this in a client.
    expect(result.message).not.toMatch(/P2002|constraint|transaction/i);
  });

  it("only claims a replay on the path that has deterministic ids", () => {
    /**
     * Without the Director there is no derived id, so a `P2002` from this
     * transaction means something genuinely unexpected. Reporting it as
     * "already submitted" would hide a real fault behind a friendly message.
     */
    const result = reservationFailure(collision, {
      ...CONTEXT,
      director: false,
    });

    expect(result).toBe(collision);
    expect(result).not.toBeInstanceOf(GenerationError);
  });
});

describe("the other translations still hold", () => {
  it("turns an empty balance into a 402 that names both numbers", () => {
    const result = reservationFailure(
      new InsufficientCredits(),
      CONTEXT,
    ) as InstanceType<typeof GenerationError>;

    expect(result.status).toBe(402);
    expect(result.code).toBe("insufficient_credits");
    // Both numbers, so the answer is actionable rather than just a refusal.
    expect(result.message).toContain("90");
    expect(result.message).toContain("10");
  });

  it("passes an unrecognised failure through untouched", () => {
    // A dropped connection must still reach the route's 500 and its log rather
    // than being dressed up as a business outcome.
    const boom = new Error("connection reset");
    expect(reservationFailure(boom, CONTEXT)).toBe(boom);
  });

  it("does not mistake another unique violation for a replay", () => {
    // A collision on a different column is not a resubmitted plan.
    const other = Object.assign(new Error("Unique constraint failed"), {
      code: "P2010",
    });
    expect(reservationFailure(other, CONTEXT)).toBe(other);
  });
});
