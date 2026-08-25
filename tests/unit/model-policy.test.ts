import { describe, expect, it } from "vitest";

import {
  MODEL_POLICIES,
  MODEL_UNAVAILABLE_CODE,
  MODEL_UNAVAILABLE_MESSAGE,
  isPubliclyOffered,
  isRunnable,
  policyFor,
  type ModelPolicy,
} from "@/services/ai/model-policy";
import { listModels } from "@/services/ai/registry";
import { catalogueModelId } from "@/features/studio/lib/public-model";

/**
 * The licence registry, and the things that must stay true about it.
 *
 * ## Why this is a test and not a document
 *
 * The audit that produced these verdicts was a one-off reading of ten hosted
 * endpoints. A document recording it goes stale the first time somebody adds a
 * model; a test fails the build instead. The rule that matters — **a catalogue
 * model with no policy cannot run** — is only worth anything if adding a model
 * without an entry is noisy, and that is exactly what `every catalogue model
 * has a policy` does.
 *
 * ## The finding that prompted it
 *
 * Score was live and sellable at 20 credits. Its weights are MusicGen's, which
 * are CC-BY-NC-4.0 — non-commercial. Selling generated output from it is the
 * one thing that licence forbids. Everything here exists so that combination
 * cannot recur silently.
 */

const VENDORS =
  /replicate|openai|google|black-forest|bytedance|wan-video|meta|musicgen|mmaudio|flux|veo|seedance/i;

/** Every field that has to be recorded for a verdict to be auditable. */
const REQUIRED_FIELDS: (keyof ModelPolicy)[] = [
  "modelId",
  "publicId",
  "publicName",
  "hostedEndpoint",
  "auditedVersion",
  "licence",
  "attribution",
  "trademark",
  "acceptableUse",
  "evidenceUrl",
  "verifiedOn",
  "verdict",
  "reason",
];

describe("the blocked model", () => {
  const music = policyFor("replicate/music")!;

  it("records MusicGen as non-commercial", () => {
    expect(music.verdict).toBe("BLOCKED");
    expect(music.licence).toMatch(/CC-BY-NC/i);
    expect(music.commercialSaasUse).toBe(false);
    expect(music.outputsSellable).toBe(false);
  });

  it("cannot run", () => {
    expect(isRunnable("replicate/music")).toBe(false);
  });

  it("cannot be advertised", () => {
    /**
     * The two are separate questions and were separate bugs: the model was
     * refused by nothing *and* listed at a price. Blocking one without the
     * other leaves either a broken picker or a live sale.
     */
    expect(isPubliclyOffered("replicate/music")).toBe(false);
  });

  it("is refused when a client sends its public id", () => {
    // "score" is still resolvable — history has to keep rendering — but what it
    // resolves to is not runnable, so the round trip is closed.
    expect(catalogueModelId("score")).toBe("replicate/music");
    expect(isRunnable(catalogueModelId("score")!)).toBe(false);
  });

  it("is refused when a client sends the internal provider id", () => {
    expect(catalogueModelId("replicate/music")).toBeNull();
    expect(isRunnable("replicate/music")).toBe(false);
  });

  it("is absent from the catalogue a browser receives", () => {
    const offered = listModels()
      .filter((model) => isPubliclyOffered(model.id))
      .map((model) => model.id);

    expect(offered).not.toContain("replicate/music");
  });
});

describe("the corrected FLUX.1 [dev] finding", () => {
  const flux = policyFor("replicate/flux-dev")!;

  it("is allowed, which the first audit got wrong", () => {
    expect(flux.verdict).toBe("ALLOWED");
    expect(flux.outputsSellable).toBe(true);
  });

  it("scopes the approval to one exact endpoint", () => {
    /**
     * The correction that matters. FLUX.1 [dev] is commercially usable through
     * the hosted endpoint and is *not* commercially licensed as downloadable
     * weights. A verdict attached to the model's name would silently travel to
     * a self-hosted copy and be wrong there.
     */
    expect(flux.hostedEndpoint).toBe("replicate:black-forest-labs/flux-dev");
    expect(flux.licence).toMatch(/non-commercial|weights/i);
  });

  it("records the version it was audited against", () => {
    // So a silent model swap under the same endpoint is visible in a diff.
    expect(flux.auditedVersion).toMatch(/^[0-9a-f]{8}/);
  });
});

describe("models awaiting verification", () => {
  const pending = MODEL_POLICIES.filter(
    (policy) => policy.verdict === "REVIEW_REQUIRED",
  );

  it("covers every model whose endpoint publishes no licence", () => {
    expect(pending.map((p) => p.modelId).sort()).toEqual([
      "replicate/veo-3.1",
      "replicate/veo-3.1-fast",
      "replicate/video-gen",
      "replicate/video-pro",
    ]);
  });

  it("cannot run, because absent evidence is not evidence of permission", () => {
    /**
     * None of these is known to be restricted. That is the point: a provider
     * listing a model and charging for it says what it will bill, not what it
     * is licensed to let us resell. Unverified fails closed.
     */
    for (const policy of pending) {
      expect(isRunnable(policy.modelId), policy.modelId).toBe(false);
      expect(isPubliclyOffered(policy.modelId), policy.modelId).toBe(false);
    }
  });
});

describe("the registry fails closed", () => {
  it("refuses a catalogue model with no policy", () => {
    expect(isRunnable("replicate/not-audited-yet")).toBe(false);
  });

  it("refuses an empty or malformed id rather than throwing", () => {
    expect(isRunnable("")).toBe(false);
    expect(isRunnable("../../etc/passwd")).toBe(false);
  });

  it("gives every catalogue model a policy", () => {
    /**
     * The guard that keeps the rest of this file honest. Without it, the way
     * to ship an unaudited model is to add it to the registry and change
     * nothing here — and it would run, because nothing would have noticed.
     */
    const unpoliced = listModels()
      .filter((model) => !model.id.startsWith("mock/"))
      .filter((model) => !policyFor(model.id))
      .map((model) => model.id);

    expect(unpoliced).toEqual([]);
  });

  it("takes no caller, so admin cannot be a bypass", () => {
    /**
     * Structural rather than behavioural, deliberately. A licence restriction
     * is an obligation to a third party, not an access-control rule — the
     * owner running a blocked model breaches it exactly as a customer would.
     * Making the functions unary means there is no argument to pass a
     * privileged user through.
     */
    expect(isRunnable.length).toBe(1);
    expect(isPubliclyOffered.length).toBe(1);
  });
});

describe("every recorded verdict is auditable", () => {
  it("fills in all thirteen recorded fields", () => {
    for (const policy of MODEL_POLICIES) {
      for (const field of REQUIRED_FIELDS) {
        expect(
          String(policy[field]).trim(),
          `${policy.modelId}.${field}`,
        ).not.toBe("");
      }
    }
  });

  it("cites a source that can be re-read", () => {
    for (const policy of MODEL_POLICIES) {
      expect(policy.evidenceUrl, policy.modelId).toMatch(/^https:\/\//);
      expect(policy.verifiedOn, policy.modelId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("never marks a model sellable while blocking it", () => {
    // The contradiction that would make the table look like a rubber stamp.
    for (const policy of MODEL_POLICIES) {
      if (policy.verdict === "ALLOWED") continue;
      expect(policy.commercialSaasUse, policy.modelId).toBe(false);
    }
  });

  it("maps each public id to exactly one catalogue model", () => {
    const ids = MODEL_POLICIES.map((p) => p.publicId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the refusal a customer reads", () => {
  it("names no vendor, no model and no licence", () => {
    /**
     * "Blocked: MusicGen is CC-BY-NC" tells a customer who we buy from and
     * what our contract with them says. Neither is theirs to know.
     */
    expect(MODEL_UNAVAILABLE_MESSAGE).not.toMatch(VENDORS);
    expect(MODEL_UNAVAILABLE_MESSAGE).not.toMatch(/licen[cs]e|commercial/i);
    expect(MODEL_UNAVAILABLE_CODE).not.toMatch(VENDORS);
  });
});
