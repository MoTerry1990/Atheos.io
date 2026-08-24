import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The free grant, and the three gates that stop it being a faucet.
 *
 * ## Why each of these is worth a test
 *
 * The grant tripled, from 100 to 300. Everything that makes that safe is a
 * refusal — an unverified address, a disposable domain, an address that has
 * been granted before — and a refusal that silently stops working looks exactly
 * like a refusal that never fires. There is no user-visible symptom until the
 * bill arrives.
 */

const signupGrantCreate = vi.fn();
const userUpdate = vi.fn();
const creditTransactionCreate = vi.fn();
const emit = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        signupGrant: { create: signupGrantCreate },
        user: { update: userUpdate },
        creditTransaction: { create: creditTransactionCreate },
      }),
  },
}));

vi.mock("@/lib/events", () => ({ emit: (...a: unknown[]) => emit(...a) }));

const {
  emailHash,
  grantSignupCreditsIfEligible,
  isGrantableAddress,
  normaliseEmail,
} = await import("@/services/users/signup-grant");
const { SIGNUP_GRANT } = await import("@/services/billing/catalogue");

/** A unique-constraint violation, as Prisma reports one. */
function uniqueViolation(target: string) {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { target: [target] },
  });
}

const ALICE = {
  userId: "u_alice",
  clerkId: "user_alice",
  email: "alice@example.com",
  emailVerified: true,
};

beforeEach(() => {
  signupGrantCreate.mockReset().mockResolvedValue({});
  userUpdate.mockReset().mockResolvedValue({ creditBalance: SIGNUP_GRANT });
  creditTransactionCreate.mockReset().mockResolvedValue({});
  emit.mockReset();
});

describe("the grant is 300", () => {
  it("grants the catalogue amount, once", async () => {
    const result = await grantSignupCreditsIfEligible(ALICE);

    expect(SIGNUP_GRANT).toBe(300);
    expect(result).toEqual({ granted: true, credits: 300 });
    expect(userUpdate).toHaveBeenCalledOnce();
    expect(userUpdate.mock.calls[0][0].data.creditBalance).toEqual({
      increment: 300,
    });
  });

  it("writes a SIGNUP_GRANT ledger row with the same auditability as a subscription grant", async () => {
    await grantSignupCreditsIfEligible(ALICE);

    const row = creditTransactionCreate.mock.calls[0][0].data;
    expect(row.reason).toBe("SIGNUP_GRANT");
    expect(row.amount).toBe(300);
    expect(row.balanceAfter).toBe(300);
    // Unique in the database, exactly as `invoice:{id}` is for subscriptions.
    expect(row.idempotencyKey).toBe("signup-grant:user_alice");
  });

  it("records the address before the money moves", async () => {
    /**
     * Order matters. If the address record is written second, two concurrent
     * sign-ins both pass the balance update and only the loser rolls back —
     * after the increment. Writing it first makes the collision happen before
     * anything is credited.
     */
    const order: string[] = [];
    signupGrantCreate.mockImplementation(async () => {
      order.push("address");
      return {};
    });
    userUpdate.mockImplementation(async () => {
      order.push("balance");
      return { creditBalance: 300 };
    });

    await grantSignupCreditsIfEligible(ALICE);
    expect(order).toEqual(["address", "balance"]);
  });
});

describe("gate 1 — verified email only", () => {
  it("refuses an unverified address", async () => {
    const result = await grantSignupCreditsIfEligible({
      ...ALICE,
      emailVerified: false,
    });

    expect(result).toEqual({ granted: false, reason: "email_unverified" });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(signupGrantCreate).not.toHaveBeenCalled();
  });

  it("does not log an unverified address as abuse", async () => {
    // Almost everyone lands here once, between signing up and clicking. Logging
    // it would bury the signals that matter.
    await grantSignupCreditsIfEligible({ ...ALICE, emailVerified: false });
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("gate 2 — disposable domains", () => {
  for (const email of [
    "a@mailinator.com",
    "a@10minutemail.com",
    "a@yopmail.com",
    "a@guerrillamail.com",
  ]) {
    it(`refuses ${email.split("@")[1]}`, async () => {
      const result = await grantSignupCreditsIfEligible({ ...ALICE, email });
      expect(result).toEqual({ granted: false, reason: "disposable_email" });
      expect(userUpdate).not.toHaveBeenCalled();
    });
  }

  for (const email of [
    "a@gmail.com",
    "a@protonmail.com",
    "someone@a-real-company.co.uk",
  ]) {
    it(`allows ${email.split("@")[1]}`, () => {
      expect(isGrantableAddress(email)).toBe(true);
    });
  }

  it("logs the domain and never the address", async () => {
    await grantSignupCreditsIfEligible({
      ...ALICE,
      email: "bob@mailinator.com",
    });

    const [name, payload] = emit.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(name).toBe("grant.blocked_disposable");
    expect(payload.domain).toBe("mailinator.com");
    // Enough to spot a pattern; not enough to reconstruct who signed up.
    expect(JSON.stringify(payload)).not.toContain("bob@");
  });
});

describe("gate 3 — one grant per address, ever", () => {
  it("refuses a second grant to the same address after the account was deleted", async () => {
    /**
     * The attack this exists for: delete the account, sign up again with the
     * same address, collect another 300. `credit_transactions` cascades on user
     * delete, so the ledger cannot answer this — `signup_grants` has no foreign
     * key and survives.
     */
    signupGrantCreate.mockRejectedValue(uniqueViolation("emailHash"));

    const result = await grantSignupCreditsIfEligible(ALICE);

    expect(result).toEqual({ granted: false, reason: "already_granted" });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(creditTransactionCreate).not.toHaveBeenCalled();
  });

  it("logs a repeat address for the abuse view", async () => {
    signupGrantCreate.mockRejectedValue(uniqueViolation("emailHash"));
    await grantSignupCreditsIfEligible(ALICE);
    expect(emit.mock.calls[0][0]).toBe("grant.blocked_repeat_email");
  });

  it("distinguishes a repeat account from a repeat address", async () => {
    // Same account granted twice is a retried webhook, not abuse.
    creditTransactionCreate.mockRejectedValue(
      uniqueViolation("idempotencyKey"),
    );

    const result = await grantSignupCreditsIfEligible(ALICE);
    expect(result).toEqual({
      granted: false,
      reason: "already_granted_this_account",
    });
    expect(emit).not.toHaveBeenCalledWith(
      "grant.blocked_repeat_email",
      expect.anything(),
    );
  });

  it("rethrows anything that is not a unique violation", async () => {
    // A dropped connection must not read as "already granted" and silently
    // deny somebody their credits.
    signupGrantCreate.mockRejectedValue(new Error("connection reset"));
    await expect(grantSignupCreditsIfEligible(ALICE)).rejects.toThrow(
      /connection reset/,
    );
  });
});

describe("address normalisation closes the aliasing loopholes", () => {
  it("strips sub-addressing on every domain", () => {
    // `+tag` reaches the same mailbox everywhere that matters.
    expect(normaliseEmail("user+1@example.com")).toBe("user@example.com");
    expect(normaliseEmail("user+anything@fastmail.com")).toBe(
      "user@fastmail.com",
    );
  });

  it("collapses dots for Gmail only", () => {
    expect(normaliseEmail("u.s.e.r@gmail.com")).toBe("user@gmail.com");
    expect(normaliseEmail("u.s.e.r@googlemail.com")).toBe(
      "user@googlemail.com",
    );

    /**
     * Not for anybody else. `j.smith@company.com` and `jsmith@company.com` are
     * two different people at the same firm, and collapsing them would deny the
     * second a grant they are entitled to.
     */
    expect(normaliseEmail("j.smith@company.com")).toBe("j.smith@company.com");
  });

  it("lower-cases and trims", () => {
    expect(normaliseEmail("  Alice@Example.COM ")).toBe("alice@example.com");
  });

  it("hashes to the same value for every alias of one mailbox", () => {
    const canonical = emailHash("user@gmail.com");
    expect(emailHash("US.ER+promo@gmail.com")).toBe(canonical);
    expect(emailHash("u.s.e.r@gmail.com")).toBe(canonical);
    // A different mailbox must not collide.
    expect(emailHash("user@outlook.com")).not.toBe(canonical);
  });

  it("stores a hash, never the address", () => {
    const hash = emailHash("alice@example.com");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("alice");
  });
});
