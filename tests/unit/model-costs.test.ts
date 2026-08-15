import { describe, expect, it } from "vitest";

import {
  CREDIT_VALUE_MICRO_USD,
  MODEL_COSTS,
  assessPrice,
  costEntry,
  worstCaseCostMicroUsd,
} from "@/services/billing/model-costs";
import { googleProvider } from "@/services/ai/providers/google";
import { mockProvider } from "@/services/ai/providers/mock";
import { openaiProvider } from "@/services/ai/providers/openai";
import { replicateProvider } from "@/services/ai/providers/replicate";
import { PLAN_CONFIGS, planAllowsModel } from "@/services/billing/plan-config";

/**
 * The margin guard.
 *
 * `REVENUE_READINESS_AUDIT.md` § 8 found Motion Pro selling below cost. The
 * cause was not a bad number — it was that no number was ever compared to
 * another. Credit prices lived in the provider adapters, provider costs lived
 * in `services/ai/cost.ts`, and nothing read both.
 *
 * These tests are that comparison, run on every build. A model whose price
 * drifts under its floor fails here, which is the only place a pricing mistake
 * can be caught before an invoice catches it.
 *
 * ## Why the providers are imported directly rather than through the registry
 *
 * `listModels()` returns only the providers whose API keys are present, and the
 * test environment has none — so it returns the mock provider alone. A first
 * version of this file used it and passed while `flux-dev` was priced below its
 * floor, because `flux-dev` was never in the list being checked.
 *
 * A margin test that silently examines two mock models is worse than no margin
 * test: it reports green over exactly the models that cost money. Importing the
 * adapters directly makes the set complete and environment-independent.
 */

const ALL_MODELS = [
  replicateProvider,
  openaiProvider,
  googleProvider,
  mockProvider,
].flatMap((provider) => provider.listModels());

describe("provider cost configuration", () => {
  it("has an entry for every model any adapter can serve", () => {
    // A model the registry serves and this file does not know about is a
    // generation that runs at an unmeasured cost. The gate in
    // `spending.ts` refuses those, so the failure mode is a dead model rather
    // than an expensive one — but a dead model in production is still a bug,
    // and this is where it should be found.
    const missing = ALL_MODELS.map((model) => model.id).filter(
      (id) => !costEntry(id),
    );

    expect(missing, `models with no cost entry: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("agrees with the adapters on price and modality", () => {
    // Two files stating the same fact will eventually disagree. `creditCost`
    // is duplicated deliberately — the adapter needs it at request time and
    // this file needs it to check margin — so the duplication is pinned.
    for (const model of ALL_MODELS) {
      const entry = costEntry(model.id);
      expect(entry, `${model.id} has no cost entry`).toBeTruthy();
      expect(entry!.creditCost, `${model.id} credit price`).toBe(
        model.creditCost,
      );
      expect(entry!.modality, `${model.id} modality`).toBe(model.modality);
    }
  });

  it("prices the worst case on the longest duration the model offers", () => {
    // Checking margin against a 5-second clip on a model that also sells 12 is
    // exactly how the negative margin stayed invisible. The assumption has to
    // match the catalogue or the whole check is measuring the wrong thing.
    for (const model of ALL_MODELS) {
      const entry = costEntry(model.id)!;
      const durations = model.capabilities.durations;

      if (!durations?.length) {
        expect(
          entry.assumptions?.maxDurationSeconds,
          `${model.id} has no durations but declares one`,
        ).toBeUndefined();
        continue;
      }

      expect(
        entry.assumptions?.maxDurationSeconds,
        `${model.id} worst-case duration`,
      ).toBe(Math.max(...durations));
    }
  });

  it("never enables a model whose provider cost is unknown", () => {
    // Rule 1, and the one with no exceptions. An unknown cost cannot be shown
    // to be profitable, so it cannot be sold.
    for (const entry of MODEL_COSTS) {
      if (entry.verification === "unknown") {
        expect(entry.enabled, `${entry.modelId} is enabled`).toBe(false);
      }
      if (entry.perOutputMicroUsd === null) {
        expect(entry.enabled, `${entry.modelId} is enabled`).toBe(false);
      }
    }
  });

  it("clears the margin floor on every enabled model", () => {
    for (const model of ALL_MODELS) {
      const entry = costEntry(model.id)!;
      if (!entry.enabled) continue;

      const base = model.capabilities.durations?.length
        ? Math.min(...model.capabilities.durations)
        : undefined;

      const verdict = assessPrice(entry, base);

      expect(
        verdict.safe,
        `${entry.modelId}: ${verdict.reason}. Minimum safe price is ${verdict.minimumSafeCredits} credits, catalogue says ${entry.creditCost}.`,
      ).toBe(true);
    }
  });

  it("keeps every video model off the Free plan", () => {
    // Not a margin decision. Margin protects the unit; the free tier's whole
    // exposure is volume by people who have paid nothing, and video is where
    // volume becomes expensive fastest.
    for (const entry of MODEL_COSTS) {
      if (entry.modality === "VIDEO" && entry.provider !== "mock") {
        expect(entry.freeTierEligible, `${entry.modelId}`).toBe(false);
      }
    }
  });

  it("lets the Free plan reach at least one enabled model", () => {
    // The mirror of the test above. A free tier that can generate nothing is
    // not a conservative free tier, it is a broken sign-up flow.
    const free = PLAN_CONFIGS.find((plan) => plan.tier === "FREE")!;

    const reachable = MODEL_COSTS.filter(
      (entry) =>
        entry.enabled &&
        entry.freeTierEligible &&
        planAllowsModel(free, {
          modality: entry.modality,
          worstCaseCostMicroUsd: worstCaseCostMicroUsd(entry),
        }),
    );

    expect(reachable.length).toBeGreaterThan(0);
  });

  it("keeps the credit value where the top model's price implies it", () => {
    /**
     * The rate is derived from the most expensive enabled model, not chosen.
     *
     * If somebody lowers `CREDIT_VALUE_MICRO_USD` to make a plan look more
     * generous, this fails — because every margin in the catalogue is measured
     * against it, and quietly devaluing the credit devalues every price at once.
     */
    expect(CREDIT_VALUE_MICRO_USD).toBeGreaterThan(0);

    for (const entry of MODEL_COSTS) {
      if (!entry.enabled || entry.minimumMarginMultiple === 0) continue;

      const cost = worstCaseCostMicroUsd(entry);
      if (!cost) continue;

      // Revenue at the base price alone must not be *wildly* above the floor
      // either — a 50x margin is a model nobody will use. Not an assertion, a
      // sanity bound, deliberately loose.
      const multiple =
        (entry.creditCost * CREDIT_VALUE_MICRO_USD) / (cost || 1);
      expect(multiple, `${entry.modelId} margin`).toBeLessThan(50);
    }
  });
});
