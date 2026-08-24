import { describe, expect, it } from "vitest";

import {
  PLAN_DEFINITIONS,
  planDefinitionFor,
} from "@/services/billing/catalogue";
import {
  PLAN_CONFIGS,
  WORST_CASE_COST_PER_CREDIT_MICRO_USD,
  creditsForAllowance,
  planConfigFor,
} from "@/services/billing/plan-config";
import {
  MARGIN_FLOOR,
  OVERHEAD_RESERVE,
  SUBSCRIPTION_CREDIT_VALUE_USD,
  UNVERIFIED_COST_CEILING,
  UnpricedModelError,
  maxSafeAllowance,
  providerCostOf,
  quoteCredits,
} from "@/services/billing/pricing-formula";

/**
 * The economics of the competitive-pricing sprint.
 *
 * ## What these protect
 *
 * The allowances went up 3.8x. Everything that made that safe is arithmetic —
 * a credit worth $0.005, a 2.5x margin floor putting worst-case cost at $0.002,
 * and enough of the price left over after Stripe to clear 55%. None of that is
 * visible in the numbers themselves, so without these the next person to look
 * at `creditsPerMonth: 1_900` sees an arbitrary figure and rounds it up.
 */

describe("1. the canonical credit value", () => {
  it("is $0.005 and is stated once", () => {
    expect(SUBSCRIPTION_CREDIT_VALUE_USD).toBe(0.005);
  });

  it("puts the worst-case cost of a credit at $0.002", () => {
    // $0.005 retail / 2.5x minimum margin. `openai/gpt-image-1` sits exactly
    // on that floor, so this is a real model's number.
    expect(WORST_CASE_COST_PER_CREDIT_MICRO_USD).toBe(2_000);
  });
});

describe("2-4. the plan table", () => {
  it("grants 1,900 / 7,000 / 18,000 and 100 once", () => {
    expect(planConfigFor("FREE").creditsPerMonth).toBe(100);
    expect(planConfigFor("CREATOR").creditsPerMonth).toBe(1_900);
    expect(planConfigFor("PRO").creditsPerMonth).toBe(7_000);
    expect(planConfigFor("STUDIO").creditsPerMonth).toBe(18_000);
  });

  it("keeps the prices at $9.99 / $34.99 / $89.99", () => {
    expect(planConfigFor("CREATOR").monthlyPriceCents).toBe(999);
    expect(planConfigFor("PRO").monthlyPriceCents).toBe(3499);
    expect(planConfigFor("STUDIO").monthlyPriceCents).toBe(8999);
    expect(planConfigFor("FREE").monthlyPriceCents).toBe(0);
  });

  it("says the same number on the server and on the card", () => {
    /**
     * Two sources for one figure is how a card promising 2,000 credits ends up
     * beside a webhook granting 1,800.
     */
    for (const config of PLAN_CONFIGS) {
      expect(
        planDefinitionFor(config.tier).monthlyCredits,
        `${config.displayName} catalogue vs config`,
      ).toBe(config.creditsPerMonth);
    }
  });

  it("derives each allowance from its provider budget", () => {
    for (const config of PLAN_CONFIGS) {
      if (config.creditsPerMonth === null) continue;
      expect(creditsForAllowance(config.providerAllowanceUsd)).toBe(
        config.creditsPerMonth,
      );
    }
  });
});

describe("the allowances clear the floor that applies", () => {
  /**
   * 55%, not 60%. Atheos has no direct provider integration — the audit found
   * only Veo 3.1 Fast is cheaper direct and no adapter exists — so every
   * generation is a fallback route.
   */
  const ceiling = (cents: number, floor: number, stripePercent?: number) =>
    maxSafeAllowance({
      monthlyPriceCents: cents,
      costPerCreditMicroUsd: WORST_CASE_COST_PER_CREDIT_MICRO_USD,
      floor,
      ...(stripePercent ? { stripePercent } : {}),
    });

  it("clears 55% on every paid plan", () => {
    for (const config of PLAN_CONFIGS) {
      if (config.monthlyPriceCents === 0 || config.creditsPerMonth === null) {
        continue;
      }
      expect(config.creditsPerMonth).toBeLessThanOrEqual(
        ceiling(config.monthlyPriceCents, MARGIN_FLOOR.fallback),
      );
    }
  });

  it("8. records why Creator is 1,900 and not the proposed 2,000", () => {
    // The proposal cleared 55% by nine credits, and fell under it on a 3.9%
    // international card. This is that arithmetic, pinned.
    const domestic = ceiling(999, MARGIN_FLOOR.fallback);
    const international = ceiling(999, MARGIN_FLOOR.fallback, 0.039);

    expect(domestic).toBe(2_009);
    expect(international).toBe(1_987);
    expect(2_000).toBeGreaterThan(international);
    expect(planConfigFor("CREATOR").creditsPerMonth).toBeLessThanOrEqual(
      international,
    );
  });

  it("keeps Pro and Studio inside the international-card ceiling too", () => {
    expect(planConfigFor("PRO").creditsPerMonth).toBeLessThanOrEqual(
      ceiling(3499, MARGIN_FLOOR.fallback, 0.039),
    );
    expect(planConfigFor("STUDIO").creditsPerMonth).toBeLessThanOrEqual(
      ceiling(8999, MARGIN_FLOOR.fallback, 0.039),
    );
  });

  it("would fail the 60% preferred floor, and that is recorded", () => {
    /**
     * Not a passing grade dressed up. At the preferred floor the ceilings are
     * 1,786 / 6,398 / 16,545 and every plan exceeds them. The 60% floor becomes
     * reachable only when a cheaper direct route exists — which is the business
     * case for building the Veo 3.1 Fast adapter.
     */
    expect(planConfigFor("CREATOR").creditsPerMonth).toBeGreaterThan(
      ceiling(999, MARGIN_FLOOR.preferred),
    );
    expect(planConfigFor("PRO").creditsPerMonth).toBeGreaterThan(
      ceiling(3499, MARGIN_FLOOR.preferred),
    );
  });
});

describe("13-16. the quote formula responds to what costs money", () => {
  const base = {
    perOutputMicroUsd: 0,
    perSecondMicroUsd: 100_000, // $0.10/s
    verification: "verified" as const,
    route: "fallback" as const,
  };

  it("13. charges more for a longer clip", () => {
    const short = quoteCredits({ ...base, durationSeconds: 4 });
    const long = quoteCredits({ ...base, durationSeconds: 8 });
    expect(long.credits).toBeGreaterThan(short.credits);
    // Twice the seconds is twice the provider cost.
    expect(providerCostOf({ ...base, durationSeconds: 8 })).toBe(
      2 * providerCostOf({ ...base, durationSeconds: 4 }),
    );
  });

  it("14-15. charges more when resolution or audio raises the rate", () => {
    // Veo 3.1 Fast direct: $0.10/s at 720p, $0.12/s at 1080p, both with audio.
    const at720 = quoteCredits({ ...base, durationSeconds: 8 });
    const at1080 = quoteCredits({
      ...base,
      perSecondMicroUsd: 120_000,
      durationSeconds: 8,
    });
    expect(at1080.credits).toBeGreaterThan(at720.credits);

    // Replicate prices audio separately: $0.15/s with, $0.10/s without.
    const silent = quoteCredits({ ...base, durationSeconds: 8 });
    const withAudio = quoteCredits({
      ...base,
      perSecondMicroUsd: 150_000,
      durationSeconds: 8,
    });
    expect(withAudio.credits).toBeGreaterThan(silent.credits);
  });

  it("16. counts every provider call in a workflow", () => {
    /**
     * Atheos sound design is two calls — the clip, then the audio model.
     * Quoting only the first is how a workflow gets sold at half its cost.
     */
    const one = quoteCredits({ ...base, durationSeconds: 8, providerCalls: 1 });
    const two = quoteCredits({ ...base, durationSeconds: 8, providerCalls: 2 });
    expect(two.credits).toBeGreaterThan(one.credits);
    expect(
      providerCostOf({ ...base, durationSeconds: 8, providerCalls: 2 }),
    ).toBe(
      2 * providerCostOf({ ...base, durationSeconds: 8, providerCalls: 1 }),
    );
  });

  it("always rounds upward", () => {
    // A half-credit rounded down is margin given away on every generation.
    for (let seconds = 1; seconds <= 12; seconds++) {
      const quote = quoteCredits({ ...base, durationSeconds: seconds });
      expect(Number.isInteger(quote.credits)).toBe(true);
      expect(quote.margin).toBeGreaterThanOrEqual(quote.floor);
    }
  });

  it("never returns a quote below its floor", () => {
    for (const route of ["preferred", "fallback"] as const) {
      for (let seconds = 1; seconds <= 30; seconds++) {
        const quote = quoteCredits({
          ...base,
          durationSeconds: seconds,
          route,
        });
        expect(quote.margin).toBeGreaterThanOrEqual(MARGIN_FLOOR[route]);
      }
    }
  });
});

describe("14. an unverified cost is priced conservatively, never invented", () => {
  it("refuses to price a model with no cost at all", () => {
    expect(() =>
      quoteCredits({ perOutputMicroUsd: null, verification: "unknown" }),
    ).toThrow(UnpricedModelError);
  });

  it("refuses a per-second model with no duration", () => {
    // Otherwise it silently prices at zero.
    expect(() =>
      quoteCredits({
        perOutputMicroUsd: 0,
        perSecondMicroUsd: 100_000,
        verification: "verified",
      }),
    ).toThrow(UnpricedModelError);
  });

  it("pads an estimate rather than trusting it", () => {
    const verified = quoteCredits({
      perOutputMicroUsd: 40_000,
      verification: "verified",
    });
    const estimated = quoteCredits({
      perOutputMicroUsd: 40_000,
      verification: "estimated",
    });
    expect(estimated.credits).toBeGreaterThan(verified.credits);
    expect(estimated.basis).toContain("estimated");
    expect(UNVERIFIED_COST_CEILING).toBeGreaterThan(1);
  });

  it("reserves overhead before applying margin", () => {
    expect(OVERHEAD_RESERVE).toBeGreaterThan(0);
    const quote = quoteCredits({
      perOutputMicroUsd: 100_000,
      verification: "verified",
    });
    expect(quote.providerCostMicroUsd).toBeGreaterThan(100_000);
  });

  it("explains itself", () => {
    // Recorded so a quote that changes can be explained after the fact.
    const quote = quoteCredits({
      perOutputMicroUsd: 40_000,
      verification: "verified",
    });
    expect(quote.basis).toMatch(/provider \$0\.0400/);
    expect(quote.basis).toMatch(/floor/);
  });
});

describe("11. top-up packs clear the preferred floor", () => {
  /**
   * Provisional only — nothing is created in Stripe. Worst case is the same
   * $0.002 per credit, and a pack has no renewal risk.
   */
  const PACKS = [
    { credits: 1_000, priceUsd: 7.99 },
    { credits: 3_000, priceUsd: 19.99 },
    { credits: 10_000, priceUsd: 59.99 },
  ];

  for (const pack of PACKS) {
    it(`${pack.credits} credits at $${pack.priceUsd}`, () => {
      const net = (pack.priceUsd - (pack.priceUsd * 0.029 + 0.3)) * 0.95;
      const cost =
        (pack.credits * WORST_CASE_COST_PER_CREDIT_MICRO_USD) / 1_000_000;
      const margin = (net - cost) / net;
      expect(margin).toBeGreaterThanOrEqual(MARGIN_FLOOR.preferred);
    });
  }

  it("flags that packs are cheaper per credit than a subscription", () => {
    /**
     * Recorded rather than fixed. A top-up should cost *more* per credit than a
     * subscription; today the 10,000 pack is $0.0060 against Creator's $0.00526.
     * That is backwards and needs a pricing decision, not a silent edit.
     */
    const subscription = 9.99 / 1_900;
    const largestPack = 59.99 / 10_000;
    expect(largestPack).toBeGreaterThan(subscription);
  });
});

describe("20-22. nothing is promised that is not being sold", () => {
  it("20. keeps every paid plan launch-disabled", () => {
    for (const plan of PLAN_DEFINITIONS) {
      if (plan.monthly === 0) continue;
      expect(plan.status, `${plan.name} must not be purchasable`).toBe(
        "launch_disabled",
      );
    }
  });

  it("21. offers no annual plan", () => {
    for (const plan of PLAN_DEFINITIONS) {
      const text = JSON.stringify(plan).toLowerCase();
      expect(text).not.toMatch(/\bannual\b|\byearly\b|per year/);
    }
  });

  it("22. promises nothing unlimited", () => {
    for (const plan of PLAN_DEFINITIONS) {
      expect(JSON.stringify(plan).toLowerCase()).not.toContain("unlimited");
    }
    for (const config of PLAN_CONFIGS) {
      expect(Number.isFinite(config.maxConcurrentJobs)).toBe(true);
      expect(Number.isFinite(config.generationsPerHour)).toBe(true);
    }
  });
});
