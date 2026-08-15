import { beforeEach, describe, expect, it, vi } from "vitest";

import { scrub } from "@/lib/events";
import {
  MODEL_CLASS_CEILING_MICRO_USD,
  PLAN_CONFIGS,
  creditsForAllowance,
  isFreeTier,
  planAllowsModel,
  planConfigFor,
} from "@/services/billing/plan-config";

/**
 * The financial controls, at the level that can be checked without a database.
 *
 * The ladder, the plan table and the redaction rules are all pure functions of
 * configuration, and all three are things that go wrong quietly: a threshold
 * put in the wrong order stops the wrong tier, a plan whose allowance and
 * credits disagree misprices a subscription, and a log line that keeps a token
 * looks exactly like one that does not.
 */

// `spendStatus` reads Prisma and `env`, so the module is imported after the
// mocks are in place. Both are hoisted by vitest, which is why the import of
// the module under test is deferred to each test rather than done at the top.
const findUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { budgetUsage: { findUnique, upsert: vi.fn() } },
}));

const envValues: Record<string, string | number | undefined> = {};
vi.mock("@/lib/env", () => ({
  env: new Proxy({}, { get: (_, key) => envValues[key as string] }),
}));

async function spending() {
  return import("@/services/billing/spending");
}

beforeEach(() => {
  findUnique.mockReset();
  for (const key of Object.keys(envValues)) delete envValues[key];
});

describe("the spending ladder", () => {
  it("maps every threshold to the level the founder agreed", async () => {
    const { __levelFor, THRESHOLDS_USD } = await spending();
    const usd = (dollars: number) => __levelFor(dollars * 1_000_000);

    expect(usd(0)).toBe("normal");
    expect(usd(99.99)).toBe("normal");
    expect(usd(THRESHOLDS_USD.review)).toBe("review");
    expect(usd(THRESHOLDS_USD.alert)).toBe("alert");
    expect(usd(THRESHOLDS_USD.stopFree)).toBe("free_stopped");
    expect(usd(THRESHOLDS_USD.restrictExpensive)).toBe("expensive_restricted");
    expect(usd(THRESHOLDS_USD.pauseNonessential)).toBe("nonessential_paused");
    expect(usd(THRESHOLDS_USD.economicalOnly)).toBe("economical_only");
    expect(usd(THRESHOLDS_USD.emergency)).toBe("emergency");
    expect(usd(THRESHOLDS_USD.ceiling)).toBe("emergency");
    expect(usd(10_000)).toBe("emergency");
  });

  it("keeps the thresholds ascending and under the absolute ceiling", async () => {
    const { THRESHOLDS_USD } = await spending();
    const values = Object.values(THRESHOLDS_USD);

    expect(values).toEqual([...values].sort((a, b) => a - b));
    // $475 exists so $500 is never reached. If emergency were ever set at or
    // above the ceiling, the ceiling would be the first thing to stop spend,
    // which is the definition of not having a circuit breaker.
    expect(THRESHOLDS_USD.emergency).toBeLessThan(THRESHOLDS_USD.ceiling);
    expect(THRESHOLDS_USD.ceiling).toBe(500);
  });

  it("goes to emergency when the spend row cannot be read", async () => {
    // Failing safe. A breaker that cannot see its input has to assume the
    // worst — the alternative is a database hiccup disarming it.
    findUnique.mockRejectedValue(new Error("connection refused"));

    const { spendStatus } = await spending();
    const status = await spendStatus();

    expect(status.level).toBe("emergency");
    expect(status.degraded).toBe(true);
  });

  it("treats a missing month as zero rather than as a failure", async () => {
    // The first of the month is not a degraded state.
    findUnique.mockResolvedValue(null);

    const { spendStatus } = await spending();
    const status = await spendStatus();

    expect(status.level).toBe("normal");
    expect(status.degraded).toBe(false);
    expect(status.totalMicroUsd).toBe(0);
  });

  it("adds the manual baseline to the estimate", async () => {
    // The estimate alone is $180 — alert. With the operator's $60 correction
    // from the provider's real invoice it is $240, which stops free generation.
    envValues.ATHEOS_MANUAL_SPEND_USD = 60;
    findUnique.mockResolvedValue({
      spentMicroUsd: 180_000_000n,
      manualBaselineMicroUsd: 0n,
    });

    const { spendStatus } = await spending();
    const status = await spendStatus();

    expect(status.totalMicroUsd).toBe(240_000_000);
    expect(status.level).toBe("free_stopped");
  });
});

describe("the manual switches", () => {
  it("stops everything when the kill switch is armed, whatever the spend", async () => {
    envValues.ATHEOS_KILL_SWITCH = "1";
    findUnique.mockResolvedValue(null);

    const { gateGeneration } = await spending();
    const verdict = await gateGeneration({
      modelId: "mock/standard",
      provider: "mock",
      isFree: false,
      requestCostMicroUsd: 0,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("kill_switch");
  });

  it("refuses a provider or a model named in the environment", async () => {
    findUnique.mockResolvedValue(null);
    envValues.ATHEOS_DISABLED_MODELS = "replicate/video-pro, replicate/music";

    const { gateGeneration } = await spending();

    expect(
      (
        await gateGeneration({
          modelId: "replicate/video-pro",
          provider: "replicate",
          isFree: false,
          requestCostMicroUsd: 270_000,
        })
      ).reason,
    ).toBe("model_disabled");

    // Whitespace around a comma-separated entry must not defeat the switch.
    expect(
      (
        await gateGeneration({
          modelId: "replicate/music",
          provider: "replicate",
          isFree: false,
          requestCostMicroUsd: 90_000,
        })
      ).reason,
    ).toBe("model_disabled");
  });

  it("refuses a model with no cost entry at all", async () => {
    findUnique.mockResolvedValue(null);

    const { gateGeneration } = await spending();
    const verdict = await gateGeneration({
      modelId: "someone/added-this-without-a-price",
      provider: "replicate",
      isFree: false,
      requestCostMicroUsd: null,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("model_unpriced");
  });

  it("keeps the mock available when free generation is stopped", async () => {
    // Stopping the mock protects no money and only prevents somebody finding
    // out the product works.
    envValues.ATHEOS_FREE_GENERATION_DISABLED = "1";
    findUnique.mockResolvedValue(null);

    const { gateGeneration } = await spending();

    expect(
      (
        await gateGeneration({
          modelId: "mock/standard",
          provider: "mock",
          isFree: true,
          requestCostMicroUsd: 0,
        })
      ).allowed,
    ).toBe(true);

    expect(
      (
        await gateGeneration({
          modelId: "replicate/flux-schnell",
          provider: "replicate",
          isFree: true,
          requestCostMicroUsd: 3_000,
        })
      ).reason,
    ).toBe("spend_free_stopped");
  });
});

describe("what the levels actually stop", () => {
  it("stops free users before paid ones", async () => {
    // $230: past the free threshold, well under the paid ones.
    findUnique.mockResolvedValue({
      spentMicroUsd: 230_000_000n,
      manualBaselineMicroUsd: 0n,
    });

    const { gateGeneration } = await spending();

    const free = await gateGeneration({
      modelId: "replicate/flux-schnell",
      provider: "replicate",
      isFree: true,
      requestCostMicroUsd: 3_000,
    });
    const paid = await gateGeneration({
      modelId: "replicate/flux-schnell",
      provider: "replicate",
      isFree: false,
      requestCostMicroUsd: 3_000,
    });

    expect(free.allowed).toBe(false);
    expect(paid.allowed).toBe(true);
  });

  it("keeps a paying customer generating images until the emergency level", async () => {
    // The ordering that matters most: a subscriber whose generations stop has
    // been sold something undelivered. $430 is economical-only, and a cheap
    // image for a paid account is exactly what "economical" means.
    findUnique.mockResolvedValue({
      spentMicroUsd: 430_000_000n,
      manualBaselineMicroUsd: 0n,
    });

    const { gateGeneration } = await spending();

    expect(
      (
        await gateGeneration({
          modelId: "replicate/flux-schnell",
          provider: "replicate",
          isFree: false,
          requestCostMicroUsd: 3_000,
        })
      ).allowed,
    ).toBe(true);

    // Video, however, is not economical at any level above $425.
    expect(
      (
        await gateGeneration({
          modelId: "replicate/video-pro",
          provider: "replicate",
          isFree: false,
          requestCostMicroUsd: 648_000,
        })
      ).reason,
    ).toBe("spend_economical_only");
  });

  it("stops absolutely everything at the emergency level", async () => {
    findUnique.mockResolvedValue({
      spentMicroUsd: 480_000_000n,
      manualBaselineMicroUsd: 0n,
    });

    const { gateGeneration } = await spending();

    for (const isFree of [true, false]) {
      const verdict = await gateGeneration({
        modelId: "replicate/flux-schnell",
        provider: "replicate",
        isFree,
        requestCostMicroUsd: 3_000,
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe("spend_emergency");
    }
  });
});

describe("what the customer is told", () => {
  it("never discloses a dollar figure or a threshold", async () => {
    const { blockMessage } = await spending();

    const reasons = [
      "kill_switch",
      "spend_emergency",
      "spend_free_stopped",
      "spend_expensive_restricted",
      "spend_nonessential_paused",
      "spend_economical_only",
      "provider_disabled",
      "model_disabled",
      "model_unpriced",
      "free_plan_ineligible",
    ] as const;

    for (const reason of reasons) {
      const message = blockMessage(reason);

      expect(message.length).toBeGreaterThan(10);
      // No money, no percentages, no vendor names. The person reading this did
      // not ask about the state of the business's finances.
      expect(message).not.toMatch(/\$|\d+%|replicate|openai|budget|spend/i);
    }
  });

  it("says nothing was charged wherever nothing was charged", async () => {
    const { blockMessage } = await spending();

    // Every block happens before the reservation, so this is true in each case
    // — and it is the one thing the reader actually wants to know.
    for (const reason of [
      "kill_switch",
      "spend_emergency",
      "spend_expensive_restricted",
      "spend_nonessential_paused",
      "model_disabled",
    ] as const) {
      expect(blockMessage(reason)).toMatch(/nothing was charged/i);
    }
  });
});

describe("plan configuration", () => {
  it("configures exactly the four launch plans and nothing else", () => {
    // Four values in the enum, four configs, in price order. A fifth of either
    // is the drift Sprint 4.1 removed.
    expect(PLAN_CONFIGS.map((plan) => plan.tier)).toEqual([
      "FREE",
      "CREATOR",
      "PRO",
      "STUDIO",
    ]);

    expect(PLAN_CONFIGS.map((plan) => plan.displayName)).toEqual([
      "Free",
      "Creator",
      "Pro",
      "Studio",
    ]);
    expect(PLAN_CONFIGS.map((plan) => plan.monthlyPriceCents)).toEqual([
      0, 999, 3499, 8999,
    ]);
  });

  it("names every tier after the plan it actually is", () => {
    // The Sprint 4.1 invariant. The enum value and the customer-facing name
    // must be the same word, so nobody has to keep a translation table in
    // their head and no report can say "AGENCY now represents the $89.99 tier".
    for (const plan of PLAN_CONFIGS) {
      expect(plan.tier).toBe(plan.displayName.toUpperCase());
    }
  });

  it("derives every provisional allocation from its provider allowance", () => {
    // The two drift the moment somebody edits one and not the other, and the
    // drift is invisible: a plan quietly budgeted for more spend than it earns.
    for (const plan of PLAN_CONFIGS) {
      if (plan.provisionalCreditsPerMonth === null) continue;
      if (plan.tier === "FREE") continue; // fixed at the signup grant

      expect(
        plan.provisionalCreditsPerMonth,
        `${plan.displayName} allocation`,
      ).toBe(creditsForAllowance(plan.providerAllowanceUsd));
    }
  });

  it("leaves every paid allocation unsettled until costs are verified", () => {
    for (const plan of PLAN_CONFIGS) {
      if (plan.monthlyPriceCents > 0) {
        expect(plan.creditsPerMonth, `${plan.displayName}`).toBeNull();
      }
    }
  });

  it("keeps every plan's provider allowance under a third of its price", () => {
    // The margin the plans were sold on: ≥ 67% gross before infrastructure.
    for (const plan of PLAN_CONFIGS) {
      if (plan.monthlyPriceCents === 0) continue;
      const priceUsd = plan.monthlyPriceCents / 100;
      expect(
        plan.providerAllowanceUsd / priceUsd,
        `${plan.displayName} allowance ratio`,
      ).toBeLessThanOrEqual(0.34);
    }
  });

  it("gives nobody unlimited concurrency", () => {
    // "No unlimited generation" applies to concurrency too — an unbounded top
    // tier is one customer able to reach the ceiling alone.
    for (const plan of PLAN_CONFIGS) {
      expect(plan.maxConcurrentJobs).toBeGreaterThan(0);
      expect(plan.maxConcurrentJobs).toBeLessThanOrEqual(8);
      expect(Number.isFinite(plan.generationsPerHour)).toBe(true);
    }
  });

  it("raises the limits monotonically with price", () => {
    const paid = [...PLAN_CONFIGS].sort(
      (a, b) => a.monthlyPriceCents - b.monthlyPriceCents,
    );

    for (const field of [
      "maxConcurrentJobs",
      "generationsPerHour",
      "generationsPerMinute",
    ] as const) {
      const values = paid.map((plan) => plan[field]);
      expect(values, field).toEqual([...values].sort((a, b) => a - b));
    }
  });

  it("holds the Free plan to images and audio, one at a time", () => {
    const free = planConfigFor("FREE");

    expect(isFreeTier("FREE")).toBe(true);
    expect(free.eligibleModalities).not.toContain("VIDEO");
    expect(free.maxConcurrentJobs).toBe(1);
    expect(free.maxModelClass).toBe("economical");
  });

  it("falls back to the least privileged plan on an unknown tier", () => {
    // A bug must not hand somebody the top tier's concurrency.
    // @ts-expect-error deliberately invalid, which is the case being tested
    expect(planConfigFor("NOT_A_TIER").tier).toBe("FREE");
    expect(planConfigFor(null).tier).toBe("FREE");
    expect(planConfigFor(undefined).tier).toBe("FREE");
  });

  it("refuses a model whose cost is unknown, on every plan", () => {
    for (const plan of PLAN_CONFIGS) {
      expect(
        planAllowsModel(plan, {
          modality: "IMAGE",
          worstCaseCostMicroUsd: null,
        }),
        plan.displayName,
      ).toBe(false);
    }
  });

  it("orders the model-class ceilings", () => {
    expect(MODEL_CLASS_CEILING_MICRO_USD.economical).toBeLessThan(
      MODEL_CLASS_CEILING_MICRO_USD.standard,
    );
    expect(MODEL_CLASS_CEILING_MICRO_USD.standard).toBeLessThan(
      MODEL_CLASS_CEILING_MICRO_USD.premium,
    );
  });
});

describe("event redaction", () => {
  it("redacts anything whose key looks like a secret", () => {
    const out = scrub({
      userId: "u_123",
      apiKey: "ak_live_abc",
      authorization: "Bearer xyz",
      REPLICATE_API_TOKEN: "r8_secret",
      stripeSecretKey: "sk_live_x",
      prompt: "a cinematic shot of a cat",
      cookie: "session=1",
      signature: "abc",
    });

    expect(out.userId).toBe("u_123");
    for (const key of [
      "apiKey",
      "authorization",
      "REPLICATE_API_TOKEN",
      "stripeSecretKey",
      "prompt",
      "cookie",
      "signature",
    ]) {
      expect(out[key], key).toBe("[redacted]");
    }
  });

  it("truncates a long string even when its key looks innocent", () => {
    // The deny-list is a deny-list, so the length ceiling is the backstop. The
    // things worth stealing are all long.
    const out = scrub({ detail: "x".repeat(500) });

    expect(String(out.detail)).toHaveLength(200 + "…[truncated]".length);
    expect(String(out.detail)).toMatch(/\[truncated\]$/);
  });

  it("survives values that JSON cannot serialise", () => {
    // An observability call that throws takes down the thing it was observing.
    const out = scrub({
      big: 10n,
      fn: () => undefined,
      nested: { a: { b: { c: { d: "deep" } } } },
    });

    expect(out.big).toBe("10");
    expect(out.fn).toBe("[unserialisable]");
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});
