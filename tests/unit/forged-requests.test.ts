import { describe, expect, it, vi } from "vitest";

/**
 * Requests that never touched the composer.
 *
 * ## Why this file exists
 *
 * Studio V2 blocks Silent on a model that always makes sound, blocks Generate,
 * and explains why. All of that is a convenience. The composer is the one
 * place an attacker controls completely, and an MCP client never renders it at
 * all — so every rule the interface enforces has to be enforced again on the
 * server, before a price is quoted and long before anything is reserved.
 *
 * Two of the rules below were *not* enforced there until now.
 * `rejectImpossibleAudio` was written as "the server-side rule" and called by
 * nothing, and a requested duration on a model with no duration enum was
 * silently discarded. Both are checked here against the real services.
 *
 * ## What is mocked
 *
 * The registry, so the catalogue does not depend on a provider key being in
 * the environment. Nothing else: the policy, the audio table and the settings
 * validation are the real ones.
 */

const FIXTURES = [
  {
    id: "replicate/flux-schnell",
    providerId: "replicate",
    displayName: "FLUX Schnell",
    modality: "IMAGE",
    creditCost: 4,
    capabilities: {
      operations: ["text-to-image"],
      maxOutputs: 4,
      aspectRatios: ["1:1", "16:9"],
      supportsImageInput: false,
      supportsNegativePrompt: false,
      supportsSeed: true,
    },
  },
  {
    id: "google/omni-1.1-flash",
    providerId: "google-omni",
    displayName: "Cinematic Next",
    modality: "VIDEO",
    creditCost: 630,
    capabilities: {
      operations: ["text-to-video"],
      maxOutputs: 1,
      aspectRatios: ["16:9", "9:16"],
      supportsImageInput: true,
      supportsNegativePrompt: false,
      supportsSeed: false,
      maxDurationSeconds: 10,
      // No `durations`. The model chooses.
    },
  },
  {
    id: "replicate/video-gen",
    providerId: "replicate",
    displayName: "Motion 1",
    modality: "VIDEO",
    creditCost: 90,
    capabilities: {
      operations: ["text-to-video"],
      durations: [5, 7.5],
      maxOutputs: 1,
      aspectRatios: ["16:9", "9:16"],
      supportsImageInput: false,
      supportsNegativePrompt: false,
      supportsSeed: false,
    },
  },
];

vi.mock("@/services/ai/registry", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listModels: () => FIXTURES,
  findModel: (id: string) => FIXTURES.find((m) => m.id === id) ?? null,
  priceFor: (id: string, outputs: number, seconds?: number) => {
    const model = FIXTURES.find((m) => m.id === id);
    if (!model) return 0;
    const durations = model.capabilities.durations;
    const multiplier =
      durations && seconds ? seconds / Math.min(...durations) : 1;
    return Math.ceil(model.creditCost * Math.max(1, outputs) * multiplier);
  },
}));

const { prepareGeneration } = await import("@/services/connectors/prepare");

const forge = (over: Record<string, unknown>) =>
  prepareGeneration(
    {
      publicModelId: "cinematic-next",
      prompt: "a surfer on a wave",
      ...over,
    },
    // The owner, deliberately. This model is owner-evaluation only, so using a
    // public caller would fail on policy and prove nothing about audio.
    "owner",
    "u_1",
  );

describe("silence is refused server-side, not only in the interface", () => {
  it("rejects a forged Silent request before a price exists", () => {
    const result = forge({ audio: "SILENT" });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("model_setting_unavailable");

    /**
     * The three things a refusal must not produce: a price, a token, and a row
     * to persist. Nothing was quoted, so there is nothing to withdraw.
     */
    expect(result.prepared).toBeUndefined();
    expect(result.quoteRecord).toBeUndefined();
    expect(result.requestHash).toBeUndefined();
  });

  it("says why in words safe to show anyone", () => {
    const result = forge({ audio: "SILENT" });

    expect(result.message).toBe("Cinematic Next always creates native audio.");
    // No vendor, no endpoint, no policy status, no other model.
    expect(result.message).not.toMatch(
      /google|gemini|omni|vertex|generativelanguage|replicate/i,
    );
    expect(result.message).not.toMatch(
      /policy|licen|owner|evaluation|preview/i,
    );
  });

  it("allows Auto and Native, which the model can actually deliver", () => {
    for (const audio of ["AUTO", "NATIVE_AUDIO"] as const) {
      const result = forge({ audio });
      expect(result.ok, audio).toBe(true);
      expect(result.prepared!.credits, audio).toBe(630);
    }
  });

  it("defaults to Auto when the field is absent entirely", () => {
    // An older client that predates the field must not be refused.
    expect(forge({}).ok).toBe(true);
  });

  it("still refuses native sound from a model that has none", () => {
    const result = prepareGeneration(
      {
        publicModelId: "motion-1",
        prompt: "a surfer on a wave",
        audio: "NATIVE_AUDIO",
      },
      "public",
      "u_1",
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("model_setting_unavailable");
    expect(result.message).toMatch(/cannot produce native audio/);
  });
});

describe("a requested duration is refused, not discarded", () => {
  it("rejects an exact length on a model that chooses its own", () => {
    /**
     * `exactDuration` returned `undefined` here and the value was dropped. The
     * price would have been right — it is fixed on the maximum either way —
     * but the caller would have believed a ten-second clip was promised.
     * Silently discarding a request is the same defect as silently rounding
     * one.
     */
    const result = forge({ durationSeconds: 10 });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("model_setting_unavailable");
    expect(result.message).toMatch(/does not take a duration/i);
  });

  it("rejects a plausible one just as firmly", () => {
    expect(forge({ durationSeconds: 5 }).ok).toBe(false);
  });

  it("quotes the fixed maximum price when no duration is sent", () => {
    const result = forge({});

    expect(result.ok).toBe(true);
    // 630 credits: 10s x $0.10 x 1.05 input buffer x 3.0 floor / $0.005.
    expect(result.prepared!.credits).toBe(630);
    // And no duration is promised back.
    expect(result.prepared!.settings.durationSeconds).toBeUndefined();
  });

  it("keeps the absent duration in the signed request hash", () => {
    /**
     * The token has to carry "no length was promised" rather than a number, or
     * `confirmGeneration` would re-derive a different hash and refuse a
     * legitimate confirmation — or worse, honour one that had acquired a
     * duration in between.
     */
    const result = forge({});
    const [body] = result.prepared!.token.split(".");
    const payload = JSON.parse(
      Buffer.from(body!, "base64url").toString("utf8"),
    ) as { connectorRequest?: { durationSeconds?: number } };

    expect(payload.connectorRequest).toBeDefined();
    expect(payload.connectorRequest!.durationSeconds).toBeUndefined();
  });

  it("still enforces the enum on a model that has one", () => {
    const result = prepareGeneration(
      {
        publicModelId: "motion-1",
        prompt: "a surfer on a wave",
        durationSeconds: 6,
      },
      "public",
      "u_1",
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Choose one of: 5, 7.5 seconds/);
  });
});

describe("an image model is not caught by the video rule", () => {
  it("ignores a stray duration rather than refusing the request", async () => {
    /**
     * "No duration enum" covers two different situations, and the first
     * version of this rule conflated them.
     *
     * A video model with no enum chooses its own length, and a caller asking
     * for a specific one must be told. An image model has no duration because
     * duration is meaningless for a still — a client sending a stray
     * `durationSeconds` there has not asked for anything impossible, and
     * refusing would break a working integration over a field nobody meant.
     *
     * `tests/unit/prepare-generation.test.ts` caught this: its shared fixture
     * carries `durationSeconds: 5` and one case overrides only the model.
     */
    const result = prepareGeneration(
      {
        publicModelId: "atheos-image-fast",
        prompt: "a lighthouse at dawn",
        durationSeconds: 5,
      },
      "public",
      "u_1",
    );

    expect(result.ok).toBe(true);
    expect(result.prepared!.settings.durationSeconds).toBeUndefined();
  });
});
