import { describe, expect, it } from "vitest";

import {
  PACK_DEFINITIONS,
  PLAN_DEFINITIONS,
  SIGNUP_GRANT,
  visiblePlanDefinitions,
  formatMoney,
  isUpgrade,
  rankOf,
} from "@/services/billing/catalogue";
import { PRICING } from "@/features/marketing/content";
import { planDefinitionFor } from "@/services/billing/catalogue";
import { COMPARISON_ROWS } from "@/features/marketing/plan-comparison-rows";

/**
 * The pricing page is the one surface where being wrong is a refund.
 *
 * Everything here guards a failure that renders *successfully* — a comparison
 * row one cell short, a yearly total that is not twelve months, a plan and a
 * pack quietly priced identically. None of them break the build, and all of
 * them are found by the customer rather than by us.
 */

describe("plan catalogue", () => {
  it("has a free tier first and prices ascending after it", () => {
    const visible = visiblePlanDefinitions();
    expect(visible[0]?.monthly).toBe(0);

    const paid = visible.slice(1).map((p) => p.monthly);
    expect(paid).toEqual([...paid].sort((a, b) => a - b));
  });

  it("prices the four launch plans exactly as agreed", () => {
    // Free $0 / Creator $9.99 / Pro $34.99 / Studio $89.99, monthly only.
    // Pinned because these are the numbers the founder committed to, and a
    // pricing page is the one surface where a typo is a contract.
    expect(visiblePlanDefinitions().map((p) => [p.name, p.monthly])).toEqual([
      ["Free", 0],
      ["Creator", 999],
      ["Pro", 3499],
      ["Studio", 8999],
    ]);
  });

  it("never advertises a credit allowance it has not settled", () => {
    /**
     * An unverified provider cost must never become a number on a pricing card.
     * Sprint 6A settled the paid allowances against the enforced 2.5x margin
     * floor, so the assertion moved from "paid plans are null" to the thing
     * that actually matters: whatever is shown is what the webhook grants.
     */
    for (const plan of visiblePlanDefinitions()) {
      if (plan.tier === "FREE") {
        expect(plan.monthlyCredits).toBe(SIGNUP_GRANT);
        continue;
      }

      // A paid plan may be null (unsettled) or a positive integer, never zero
      // or a fraction — a fractional allowance cannot be granted.
      if (plan.monthlyCredits !== null) {
        expect(Number.isInteger(plan.monthlyCredits)).toBe(true);
        expect(plan.monthlyCredits).toBeGreaterThan(0);
      }
    }
  });

  it("sells no annual billing and no plan above Studio", () => {
    for (const plan of PLAN_DEFINITIONS) {
      expect(Object.keys(plan)).not.toContain("yearly");
    }
    // The $199 Agency tier is gone; STUDIO now labels the $89.99 top plan.
    expect(visiblePlanDefinitions().map((p) => p.name)).not.toContain("Agency");
    expect(visiblePlanDefinitions()).toHaveLength(4);
  });

  it("ranks every tier, ascending with price", () => {
    // Not "in catalogue order" any more: BASIC is retired and sits last in the
    // array while still ranking second. What must hold is that rank rises with
    // price, because `isUpgrade` decides whether a change takes effect now or
    // at the end of the period.
    const visible = visiblePlanDefinitions();
    const ranks = visible.map((p) => rankOf(p.tier));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(isUpgrade("FREE", "STUDIO")).toBe(true);
    expect(isUpgrade("STUDIO", "FREE")).toBe(false);
    expect(isUpgrade("CREATOR", "CREATOR")).toBe(false);
  });

  it("does not sell a pack at the same price as a plan", () => {
    // Two products, same money, same credits, same page. Whichever one the
    // reader picks they will wonder what the other did, which is a worse
    // outcome than not offering the choice.
    const planPrices = new Set(visiblePlanDefinitions().map((p) => p.monthly));
    for (const pack of PACK_DEFINITIONS) {
      expect(planPrices.has(pack.amount)).toBe(false);
    }
  });

  it("gives packs a better rate the larger they get", () => {
    const rates = PACK_DEFINITIONS.map((p) => p.amount / p.credits);
    expect(rates).toEqual([...rates].sort((a, b) => b - a));
  });
});

describe("marketing pricing cards", () => {
  it("carries one card per visible plan, and none for the retired one", () => {
    expect(PRICING).toHaveLength(visiblePlanDefinitions().length);
    expect(PRICING.map((tier) => tier.tier)).not.toContain("BASIC");
  });

  it("carries no yearly figure at all", () => {
    for (const tier of PRICING) {
      expect(Object.keys(tier)).not.toContain("yearly");
      expect(Object.keys(tier)).not.toContain("yearlyTotal");
    }
  });

  it("leaves the credit line null wherever the allowance is unsettled", () => {
    // Tied to the allowance, not to the launch status. A plan can be settled
    // and still unbuyable — which is exactly where the paid tiers sit today.
    for (const tier of PRICING) {
      const settled = planDefinitionFor(tier.tier).monthlyCredits;
      expect(tier.credits === null, tier.tier).toBe(settled === null);
    }
  });

  it("shows the same allowance the webhook would grant", () => {
    /**
     * The failure this prevents is the worst kind in billing: a card promising
     * 2,000 credits while `onInvoicePaid` grants 1,800. Both numbers come from
     * `planDefinitionFor`, and this asserts the pricing card did not transform
     * one on its way to the page.
     */
    for (const tier of PRICING) {
      const settled = planDefinitionFor(tier.tier).monthlyCredits;
      if (settled === null) continue;
      expect(tier.credits, tier.tier).toBe(settled.toLocaleString("en-US"));
    }
  });

  it("formats money without dropping cents", () => {
    expect(formatMoney(999)).toBe("$9.99");
    expect(formatMoney(3499)).toBe("$34.99");
    expect(formatMoney(8999)).toBe("$89.99");
  });
});

describe("plan comparison table", () => {
  it("gives every row a cell for every plan", () => {
    for (const row of COMPARISON_ROWS) {
      expect(
        row.values,
        `row "${row.label}" has ${row.values.length} cells`,
      ).toHaveLength(visiblePlanDefinitions().length);
    }
  });

  it("never withdraws a boolean capability from a more expensive plan", () => {
    // A feature ticked on Creator and blank on Studio is always a typo.
    for (const row of COMPARISON_ROWS) {
      if (!row.values.every((v) => typeof v === "boolean")) continue;
      const flags = row.values as readonly boolean[];
      const firstIncluded = flags.indexOf(true);
      if (firstIncluded === -1) continue;
      expect(
        flags.slice(firstIncluded).every(Boolean),
        `row "${row.label}" is not monotonic`,
      ).toBe(true);
    }
  });
});
