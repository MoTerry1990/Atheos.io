import { describe, expect, it, vi } from "vitest";

/**
 * A quote costs nothing and promises exactly one price.
 *
 * ## What "prepare" must never do
 *
 * Move a credit, write a generation, reach a provider. Those are asserted by
 * mocking every module that could and proving none was called — the same shape
 * as the licence-gate tests, because "we checked the code and it doesn't" is
 * not a guarantee anyone can rely on six months from now.
 *
 * ## Why the registry is mocked and the policy is not
 *
 * The catalogue changes with a provider key in the environment; policy does
 * not. Mocking the registry makes these hermetic. Leaving the real policy in
 * means the audience rules are genuinely exercised rather than restated.
 */

const ledger = { reserve: vi.fn(), capture: vi.fn() };
const providerSubmit = vi.fn();

vi.mock("@/services/billing/ledger", () => ({
  reserveWithin: (...a: unknown[]) => ledger.reserve(...a),
  captureReservation: (...a: unknown[]) => ledger.capture(...a),
  releaseReservation: vi.fn(),
}));

const FIXTURES = [
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
    },
  },
  {
    id: "replicate/video-pro",
    providerId: "replicate",
    displayName: "Motion Pro",
    modality: "VIDEO",
    creditCost: 180,
    capabilities: {
      operations: ["text-to-video"],
      durations: [5, 10, 12],
      maxOutputs: 1,
      aspectRatios: ["16:9"],
      supportsImageInput: true,
    },
  },
  {
    id: "replicate/music",
    providerId: "replicate",
    displayName: "Score",
    modality: "AUDIO",
    creditCost: 20,
    capabilities: { operations: ["text-to-audio"], maxOutputs: 1 },
  },
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
    },
  },
];

vi.mock("@/services/ai/registry", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listModels: () => FIXTURES,
  findModel: (id: string) => FIXTURES.find((m) => m.id === id) ?? null,
  /**
   * Mocked alongside `findModel`, not instead of it.
   *
   * The real `priceFor` calls `findModel` *within its own module*, so mocking
   * the export leaves it looking at the real catalogue and returning 0 for
   * every fixture. Mirroring the arithmetic here keeps the fixtures priced
   * while `services/connectors/prepare.ts` still goes through the same
   * function it uses in production.
   */
  priceFor: (id: string, outputs: number, seconds?: number) => {
    const model = FIXTURES.find((m) => m.id === id);
    if (!model) return 0;

    const durations = model.capabilities.durations;
    const multiplier =
      durations && seconds ? seconds / Math.min(...durations) : 1;

    return Math.ceil(model.creditCost * Math.max(1, outputs) * multiplier);
  },
  providerForModel: () => ({ id: "test", submit: providerSubmit }),
}));

const { prepareGeneration, normaliseRequest, requestHash } =
  await import("@/services/connectors/prepare");
const { verifyPlanToken } = await import("@/services/ai/plan-token");

const request = (over: Record<string, unknown> = {}) => ({
  publicModelId: "motion-1",
  prompt: "a sports car on a coastal road",
  durationSeconds: 5,
  ...over,
});

const prepare = (over = {}, caller: "public" | "owner" = "public") =>
  prepareGeneration(request(over), caller, "user_1");

describe("prepare spends nothing", () => {
  it("reserves no credits", () => {
    prepare();
    expect(ledger.reserve).not.toHaveBeenCalled();
    expect(ledger.capture).not.toHaveBeenCalled();
  });

  it("calls no provider", () => {
    prepare();
    expect(providerSubmit).not.toHaveBeenCalled();
  });

  it("returns a price without creating anything", () => {
    const result = prepare();

    expect(result.ok).toBe(true);
    expect(result.prepared!.credits).toBe(90);
    expect(result.prepared!.confirmationRequired).toBe(true);
  });
});

describe("the quote is bound to what was asked for", () => {
  it("issues a token this user can verify", () => {
    const { prepared } = prepare();
    const verified = verifyPlanToken({
      token: prepared!.token,
      userId: "user_1",
      brief: {
        version: 1,
        originalPrompt: "a sports car on a coastal road",
        kind: "sequence",
        publicModelId: "motion-1",
        mode: "single",
        durationSeconds: 5,
        outputs: 1,
        clips: 1,
      },
      nowMs: Date.now(),
    });

    expect(verified.ok).toBe(true);
    expect(verified.payload!.quotedCredits).toBe(90);
  });

  it("refuses the same token for a different user", () => {
    /**
     * A plan is not transferable. Two accounts confirming one quote would
     * charge whichever one the confirmation named, not the one that asked.
     */
    const { prepared } = prepare();
    const verified = verifyPlanToken({
      token: prepared!.token,
      userId: "someone_else",
      brief: {
        version: 1,
        originalPrompt: "a sports car on a coastal road",
        kind: "sequence",
        publicModelId: "motion-1",
        mode: "single",
        durationSeconds: 5,
        outputs: 1,
        clips: 1,
      },
      nowMs: Date.now(),
    });

    expect(verified.ok).toBe(false);
    expect(verified.reason).toBe("wrong_user");
  });

  it("refuses a token whose settings were edited afterwards", () => {
    // Quote five seconds, confirm seven and a half. The hash covers the whole
    // brief, so the swap is a different object and fails the signature check.
    const { prepared } = prepare();
    const verified = verifyPlanToken({
      token: prepared!.token,
      userId: "user_1",
      brief: {
        version: 1,
        originalPrompt: "a sports car on a coastal road",
        kind: "sequence",
        publicModelId: "motion-1",
        mode: "single",
        durationSeconds: 7.5,
        outputs: 1,
        clips: 1,
      },
      nowMs: Date.now(),
    });

    expect(verified.ok).toBe(false);
  });

  it("refuses an expired token", () => {
    const { prepared } = prepare();
    const verified = verifyPlanToken({
      token: prepared!.token,
      userId: "user_1",
      brief: {
        version: 1,
        originalPrompt: "a sports car on a coastal road",
        kind: "sequence",
        publicModelId: "motion-1",
        mode: "single",
        durationSeconds: 5,
        outputs: 1,
        clips: 1,
      },
      // An hour later; the TTL is ten minutes.
      nowMs: Date.now() + 3_600_000,
    });

    expect(verified.ok).toBe(false);
    expect(verified.reason).toBe("expired");
  });

  it("refuses a tampered token", () => {
    const { prepared } = prepare();
    const [body] = prepared!.token.split(".");

    const verified = verifyPlanToken({
      token: `${body}.forged-signature`,
      userId: "user_1",
      brief: {
        version: 1,
        originalPrompt: "a sports car on a coastal road",
        kind: "sequence",
        publicModelId: "motion-1",
        mode: "single",
        durationSeconds: 5,
        outputs: 1,
        clips: 1,
      },
      nowMs: Date.now(),
    });

    expect(verified.ok).toBe(false);
    expect(verified.reason).toBe("bad_signature");
  });
});

describe("policy is checked before a price exists", () => {
  it("refuses Score for anyone", () => {
    for (const caller of ["public", "owner"] as const) {
      const result = prepare({ publicModelId: "score" }, caller);
      expect(result.reason, caller).toBe("model_unavailable");
      expect(result.prepared, caller).toBeUndefined();
    }
  });

  it("refuses an owner-evaluation model for a customer", () => {
    expect(prepare({ publicModelId: "motion-pro" }).reason).toBe(
      "model_unavailable",
    );
  });

  it("allows it for the owner", () => {
    const result = prepare({ publicModelId: "motion-pro" }, "owner");
    expect(result.ok).toBe(true);
    expect(result.prepared!.credits).toBe(180);
  });

  it("refuses a provider path outright", () => {
    expect(prepare({ publicModelId: "replicate/video-gen" }).reason).toBe(
      "model_unavailable",
    );
  });

  it("says the same thing about an unknown model and a forbidden one", () => {
    const unknown = prepare({ publicModelId: "no-such-model" });
    const forbidden = prepare({ publicModelId: "motion-pro" });

    expect(unknown.message).toBe(forbidden.message);
  });
});

describe("settings are validated exactly", () => {
  it("refuses a duration the model cannot render", () => {
    const result = prepare({ durationSeconds: 10 });

    expect(result.reason).toBe("model_setting_unavailable");
    expect(result.message).toMatch(/5, 7\.5/);
  });

  it("refuses an output count above the model's maximum", () => {
    const result = prepare({ publicModelId: "atheos-image-fast", outputs: 9 });
    expect(result.reason).toBe("model_setting_unavailable");
  });

  it("refuses a fractional output count", () => {
    const result = prepare({
      publicModelId: "atheos-image-fast",
      outputs: 2.5,
    });
    expect(result.reason).toBe("model_setting_unavailable");
  });

  it("refuses an aspect ratio the model does not offer", () => {
    expect(prepare({ aspectRatio: "21:9" }).reason).toBe(
      "model_setting_unavailable",
    );
  });

  it("refuses an empty prompt rather than quoting nothing", () => {
    expect(prepare({ prompt: "   " }).reason).toBe("invalid_request");
  });

  it("prices outputs, so four cost more than one", () => {
    const one = prepare({ publicModelId: "atheos-image-fast", outputs: 1 });
    const four = prepare({ publicModelId: "atheos-image-fast", outputs: 4 });

    expect(four.prepared!.credits).toBeGreaterThan(one.prepared!.credits);
  });
});

describe("the response says nothing it should not", () => {
  it("names no provider, endpoint or internal id", () => {
    const { prepared } = prepare();

    expect(JSON.stringify(prepared)).not.toMatch(
      /replicate|google\/|bytedance|wan-video|seedance|prediction/i,
    );
    expect(prepared!.model.id).toBe("motion-1");
  });

  it("states the audio honestly", () => {
    // Motion 1 is silent, and a caller planning a soundtrack needs to know
    // before they pay rather than after.
    const { prepared } = prepare();

    expect(prepared!.model.audio).toBe("silent");
    expect(prepared!.model.audioNote).toMatch(/no audio|silent/i);
  });

  it("carries an expiry the caller can act on", () => {
    const { prepared } = prepare();
    expect(prepared!.expiresAtMs).toBeGreaterThan(Date.now());
  });
});

describe("the request hash is what makes a retry recognisable", () => {
  it("is stable for the same request", () => {
    const one = normaliseRequest({
      publicModelId: "motion-1",
      prompt: "a wolf",
      outputs: 1,
      credits: 90,
    });
    const two = normaliseRequest({
      publicModelId: "motion-1",
      prompt: "a wolf",
      outputs: 1,
      credits: 90,
    });

    expect(requestHash(one)).toBe(requestHash(two));
  });

  it("changes when any bound setting changes", () => {
    const base = {
      publicModelId: "motion-1",
      prompt: "a wolf",
      outputs: 1,
      credits: 90,
    };
    const baseline = requestHash(normaliseRequest(base));

    for (const change of [
      { publicModelId: "motion-pro" },
      { prompt: "a fox" },
      { outputs: 2 },
      { credits: 180 },
      { durationSeconds: 7.5 },
    ]) {
      expect(
        requestHash(normaliseRequest({ ...base, ...change })),
        JSON.stringify(change),
      ).not.toBe(baseline);
    }
  });

  it("contains no prompt, only a digest of one", () => {
    // The hash goes into a database row; the customer's words must not.
    const hash = requestHash(
      normaliseRequest({
        publicModelId: "motion-1",
        prompt: "a very distinctive phrase",
        outputs: 1,
        credits: 90,
      }),
    );

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("distinctive");
  });
});

describe("the request digest is kept out of the response", () => {
  it("is returned to the server, not to the caller", () => {
    /**
     * `confirmGeneration` needs it to tell a retry from a key reused for a
     * different call. A caller does not, and putting it in the response would
     * hand them a value to send back — which is how a client ends up asserting
     * something the server is supposed to derive.
     */
    const result = prepare();

    expect(result.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result.prepared)).not.toContain(result.requestHash!);
  });

  it("differs when the price differs, so a requote is detectable", () => {
    // Same prompt and model, different settings and therefore a different
    // price. Confirming the cheap one against the dear one must not match.
    const short = prepare({ durationSeconds: 5 });
    const long = prepare({ durationSeconds: 7.5 });

    expect(short.requestHash).not.toBe(long.requestHash);
  });
});
