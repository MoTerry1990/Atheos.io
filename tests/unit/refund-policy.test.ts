import { afterEach, describe, expect, it, vi } from "vitest";

import { planDispute, planRefund } from "@/services/billing/refunds";

/**
 * The subscription refund and dispute policy, and the Stripe config guard.
 *
 * Both are tested against the functions production calls, not against
 * re-implementations of their rules — the lesson of Sprint 5C.2, where a refund
 * policy was wrong in production for a fortnight underneath a green suite.
 */

const base = {
  refundedMinorUnits: 999,
  invoiceMinorUnits: 999,
  grantedCredits: 500,
  currentBalance: 500,
  alreadyReversed: false,
};

describe("a full refund ends access and reclaims what is left", () => {
  it("removes the whole allowance when none of it was spent", () => {
    expect(planRefund(base)).toEqual({
      action: "revoke",
      clawback: 500,
      unrecoverable: 0,
      flagForReview: false,
    });
  });

  it("removes only what remains when some was spent", () => {
    // 500 granted, 180 left. The 320 already spent bought real generations that
    // cost real provider money; they are gone and the account is flagged.
    expect(planRefund({ ...base, currentBalance: 180 })).toEqual({
      action: "revoke",
      clawback: 180,
      unrecoverable: 320,
      flagForReview: true,
    });
  });

  it("never drives the balance negative", () => {
    /**
     * The invariant the whole cap exists for. A balance below zero cannot be
     * explained to a customer, blocks every generation, and violates the drift
     * check that has held at zero for the life of the ledger.
     */
    for (const balance of [0, 1, 250, 499]) {
      const plan = planRefund({ ...base, currentBalance: balance });
      if (plan.action !== "revoke") throw new Error("expected a revoke");
      expect(plan.clawback).toBeLessThanOrEqual(balance);
      expect(balance - plan.clawback).toBeGreaterThanOrEqual(0);
    }
  });

  it("takes nothing when the balance is already empty", () => {
    expect(planRefund({ ...base, currentBalance: 0 })).toEqual({
      action: "revoke",
      clawback: 0,
      unrecoverable: 500,
      flagForReview: true,
    });
  });

  it("never reclaims more than this invoice granted", () => {
    // The customer also holds a signup grant and a credit pack. A refund of one
    // subscription invoice must not reach them: they were paid for separately.
    const plan = planRefund({ ...base, currentBalance: 9_000 });
    if (plan.action !== "revoke") throw new Error("expected a revoke");
    expect(plan.clawback).toBe(500);
  });

  it("takes nothing when the invoice granted nothing", () => {
    // An invoice paid while the plan's allowance was unset granted zero, so
    // there is nothing to reverse — but access still ends.
    expect(planRefund({ ...base, grantedCredits: 0 })).toEqual({
      action: "revoke",
      clawback: 0,
      unrecoverable: 0,
      flagForReview: false,
    });
  });
});

describe("what is never automated", () => {
  it("sends a partial refund to a human", () => {
    // What fraction of an allowance does a half refund entitle someone to keep?
    // The amounts do not answer that, so the code does not pretend to.
    expect(planRefund({ ...base, refundedMinorUnits: 500 })).toEqual({
      action: "manual_review",
      reason: "partial refunds are not settled automatically",
    });
  });

  it("sends a refund larger than its invoice to a human", () => {
    // Not a bigger refund — a sign the charge and the invoice do not match.
    expect(planRefund({ ...base, refundedMinorUnits: 1_500 })).toMatchObject({
      action: "manual_review",
    });
  });

  it("refuses to classify an invoice of unknown value", () => {
    expect(planRefund({ ...base, invoiceMinorUnits: 0 })).toMatchObject({
      action: "manual_review",
    });
  });

  it("refuses a non-positive refund", () => {
    expect(planRefund({ ...base, refundedMinorUnits: 0 })).toMatchObject({
      action: "manual_review",
    });
  });
});

describe("reversing exactly once", () => {
  it("does nothing when this charge was already reversed", () => {
    // Stripe redelivers for days. The second delivery must be inert.
    expect(planRefund({ ...base, alreadyReversed: true })).toEqual({
      action: "already",
    });
  });

  it("stays inert across twenty deliveries of the same event", () => {
    let reversed = false;
    const actions: string[] = [];

    for (let i = 0; i < 20; i += 1) {
      const plan = planRefund({ ...base, alreadyReversed: reversed });
      actions.push(plan.action);
      if (plan.action === "revoke") reversed = true;
    }

    expect(actions.filter((a) => a === "revoke")).toHaveLength(1);
    expect(actions.filter((a) => a === "already")).toHaveLength(19);
  });
});

describe("a dispute is not a refund", () => {
  it("suspends access and flags, without touching credits", () => {
    /**
     * A dispute is a claim; the bank rules on it weeks later. Taking credits
     * from someone who is later found to be in the right would punish them for
     * a decision that had not been made — so the plan has no credit field at
     * all, rather than a zero somebody could later change.
     */
    const plan = planDispute();
    expect(plan).toEqual({ suspendEntitlement: true, flagForReview: true });
    expect(plan).not.toHaveProperty("clawback");
  });
});

describe("Stripe configuration fails closed", () => {
  async function problemsFor(overrides: Record<string, string | undefined>) {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: {
        STRIPE_SECRET_KEY: `sk_test_${"a".repeat(40)}`,
        STRIPE_WEBHOOK_SECRET: `whsec_${"b".repeat(32)}`,
        STRIPE_PRICE_CREATOR_MONTHLY: "price_creator",
        STRIPE_PRICE_PRO_MONTHLY: "price_pro",
        STRIPE_PRICE_STUDIO_MONTHLY: "price_studio",
        NEXT_PUBLIC_APP_URL: "https://atheos-io.vercel.app",
        ...overrides,
      },
    }));
    const { stripeConfigProblems } = await import("@/lib/stripe");
    return stripeConfigProblems();
  }

  afterEach(() => {
    vi.doUnmock("@/lib/env");
    vi.resetModules();
  });

  it("rejects the placeholder that sat in production for three sprints", async () => {
    const problems = await problemsFor({
      STRIPE_SECRET_KEY: "sk_test_placeholder",
    });
    expect(problems[0]).toMatchObject({ variable: "STRIPE_SECRET_KEY" });
    expect(problems[0].problem).toContain("placeholder");
  });

  it("rejects a live key", async () => {
    // Atheos has never taken a real payment. Going live is a reviewed code
    // change, not an environment variable pasted at the wrong moment.
    const problems = await problemsFor({
      STRIPE_SECRET_KEY: `sk_live_${"a".repeat(40)}`,
    });
    expect(problems[0].problem).toContain("LIVE");
  });

  it("rejects a key with a trailing newline", async () => {
    // The exact defect that broke R2 for three sprints, in a different variable.
    const problems = await problemsFor({
      STRIPE_SECRET_KEY: `sk_test_${"a".repeat(40)}\n`,
    });
    expect(problems[0].problem).toContain("whitespace");
  });

  it("rejects a truncated key", async () => {
    const problems = await problemsFor({ STRIPE_SECRET_KEY: "sk_test_abc" });
    expect(problems[0].problem).toContain("too short");
  });

  it("rejects a webhook secret that is not one", async () => {
    const problems = await problemsFor({
      STRIPE_WEBHOOK_SECRET: "not-a-secret",
    });
    expect(problems[0]).toMatchObject({ variable: "STRIPE_WEBHOOK_SECRET" });
  });

  it("rejects a price id that is not one", async () => {
    const problems = await problemsFor({
      STRIPE_PRICE_PRO_MONTHLY: "prod_wrong_object",
    });
    expect(problems[0]).toMatchObject({
      variable: "STRIPE_PRICE_PRO_MONTHLY",
    });
  });

  it("accepts a well-formed test configuration", async () => {
    expect(await problemsFor({})).toEqual([]);
  });

  it("never puts the key in the problem text", async () => {
    // These strings are logged and surfaced in admin status output.
    const key = `sk_test_${"z".repeat(40)}\n`;
    const problems = await problemsFor({ STRIPE_SECRET_KEY: key });
    expect(JSON.stringify(problems)).not.toContain("z".repeat(40));
  });
});
