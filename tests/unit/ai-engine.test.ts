import { beforeEach, describe, expect, it } from "vitest";

import {
  PROVIDER_CATALOGUE,
  declaredProviders,
  describeProvider,
  fallbackCandidates,
  implementedProviders,
} from "@/services/ai/catalogue";
import {
  DEFAULT_BREAKER,
  healthOf,
  isAvailable,
  recordFailure,
  recordSuccess,
  resetHealth,
} from "@/services/ai/health";
import {
  DEFAULT_RETRY_POLICY,
  RATE_LIMIT_RETRY_POLICY,
  isRetryable,
  nextAttempt,
  policyFor,
  retryDelayMs,
} from "@/services/ai/retry";
import { estimateCost, formatMicroUsd } from "@/services/ai/cost";
import type { ProviderError } from "@/services/ai/types";

const err = (code: ProviderError["code"], retryable = true): ProviderError => ({
  code,
  retryable,
  message: "x",
});

describe("provider catalogue", () => {
  it("gives every provider a unique id", () => {
    const ids = PROVIDER_CATALOGUE.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every provider a unique priority, so order is total", () => {
    // Ties would make fallback order depend on array position, which is the
    // kind of thing that changes silently in a merge.
    const priorities = PROVIDER_CATALOGUE.map((p) => p.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it("declares at least one family for every provider", () => {
    for (const p of PROVIDER_CATALOGUE) {
      expect(p.families.length, p.id).toBeGreaterThan(0);
    }
  });

  it("does not claim Anthropic generates images or video", () => {
    // It reasons about images; it does not make them. Listing it as an image
    // provider would let the fallback resolver route generation to a vendor
    // that cannot serve it.
    const anthropic = describeProvider("anthropic");
    expect(anthropic?.families).toEqual(["multimodal"]);
  });

  it("separates implemented from declared, and the sum is the whole", () => {
    expect(implementedProviders().length + declaredProviders().length).toBe(
      PROVIDER_CATALOGUE.length,
    );
  });

  it("has exactly two implemented providers", () => {
    // Asserted rather than described, so the honest count in AI_ENGINE.md
    // cannot drift from the code.
    expect(
      implementedProviders()
        .map((p) => p.id)
        .sort(),
    ).toEqual(["openai", "replicate"]);
  });
});

describe("fallback candidates", () => {
  it("never offers a declared-but-unimplemented provider", () => {
    // The whole point of the status field: a declared provider must be
    // unreachable, not merely deprioritised.
    for (const family of ["image", "video"] as const) {
      for (const candidate of fallbackCandidates(family, "none")) {
        expect(candidate.status, candidate.id).toBe("implemented");
      }
    }
  });

  it("never offers a provider from the wrong family", () => {
    for (const candidate of fallbackCandidates("video", "none")) {
      expect(candidate.families, candidate.id).toContain("video");
    }
  });

  it("excludes the provider that just failed", () => {
    const ids = fallbackCandidates("image", "replicate").map((p) => p.id);
    expect(ids).not.toContain("replicate");
  });

  it("returns candidates in priority order", () => {
    const priorities = fallbackCandidates("image", "none").map(
      (p) => p.priority,
    );
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
  });
});

describe("retry policy", () => {
  it("retries transient provider failures", () => {
    for (const code of [
      "rate_limited",
      "provider_unavailable",
      "timeout",
      "unknown",
    ] as const) {
      expect(isRetryable(err(code)), code).toBe(true);
    }
  });

  it("never retries a request that cannot succeed", () => {
    // Retrying a content filter burns money to be told no a second time.
    for (const code of [
      "content_filtered",
      "invalid_request",
      "unsupported_operation",
      "insufficient_provider_credit",
    ] as const) {
      expect(isRetryable(err(code)), code).toBe(false);
    }
  });

  it("lets an adapter veto a retry the table would allow", () => {
    // An adapter has vendor knowledge this table does not. It may be more
    // pessimistic; it may not be more optimistic.
    expect(isRetryable(err("timeout", false))).toBe(false);
  });

  it("does not let an adapter force a retry the table forbids", () => {
    expect(isRetryable(err("content_filtered", true))).toBe(false);
  });

  it("gives rate limits a slower schedule", () => {
    expect(policyFor(err("rate_limited"))).toBe(RATE_LIMIT_RETRY_POLICY);
    expect(policyFor(err("timeout"))).toBe(DEFAULT_RETRY_POLICY);
    expect(RATE_LIMIT_RETRY_POLICY.baseDelayMs).toBeGreaterThan(
      DEFAULT_RETRY_POLICY.baseDelayMs,
    );
  });

  it("backs off exponentially, bounded by the cap", () => {
    // `random` pinned to 1 so the jitter returns the full window.
    const full = () => 0.999999;
    const d1 = retryDelayMs(1, DEFAULT_RETRY_POLICY, full);
    const d2 = retryDelayMs(2, DEFAULT_RETRY_POLICY, full);
    const d3 = retryDelayMs(3, DEFAULT_RETRY_POLICY, full);

    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);
    expect(d3).toBeLessThanOrEqual(DEFAULT_RETRY_POLICY.maxDelayMs);
  });

  it("applies full jitter, so clients do not retry in lockstep", () => {
    // The thundering herd this prevents: without jitter every client throttled
    // at the same moment retries at the same moment.
    expect(retryDelayMs(3, DEFAULT_RETRY_POLICY, () => 0)).toBe(0);
    expect(retryDelayMs(3, DEFAULT_RETRY_POLICY, () => 0.5)).toBeGreaterThan(0);
  });

  it("stops after the policy's maximum", () => {
    expect(nextAttempt(err("timeout"), 0)).not.toBeNull();
    expect(
      nextAttempt(err("timeout"), DEFAULT_RETRY_POLICY.maxRetries),
    ).toBeNull();
  });

  it("returns null immediately for a non-retryable error", () => {
    expect(nextAttempt(err("content_filtered"), 0)).toBeNull();
  });
});

describe("circuit breaker", () => {
  const P = "test-provider";
  beforeEach(() => resetHealth(P));

  it("starts closed", () => {
    expect(healthOf(P).state).toBe("closed");
    expect(isAvailable(P)).toBe(true);
  });

  it("opens after the failure threshold", () => {
    for (let i = 0; i < DEFAULT_BREAKER.failureThreshold; i++) {
      recordFailure(P, err("provider_unavailable"));
    }
    expect(healthOf(P).state).toBe("open");
    expect(isAvailable(P)).toBe(false);
  });

  it("does not open on one failure", () => {
    // Providers drop the occasional request. Opening on noise would make the
    // fallback path the normal path and hide the real failure rate.
    recordFailure(P, err("timeout"));
    expect(healthOf(P).state).toBe("closed");
  });

  it("ignores failures that are the request's fault, not the provider's", () => {
    // A refused prompt is not evidence the vendor is unwell.
    for (let i = 0; i < 10; i++) recordFailure(P, err("content_filtered"));
    expect(healthOf(P).state).toBe("closed");
    expect(healthOf(P).consecutiveFailures).toBe(0);
    // Still counted for visibility.
    expect(healthOf(P).totals.failure).toBe(10);
  });

  it("half-opens after the cooldown", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < DEFAULT_BREAKER.failureThreshold; i++) {
      recordFailure(P, err("timeout"), DEFAULT_BREAKER, t0);
    }
    expect(healthOf(P, DEFAULT_BREAKER, t0).state).toBe("open");

    const later = t0 + DEFAULT_BREAKER.cooldownMs + 1;
    expect(healthOf(P, DEFAULT_BREAKER, later).state).toBe("half-open");
    // A probe is allowed through.
    expect(isAvailable(P, DEFAULT_BREAKER, later)).toBe(true);
  });

  it("stays open before the cooldown elapses", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < DEFAULT_BREAKER.failureThreshold; i++) {
      recordFailure(P, err("timeout"), DEFAULT_BREAKER, t0);
    }
    const early = t0 + DEFAULT_BREAKER.cooldownMs - 1;
    expect(healthOf(P, DEFAULT_BREAKER, early).state).toBe("open");
  });

  it("closes on a successful probe", () => {
    const t0 = 3_000_000;
    for (let i = 0; i < DEFAULT_BREAKER.failureThreshold; i++) {
      recordFailure(P, err("timeout"), DEFAULT_BREAKER, t0);
    }
    healthOf(P, DEFAULT_BREAKER, t0 + DEFAULT_BREAKER.cooldownMs + 1);

    recordSuccess(P);

    expect(healthOf(P).state).toBe("closed");
    expect(healthOf(P).consecutiveFailures).toBe(0);
  });

  it("re-opens immediately when the probe fails — one strike, not three", () => {
    // Making a known-bad provider earn three more failures would send two more
    // users into it.
    const t0 = 4_000_000;
    for (let i = 0; i < DEFAULT_BREAKER.failureThreshold; i++) {
      recordFailure(P, err("timeout"), DEFAULT_BREAKER, t0);
    }
    const probeTime = t0 + DEFAULT_BREAKER.cooldownMs + 1;
    expect(healthOf(P, DEFAULT_BREAKER, probeTime).state).toBe("half-open");

    recordFailure(P, err("timeout"), DEFAULT_BREAKER, probeTime);

    expect(healthOf(P, DEFAULT_BREAKER, probeTime).state).toBe("open");
  });
});

describe("cost tracking", () => {
  const model = {
    id: "replicate/flux-schnell",
    providerId: "replicate",
    displayName: "Flux Schnell",
    modality: "IMAGE" as const,
    creditCost: 4,
    capabilities: {
      supportsNegativePrompt: false,
      supportsImageInput: false,
      supportsSeed: true,
      aspectRatios: [],
      maxOutputs: 4,
      operations: ["text-to-image" as const],
    },
  };

  it("reports cost in micro-USD and scales with outputs", () => {
    expect(estimateCost(model, 1).costMicroUsd).toBe(3_000);
    expect(estimateCost(model, 4).costMicroUsd).toBe(12_000);
  });

  it("reports null — never zero — for a model with no recorded basis", () => {
    // Assuming zero is how a loss-making model looks like the best one in the
    // table.
    const unknown = { ...model, id: "vendor/unpriced" };
    expect(estimateCost(unknown, 1).costMicroUsd).toBeNull();
    expect(estimateCost(unknown, 1).basisChecked).toBeNull();
  });

  it("still reports what we charge even when cost is unknown", () => {
    const unknown = { ...model, id: "vendor/unpriced" };
    expect(estimateCost(unknown, 2).credits).toBe(8);
  });

  it("computes a margin ratio only when both sides are known", () => {
    const withValue = estimateCost(model, 1, { creditValueMicroUsd: 10_000 });
    // 4 credits at $0.01 = $0.04 revenue against $0.003 cost.
    expect(withValue.marginRatio).toBeCloseTo(3_000 / 40_000, 6);

    // No credit value supplied → no ratio, rather than Infinity or NaN.
    expect(estimateCost(model, 1).marginRatio).toBeNull();
  });

  it("charges video by duration", () => {
    const video = {
      ...model,
      id: "replicate/video-gen",
      creditCost: 90,
      capabilities: { ...model.capabilities, durations: [5, 10] },
    };

    const five = estimateCost(video, 1, { durationSeconds: 5 });
    const ten = estimateCost(video, 1, { durationSeconds: 10 });

    expect(ten.costMicroUsd).toBe((five.costMicroUsd ?? 0) * 2);
  });

  it("formats unknown cost as 'unknown', not as $0.00", () => {
    expect(formatMicroUsd(null)).toBe("unknown");
    expect(formatMicroUsd(3_000)).toMatch(/^\$0\.0030$/);
    expect(formatMicroUsd(2_500_000)).toBe("$2.50");
  });

  it("picks precision by magnitude, so refunds format like charges", () => {
    // A duplicate of this function in `services/billing/usage.ts` compared the
    // signed value, so every negative amount fell into the four-decimal branch
    // and a refund rendered differently from the charge it reversed. RC1
    // deleted the duplicate; this pins the surviving behaviour.
    expect(formatMicroUsd(-2_500_000)).toBe("$-2.50");
    expect(formatMicroUsd(-3_000)).toMatch(/^\$-0\.0030$/);
  });
});
