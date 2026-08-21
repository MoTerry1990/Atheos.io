import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { rankOf } from "@/services/billing/catalogue";
import type { PlanTier } from "@/lib/generated/prisma/enums";

/**
 * Access and billing are two different facts about an account.
 *
 * ## The defect this pins
 *
 * Sprint 6B bought Creator at $9.99 on the owner account. The billing page
 * reported **"Current plan: Studio"** and opened a **"Move to Creator?"**
 * dialog — offering to move the customer onto the plan they had paid for
 * minutes earlier.
 *
 * Nothing underneath was wrong. Stripe held one active Creator subscription,
 * the mirror row said `CREATOR`, and exactly 500 credits were granted against
 * the paid invoice. The screen was reading `entitlement.tier` — which for an
 * owner is a complimentary Studio grant — and treating it as the answer to
 * "what is this account paying for", a question it never answered.
 *
 * The two coincide for every ordinary customer, which is why one field served
 * for so long, and they diverge for exactly the people who test the product.
 *
 * The tier arithmetic below is the real `rankOf`; the rendering rules are
 * asserted against the component source, because the alternative is mounting a
 * client component that fetches from a live API.
 */

/** The shape the screen consumes, narrowed to the fields it decides from. */
interface Snapshot {
  tier: PlanTier;
  billedTier: PlanTier | null;
  complimentary: boolean;
}

/** The rule the plan cards use to decide which one reads as current. */
function billingTierOf(e: Snapshot): PlanTier | null {
  return e.complimentary ? e.billedTier : e.tier;
}

/** Whether selecting `target` should raise a downgrade confirmation. */
function confirmsDowngrade(e: Snapshot, target: PlanTier): boolean {
  const comparedTo = e.complimentary ? (e.billedTier ?? target) : e.tier;
  return rankOf(target) < rankOf(comparedTo);
}

const OWNER_ON_CREATOR: Snapshot = {
  tier: "STUDIO",
  billedTier: "CREATOR",
  complimentary: true,
};

describe("an owner who pays for Creator", () => {
  it("keeps Studio as effective access", () => {
    // The override is the point: an owner reaches every capability regardless
    // of what they pay for. That must not regress while fixing the display.
    expect(OWNER_ON_CREATOR.tier).toBe("STUDIO");
  });

  it("marks Creator as the current plan on the cards", () => {
    // The card the customer is billed for is the one that reads "current".
    expect(billingTierOf(OWNER_ON_CREATOR)).toBe("CREATOR");
  });

  it("never offers to move to the plan already being billed", () => {
    /**
     * The exact dialog from the report. Selecting Creator while Creator is the
     * billed plan is not a downgrade from Studio — it is the status quo.
     */
    expect(confirmsDowngrade(OWNER_ON_CREATOR, "CREATOR")).toBe(false);
  });

  it("still confirms a genuine downgrade below the billed plan", () => {
    // Creator → Free is a real loss of capability and still asks.
    expect(confirmsDowngrade(OWNER_ON_CREATOR, "FREE")).toBe(true);
  });

  it("treats a move above the billed plan as an upgrade, without a dialog", () => {
    for (const target of ["PRO", "STUDIO"] as const) {
      expect(confirmsDowngrade(OWNER_ON_CREATOR, target), target).toBe(false);
    }
  });

  it("marks no card current when the owner is billed for nothing", () => {
    // The ordinary owner: complimentary Studio, no subscription. Nothing is
    // being paid for, so nothing should claim to be the current plan.
    const owner: Snapshot = {
      tier: "STUDIO",
      billedTier: null,
      complimentary: true,
    };
    expect(billingTierOf(owner)).toBeNull();
    // And selecting any plan is a purchase, never a downgrade confirmation.
    for (const target of ["FREE", "CREATOR", "PRO", "STUDIO"] as const) {
      expect(confirmsDowngrade(owner, target), target).toBe(false);
    }
  });
});

describe("an ordinary customer is unaffected", () => {
  it("uses one tier for both access and billing", () => {
    const customer: Snapshot = {
      tier: "PRO",
      billedTier: "PRO",
      complimentary: false,
    };
    expect(billingTierOf(customer)).toBe("PRO");
    expect(confirmsDowngrade(customer, "PRO")).toBe(false);
    expect(confirmsDowngrade(customer, "CREATOR")).toBe(true);
    expect(confirmsDowngrade(customer, "STUDIO")).toBe(false);
  });

  it("falls back to Free when a subscription lapses", () => {
    /**
     * The case that rules out simply using `billedTier` everywhere. A lapsed
     * subscriber still has a row saying CREATOR, but access is Free — and a
     * card marked "current" for a plan they cannot use would be a lie.
     */
    const lapsed: Snapshot = {
      tier: "FREE",
      billedTier: "CREATOR",
      complimentary: false,
    };
    expect(billingTierOf(lapsed)).toBe("FREE");
    // Re-selecting Creator is a repurchase, not a downgrade.
    expect(confirmsDowngrade(lapsed, "CREATOR")).toBe(false);
  });

  it("marks no card current on Free with nothing billed", () => {
    const free: Snapshot = {
      tier: "FREE",
      billedTier: null,
      complimentary: false,
    };
    expect(billingTierOf(free)).toBe("FREE");
  });
});

describe("the screen renders both facts", () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../..",
      "features/billing/components/billing-screen.tsx",
    ),
    "utf8",
  );

  it("labels complimentary access as such", () => {
    expect(source).toMatch(/Complimentary owner access/);
    expect(source).toMatch(/Effective access/);
  });

  it("shows the billed subscription separately", () => {
    expect(source).toMatch(/Billed subscription:/);
    // With its price, so "Creator" alone cannot be mistaken for free access.
    expect(source).toMatch(/formatMoney\(billedPlan\.monthly\)/);
  });

  it("drives the plan cards from the billing tier, not the access tier", () => {
    /**
     * The single line that caused the defect. If this reverts to
     * `currentTier={entitlement.tier}` the owner sees "Studio" as current
     * again and the move dialog returns.
     */
    expect(source).toMatch(
      /currentTier=\{billingTier \?\? entitlement\.tier\}/,
    );
  });

  it("compares downgrades against the billed plan", () => {
    expect(source).toMatch(/current\.complimentary/);
    expect(source).toMatch(
      /rankOf\(target\)|rankOf\(tier\) < rankOf\(comparedTo\)/,
    );
  });
});

describe("billing controls use the real subscription", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../..", "services/billing/subscription.ts"),
    "utf8",
  );

  it("no longer blanks the period dates for an owner", () => {
    /**
     * They were nulled out, which left the owner's own billing unmanageable
     * from the product: no renewal date, and the cancellation and portal
     * controls had nothing to act on. The dates describe the *subscription*,
     * which an owner can genuinely hold.
     */
    const owner = source.slice(
      source.indexOf("if (user && isOwnerAccount(user))"),
    );
    const block = owner.slice(0, owner.indexOf("};"));
    expect(block).toMatch(/currentPeriodEnd: subscription\?\.currentPeriodEnd/);
    expect(block).toMatch(
      /cancelAtPeriodEnd: subscription\?\.cancelAtPeriodEnd/,
    );
    expect(block).not.toMatch(/currentPeriodEnd: null/);
  });

  it("reports the billed tier from the row and keeps access complimentary", () => {
    const owner = source.slice(
      source.indexOf("if (user && isOwnerAccount(user))"),
    );
    const block = owner.slice(0, owner.indexOf("};"));
    expect(block).toMatch(
      /billedTier: subscription \? subscription\.planTier : null/,
    );
    expect(block).toMatch(/complimentary: true/);
    // Access itself must stay unconditional — that is what the override is for.
    expect(block).toMatch(/active: true/);
  });
});
