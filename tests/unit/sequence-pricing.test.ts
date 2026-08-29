import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One price, and it lives on the provider registry.
 *
 * ## The mistake this pins shut
 *
 * `creditCost` was a field on the sequence capability table — a module three
 * client components import — so the price list shipped to every browser that
 * opened the Studio. Moving it to a server-only module fixed the leak and
 * created a worse problem: a *second* copy of every price. It had already
 * drifted by the time anyone looked, quoting Cinematic Fast at 288 credits
 * while the registry charged 360.
 *
 * A duplicated price is not a stale number, it is two answers to "what does
 * this cost" — and the customer sees one while the ledger charges the other.
 *
 * So there is no price table anywhere near the sequence code now. These prove
 * it by moving the registry's figure and watching every quote follow, with no
 * edit to `sequence-models.server.ts`.
 */

const REGISTRY_PRICE = { value: 100 };

vi.mock("@/services/ai/registry", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  priceFor: (_id: string, outputs: number, seconds?: number) =>
    // The real `priceFor` scales the base price by duration; mirrored here so
    // the assertions below exercise scaling as well as the lookup.
    Math.ceil(
      REGISTRY_PRICE.value * Math.max(1, outputs) * (seconds ? seconds / 5 : 1),
    ),
  findModel: (id: string) => ({
    id,
    modality: "VIDEO",
    creditCost: REGISTRY_PRICE.value,
    capabilities: {
      operations: ["text-to-video"],
      durations: [5, 7.5],
      maxOutputs: 1,
      aspectRatios: ["16:9"],
    },
  }),
  listModels: () => [
    {
      id: "replicate/video-gen",
      providerId: "replicate",
      displayName: "Motion 1",
      modality: "VIDEO",
      creditCost: REGISTRY_PRICE.value,
      capabilities: {
        operations: ["text-to-video"],
        durations: [5, 7.5],
        maxOutputs: 1,
        aspectRatios: ["16:9"],
      },
    },
  ],
}));

const { quoteSequenceForCaller } =
  await import("@/services/connectors/sequence-quote");

const request = (over: Record<string, unknown> = {}) => ({
  publicModelId: "motion-1",
  mode: "continuous" as const,
  prompt: "a sports car on a coastal road",
  durationSeconds: 5,
  ...over,
});

beforeEach(() => {
  REGISTRY_PRICE.value = 100;
});

describe("the quote follows the authoritative price", () => {
  it("charges what the registry says", () => {
    const result = quoteSequenceForCaller(request(), "public");

    expect(result.ok).toBe(true);
    expect(result.quote!.creditCost).toBe(100);
  });

  it("moves when the registry moves, with no edit to the sequence modules", () => {
    /**
     * The property that makes a duplicate impossible to reintroduce quietly.
     * Nothing about the sequence code changes between these two calls — only
     * the registry's figure — and the quote follows.
     */
    const before = quoteSequenceForCaller(request(), "public");

    REGISTRY_PRICE.value = 250;
    const after = quoteSequenceForCaller(request(), "public");

    expect(before.quote!.creditCost).toBe(100);
    expect(after.quote!.creditCost).toBe(250);
  });

  it("scales with duration rather than quoting a flat rate", () => {
    const short = quoteSequenceForCaller(
      request({ durationSeconds: 5 }),
      "public",
    );
    const long = quoteSequenceForCaller(
      request({ durationSeconds: 7.5 }),
      "public",
    );

    expect(long.quote!.creditCost).toBeGreaterThan(short.quote!.creditCost);
  });
});

describe("the client cannot name its own price", () => {
  it("ignores a credit figure sent with the request", () => {
    /**
     * A client that can name its own price is a client that will name zero.
     * `SequenceQuoteRequest` has no price field, and passing one anyway must
     * change nothing — the quote is computed from settings, never read from
     * input.
     */
    const forged = quoteSequenceForCaller(
      request({ creditCost: 1, baseCredits: 1, price: 0 }) as never,
      "public",
    );

    expect(forged.quote!.creditCost).toBe(100);
  });
});

describe("policy and settings are checked before anything is priced", () => {
  it("refuses an unknown public id without quoting", () => {
    const result = quoteSequenceForCaller(
      request({ publicModelId: "not-a-model" }),
      "public",
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("model_unavailable");
    expect(result.quote).toBeUndefined();
  });

  it("refuses a provider path outright", () => {
    // Accepting one would keep the internal path a working input forever.
    const result = quoteSequenceForCaller(
      request({ publicModelId: "replicate/video-gen" }),
      "public",
    );

    expect(result.reason).toBe("model_unavailable");
  });

  it("refuses a model this caller may not run, before the price", () => {
    /**
     * Motion Pro is owner-evaluation. Pricing it for a customer would be an
     * offer we then have to withdraw at submission.
     */
    const result = quoteSequenceForCaller(
      request({ publicModelId: "motion-pro" }),
      "public",
    );

    expect(result.reason).toBe("model_unavailable");
    expect(result.quote).toBeUndefined();
  });

  it("refuses a duration the model cannot render", () => {
    const result = quoteSequenceForCaller(
      request({ durationSeconds: 10 }),
      "public",
    );

    expect(result.reason).toBe("model_setting_unavailable");
    expect(result.message).toMatch(/5, 7\.5/);
    expect(result.quote).toBeUndefined();
  });

  it("refuses an output count the model cannot produce", () => {
    const result = quoteSequenceForCaller(request({ outputs: 4 }), "public");

    expect(result.reason).toBe("model_setting_unavailable");
    expect(result.quote).toBeUndefined();
  });
});

describe("the quote a browser receives", () => {
  it("names no provider and carries no cost of ours", () => {
    const result = quoteSequenceForCaller(request(), "public");
    const serialised = JSON.stringify(result.quote);

    expect(serialised).not.toMatch(
      /replicate|google|bytedance|wan-video|seedance/i,
    );
    expect(serialised).not.toMatch(/providerCost|perSecondMicroUsd|costBasis/);
  });

  it("says nothing about which model was refused, or why", () => {
    /**
     * "That model exists but is not for you" tells an integrator an
     * owner-only catalogue exists. Both refusals read the same.
     */
    const unknown = quoteSequenceForCaller(
      request({ publicModelId: "not-a-model" }),
      "public",
    );
    const ownerOnly = quoteSequenceForCaller(
      request({ publicModelId: "motion-pro" }),
      "public",
    );

    expect(unknown.message).toBe(ownerOnly.message);
  });
});
