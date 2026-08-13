import { describe, expect, it } from "vitest";

import {
  PACK_DEFINITIONS,
  PLAN_DEFINITIONS,
  formatMoney,
  isUpgrade,
  rankOf,
} from "@/services/billing/catalogue";
import { PRICING } from "@/features/marketing/content";
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
    expect(PLAN_DEFINITIONS[0]?.monthly).toBe(0);

    const paid = PLAN_DEFINITIONS.slice(1).map((p) => p.monthly);
    expect(paid).toEqual([...paid].sort((a, b) => a - b));
  });

  it("grants more credits at every step up", () => {
    const credits = PLAN_DEFINITIONS.map((p) => p.monthlyCredits);
    expect(credits).toEqual([...credits].sort((a, b) => a - b));
  });

  it("never charges more per month on the yearly plan", () => {
    for (const plan of PLAN_DEFINITIONS) {
      expect(plan.yearly).toBeLessThanOrEqual(plan.monthly);
    }
  });

  it("ranks every tier, in catalogue order", () => {
    const ranks = PLAN_DEFINITIONS.map((p) => rankOf(p.tier));
    expect(ranks).toEqual(PLAN_DEFINITIONS.map((_, i) => i));
    expect(isUpgrade("STARTER", "AGENCY")).toBe(true);
    expect(isUpgrade("AGENCY", "STARTER")).toBe(false);
    expect(isUpgrade("BASIC", "BASIC")).toBe(false);
  });

  it("does not sell a pack at the same price as a plan", () => {
    // Two products, same money, same credits, same page. Whichever one the
    // reader picks they will wonder what the other did, which is a worse
    // outcome than not offering the choice.
    const planPrices = new Set(PLAN_DEFINITIONS.map((p) => p.monthly));
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
  it("carries one card per plan", () => {
    expect(PRICING).toHaveLength(PLAN_DEFINITIONS.length);
  });

  it("bills exactly twelve months on the yearly total", () => {
    for (const tier of PRICING) {
      expect(tier.yearlyTotal).toBe(tier.yearly * 12);
    }
  });

  it("shows a saving on every paid tier, never on the free one", () => {
    for (const tier of PRICING) {
      const saving = tier.monthly * 12 - tier.yearlyTotal;
      expect(saving).toBeGreaterThan(tier.monthly === 0 ? -1 : 0);
    }
  });

  it("formats money without dropping cents", () => {
    expect(formatMoney(1599)).toBe("$15.99");
    expect(formatMoney(19900)).toBe("$199");
    expect(formatMoney(15900 * 12)).toBe("$1,908");
  });
});

describe("plan comparison table", () => {
  it("gives every row a cell for every plan", () => {
    for (const row of COMPARISON_ROWS) {
      expect(
        row.values,
        `row "${row.label}" has ${row.values.length} cells`,
      ).toHaveLength(PLAN_DEFINITIONS.length);
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
