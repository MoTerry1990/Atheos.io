import { afterEach, describe, expect, it, vi } from "vitest";

import { AUDIO_CAPABILITIES } from "@/services/ai/audio-strategy";
import { MODEL_CAPABILITIES } from "@/services/ai/brief-routing";
import { COMPILERS_BY_MODEL } from "@/services/ai/compile-for-model";
import {
  MODEL_COSTS,
  assessPrice,
  costEntry,
} from "@/services/billing/model-costs";
import type { ProviderModel } from "@/services/ai/types";

/**
 * The catalogue has to agree with itself under **every** flag combination.
 *
 * ## Why the existing margin test was not enough
 *
 * `model-costs.test.ts` imports the adapters directly and checks every model
 * they serve. That is correct as far as it goes — but a flag-gated array is
 * evaluated when the module loads, so `replicateProvider.listModels()` returns
 * a *different set* depending on `ENABLE_VEO_31` and `ENABLE_SMART_IMAGE`.
 *
 * With the flags off, the three Veo models were invisible to that test and it
 * passed green while all three had **no cost entry at all**. Turning the flag on
 * would have made them appear, unpriced, and `spending.ts` would have refused
 * every generation — a dead model in production, discovered by a customer.
 *
 * So this file walks the power set of the flags, re-imports the modules under
 * each combination, and asserts the invariants hold in all of them. It is the
 * only test that can see a defect which is *created by flipping a switch*.
 *
 * ## The invariants
 *
 *   1. every model an adapter serves has a cost entry          (registry ⊆ costs)
 *   2. every cost entry names a model some adapter can serve,
 *      or is explicitly `enabled: false`                        (costs ⊆ registry ∪ disabled)
 *   3. every Director-routable model is registry-backed         (routing ⊆ registry)
 *   4. every model with an audio strategy is registry-backed    (audio ⊆ registry)
 *   5. every compiler names a registry-backed model             (compilers ⊆ registry)
 *
 * Note what invariant 3 does **not** say: that every registry model is
 * routable. `veo-3.1-lite` is deliberately sellable by direct selection and not
 * offered to the Director, because `compileVeo` emits a negative prompt its
 * schema has no field for. One-directional containment is the real rule.
 */

const FLAGS = ["ENABLE_VEO_31", "ENABLE_SMART_IMAGE"] as const;

/** Every on/off combination of the flags that change the model set. */
function combinations(): Record<string, string | undefined>[] {
  const out: Record<string, string | undefined>[] = [];
  for (let mask = 0; mask < 1 << FLAGS.length; mask++) {
    const combo: Record<string, string | undefined> = {};
    FLAGS.forEach((flag, i) => {
      combo[flag] = mask & (1 << i) ? "1" : undefined;
    });
    out.push(combo);
  }
  return out;
}

const label = (combo: Record<string, string | undefined>) =>
  FLAGS.map((f) => `${f.replace("ENABLE_", "")}=${combo[f] ?? "0"}`).join(" ");

const original = { ...process.env };

afterEach(() => {
  for (const flag of FLAGS) {
    if (original[flag] === undefined) delete process.env[flag];
    else process.env[flag] = original[flag];
  }
});

/**
 * Load the adapters fresh under the current environment.
 *
 * `vi.resetModules()` is required: the flag-gated arrays are module-level
 * constants, so a cached module would answer for whichever flag state happened
 * to exist when the test file first imported it — which is exactly the blind
 * spot this file exists to remove.
 */
async function servedModels(): Promise<ProviderModel[]> {
  vi.resetModules();

  const [replicate, openai, google, mock] = await Promise.all([
    import("@/services/ai/providers/replicate"),
    import("@/services/ai/providers/openai"),
    import("@/services/ai/providers/google"),
    import("@/services/ai/providers/mock"),
  ]);

  return [
    ...replicate.replicateProvider.listModels(),
    ...openai.openaiProvider.listModels(),
    ...google.googleProvider.listModels(),
    ...mock.mockProvider.listModels(),
  ];
}

async function servedModelIds(): Promise<string[]> {
  return (await servedModels()).map((m) => m.id);
}

describe("catalogue integrity across every feature-flag combination", () => {
  for (const combo of combinations()) {
    describe(label(combo), () => {
      it("1. every served model has a cost entry", async () => {
        for (const flag of FLAGS) {
          if (combo[flag] === undefined) delete process.env[flag];
          else process.env[flag] = combo[flag];
        }

        const served = await servedModelIds();
        const missing = served.filter((id) => !costEntry(id));

        expect(
          missing,
          `served but unpriced under ${label(combo)}: ${missing.join(", ")}`,
        ).toEqual([]);
      });

      it("2. every served model clears its own margin floor", async () => {
        for (const flag of FLAGS) {
          if (combo[flag] === undefined) delete process.env[flag];
          else process.env[flag] = combo[flag];
        }

        /**
         * Assessed with `assessPrice`, the same function `model-costs.test.ts`
         * uses — deliberately not a second implementation.
         *
         * A first draft of this test computed margin at the model's *longest*
         * duration and reported Motion Pro and the music model as far below
         * their floors. Both were fine: `creditCost` is the price at the
         * **base** duration and `services/ai/pricing.ts` multiplies it by
         * `durationSeconds / min(durations)`, so Motion Pro charges 432 credits
         * at 12 seconds, not 180. Re-deriving the rule here would have produced
         * a confident wrong answer about two live prices — which is exactly the
         * failure this file exists to prevent, one level up.
         */
        const served = await servedModels();
        const thin: string[] = [];

        for (const model of served) {
          const entry = costEntry(model.id);
          if (!entry || !entry.enabled) continue;

          const base = model.capabilities.durations?.length
            ? Math.min(...model.capabilities.durations)
            : undefined;

          const verdict = assessPrice(entry, base);
          if (!verdict.safe) {
            thin.push(`${model.id}: ${verdict.reason}`);
          }
        }

        expect(thin, `below floor under ${label(combo)}`).toEqual([]);
      });
    });
  }
});

describe("nothing references a model no adapter can serve", () => {
  /**
   * Checked with **every** flag on, which is the widest the served set ever
   * gets. A reference that is unreachable even then is unreachable always —
   * that is what a phantom is, and `replicate/seedance-2.5` was one: routable,
   * compilable, quoted at 1,387 credits, and absent from every adapter.
   */
  async function widestServedSet(): Promise<Set<string>> {
    for (const flag of FLAGS) process.env[flag] = "1";
    return new Set(await servedModelIds());
  }

  it("3. every Director-routable video model is registry-backed", async () => {
    const served = await widestServedSet();
    const phantom = MODEL_CAPABILITIES.map((m) => m.id).filter(
      (id) => !served.has(id),
    );
    expect(phantom, `routable but unservable: ${phantom.join(", ")}`).toEqual(
      [],
    );
  });

  it("4. every audio-strategy entry is registry-backed", async () => {
    const served = await widestServedSet();
    const phantom = Object.keys(AUDIO_CAPABILITIES).filter(
      (id) => !served.has(id),
    );
    expect(
      phantom,
      `audio strategy for an unservable model: ${phantom.join(", ")}`,
    ).toEqual([]);
  });

  it("5. every compiler is registry-backed", async () => {
    const served = await widestServedSet();
    const phantom = Object.keys(COMPILERS_BY_MODEL).filter(
      (id) => !served.has(id),
    );
    expect(
      phantom,
      `compiler for an unservable model: ${phantom.join(", ")}`,
    ).toEqual([]);
  });

  it("6. every enabled cost entry is servable by some adapter", async () => {
    /**
     * The other direction. A priced, enabled model that no adapter serves is a
     * catalogue row promising something that cannot run.
     *
     * `enabled: false` rows are exempt on purpose — `flux-2-pro` and
     * `gemini-2.5-flash-image` are deliberately audited-and-unsold records, and
     * deleting them would lose the reason they are off.
     */
    const served = await widestServedSet();
    const orphans = MODEL_COSTS.filter(
      (entry) => entry.enabled && !served.has(entry.modelId),
    ).map((entry) => entry.modelId);

    expect(
      orphans,
      `priced and enabled but unservable: ${orphans.join(", ")}`,
    ).toEqual([]);
  });
});

/**
 * Every duration a customer can pick, priced at or above the floor.
 *
 * ## Why per-duration rather than per-model
 *
 * `creditCost` is the price at the model's *base* duration, and
 * `services/ai/pricing.ts` multiplies it by `durationSeconds / min(durations)`.
 * Cost scales linearly too, so the ratio is *supposed* to be identical at every
 * rung — but "supposed to" is exactly the assumption that put `veo-3.1-fast` on
 * the catalogue at 2.40x for a year. `Math.ceil` also rounds the charge up at
 * fractional multipliers, which can only help, and this proves it.
 *
 * Priced on the **Replicate route**, per model, because that is the only
 * adapter that exists. See the TODO in `model-costs.ts` for the Google-direct
 * comparison and why it is a separate sprint.
 */
describe("every offered duration clears the margin floor", () => {
  /**
   * Replicate's published per-second rates, re-verified 2026-08-24.
   *
   * `veo-3.1-lite` was here and is not any more. It was withdrawn from the
   * catalogue on 2026-08-26: it is a separate endpoint on a separate pinned
   * version from the two Cinematic tiers, so it is a separate licence question
   * and nobody has answered it. A margin floor for a model that cannot be
   * selected asserts nothing, and leaving the row would have quietly implied
   * the model was still on offer.
   */
  const REPLICATE_PER_SECOND_MICRO_USD: Record<string, number> = {
    "replicate/veo-3.1": 400_000, // with audio
    "replicate/veo-3.1-fast": 150_000, // with audio, flat across resolutions
  };

  it("holds at 4, 6 and 8 seconds on every Veo tier", async () => {
    for (const flag of FLAGS) process.env[flag] = "1";
    const served = await servedModels();

    const failures: string[] = [];

    for (const [id, perSecond] of Object.entries(
      REPLICATE_PER_SECOND_MICRO_USD,
    )) {
      const model = served.find((m) => m.id === id);
      expect(model, `${id} is not served with the flag on`).toBeDefined();

      const durations = model!.capabilities.durations ?? [];
      expect(durations, `${id} declares no durations`).toEqual([4, 6, 8]);

      const base = Math.min(...durations);

      for (const seconds of durations) {
        // The same arithmetic `creditsFor` performs at submission.
        const charged = Math.ceil(model!.creditCost * (seconds / base));
        const revenue = charged * 5_000;
        const cost = perSecond * seconds;
        const ratio = revenue / cost;

        if (ratio < 3) {
          failures.push(
            `${id} @${seconds}s: ${charged} credits = ${ratio.toFixed(2)}x`,
          );
        }
      }
    }

    expect(failures, `below the 3.0x video floor`).toEqual([]);
  });

  it("charges a flat rate no lower than the base price", async () => {
    /**
     * The Creative Director quotes `creditsPerGeneration` from
     * `brief-routing.ts` — a **flat** figure that ignores the brief's duration.
     * It is set at the 8-second price, so it clears the floor at every rung and
     * over-clears at the short ones: a 4-second Fast plan is quoted 720 credits
     * where 360 would hold 3.0x.
     *
     * That is an overcharge, not a loss, so it is recorded here rather than
     * silently repriced — making the Director duration-aware changes what
     * customers pay and deserves its own decision.
     */
    const { MODEL_CAPABILITIES: routing } =
      await import("@/services/ai/brief-routing");

    for (const [id, perSecond] of Object.entries(
      REPLICATE_PER_SECOND_MICRO_USD,
    )) {
      const row = routing.find((m) => m.id === id);
      if (!row) continue; // veo-3.1-lite is deliberately not Director-routable.

      const longest = row.maxDurationSeconds;
      const ratio = (row.creditsPerGeneration * 5_000) / (perSecond * longest);
      expect(
        ratio,
        `${id} flat quote ${row.creditsPerGeneration} at ${longest}s`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
