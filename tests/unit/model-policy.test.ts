import { describe, expect, it } from "vitest";

import {
  MODEL_POLICIES,
  MODEL_UNAVAILABLE_CODE,
  MODEL_UNAVAILABLE_MESSAGE,
  isOfferedToOwner,
  isPubliclyOffered,
  isRunnableFor,
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
 * The audit that produced these statuses was a one-off reading of ten hosted
 * endpoints. A document recording it goes stale the first time somebody adds a
 * model; a test fails the build instead. The rule that matters — **a catalogue
 * model with no policy cannot run** — is only worth anything if adding a model
 * without an entry is noisy, and that is what `every catalogue model has a
 * policy` does.
 *
 * ## The two mistakes this vocabulary exists to prevent
 *
 * Score was live and sellable at 20 credits on CC-BY-NC weights — selling its
 * output is the one thing that licence forbids.
 *
 * And the first attempt to fix that overcorrected: it read "no open-source
 * licence published" on three *proprietary hosted APIs* as prohibition and
 * took them offline for everyone. Silence from a model that was never
 * distributed as weights is not a restriction. Both failures are asserted
 * against below, in opposite directions.
 */

const VENDORS =
  /replicate|openai|google|black-forest|bytedance|wan-video|meta|musicgen|mmaudio|flux|veo|seedance/i;

/** Every field that has to be recorded for a status to be auditable. */
const REQUIRED_FIELDS: (keyof ModelPolicy)[] = [
  "modelId",
  "hostedEndpoint",
  "auditedVersion",
  "publicId",
  "publicName",
  "status",
  "permittedAudience",
  "permittedProvider",
  "commercialOutput",
  "licence",
  "attribution",
  "trademark",
  "acceptableUse",
  "verifiedOn",
  "notes",
];

describe("Score is blocked for everyone", () => {
  const music = policyFor("replicate/music")!;

  it("records MusicGen's weights as non-commercial", () => {
    expect(music.status).toBe("BLOCKED_COMMERCIAL");
    expect(music.licence).toMatch(/CC-BY-NC/i);
    expect(music.commercialOutput).toBe("denied");
  });

  it("cannot run for a customer", () => {
    expect(isRunnableFor("replicate/music", "public")).toBe(false);
  });

  it("cannot run for the owner either", () => {
    /**
     * The assertion that separates a licence restriction from an access
     * rule. Owner evaluation is a real carve-out and it does not reach here:
     * a company testing its own paid feature is commercial use, so `NC`
     * forbids it whoever presses the button.
     */
    expect(isRunnableFor("replicate/music", "owner")).toBe(false);
    expect(music.permittedAudience).toBe("nobody");
  });

  it("appears in no catalogue at all", () => {
    expect(isPubliclyOffered("replicate/music")).toBe(false);
    expect(isOfferedToOwner("replicate/music")).toBe(false);
  });

  it("is refused when a client sends its public id", () => {
    // "score" still resolves — history has to keep rendering — but what it
    // resolves to runs for nobody, so the round trip is closed.
    expect(catalogueModelId("score")).toBe("replicate/music");
    expect(isRunnableFor(catalogueModelId("score")!, "owner")).toBe(false);
  });

  it("is refused when a client sends the internal provider id", () => {
    expect(catalogueModelId("replicate/music")).toBeNull();
    expect(isRunnableFor("replicate/music", "public")).toBe(false);
  });

  it("is absent from the catalogue a browser receives", () => {
    const offered = listModels()
      .filter((model) => isPubliclyOffered(model.id))
      .map((model) => model.id);

    expect(offered).not.toContain("replicate/music");
  });
});

describe("models the owner may evaluate but nobody may buy", () => {
  const evaluation = MODEL_POLICIES.filter(
    (policy) => policy.status === "OWNER_EVALUATION_ONLY_PENDING_TERMS",
  );

  it("covers the three proprietary hosted video models", () => {
    expect(evaluation.map((p) => p.modelId).sort()).toEqual([
      "replicate/veo-3.1",
      "replicate/veo-3.1-fast",
      "replicate/video-pro",
    ]);
  });

  it("runs for the owner", () => {
    /**
     * The correction to the first pass, asserted directly. These were off for
     * everybody on the reasoning that their endpoints publish no open-source
     * licence — which they never would, being proprietary APIs that were
     * never distributed as weights.
     */
    for (const policy of evaluation) {
      expect(isRunnableFor(policy.modelId, "owner"), policy.modelId).toBe(true);
    }
  });

  it("does not run for a customer", () => {
    for (const policy of evaluation) {
      expect(isRunnableFor(policy.modelId, "public"), policy.modelId).toBe(
        false,
      );
    }
  });

  it("is never listed publicly, which is what would make it an offer", () => {
    for (const policy of evaluation) {
      expect(isPubliclyOffered(policy.modelId), policy.modelId).toBe(false);
      expect(isOfferedToOwner(policy.modelId), policy.modelId).toBe(true);
    }
  });

  it("records that the output rights are evaluation-scoped, not sold", () => {
    for (const policy of evaluation) {
      expect(policy.commercialOutput, policy.modelId).toBe(
        "permitted-for-owner-evaluation",
      );
    }
  });

  it("keeps the watermark obligation on both Veo models", () => {
    /**
     * SynthID and the C2PA manifest are how a viewer can tell a clip is
     * synthetic. The obligation is not contingent on the reseller question
     * being settled, so it is recorded now rather than when the terms land.
     */
    for (const id of ["replicate/veo-3.1", "replicate/veo-3.1-fast"]) {
      expect(policyFor(id)!.attribution, id).toMatch(/SynthID/);
      expect(policyFor(id)!.attribution, id).toMatch(/content credentials/i);
    }
  });
});

describe("Motion 1, which is public because the grant follows the model", () => {
  const motion = policyFor("replicate/video-gen")!;

  it("is available to ordinary customers", () => {
    expect(motion.status).toBe("ALLOWED_PUBLIC");
    expect(isRunnableFor("replicate/video-gen", "public")).toBe(true);
    expect(isPubliclyOffered("replicate/video-gen")).toBe(true);
  });

  it("cites the upstream Apache-2.0 release rather than the endpoint", () => {
    // The endpoint publishes nothing; the weights do, and that is what the
    // permission rests on.
    expect(motion.licence).toMatch(/Apache-2\.0/);
    expect(motion.evidenceUrls).toContain(
      "https://github.com/Wan-Video/Wan2.2",
    );
  });
});

describe("FLUX.1 [dev], allowed but pinned to one endpoint", () => {
  const flux = policyFor("replicate/flux-dev")!;

  it("is public, and scoped to the approved provider", () => {
    expect(flux.status).toBe("ALLOWED_PROVIDER_ENDPOINT_ONLY");
    expect(isPubliclyOffered("replicate/flux-dev")).toBe(true);
    expect(flux.permittedProvider).toBe("replicate");
    expect(flux.hostedEndpoint).toBe("replicate:black-forest-labs/flux-dev");
  });

  it("records that the weights themselves stay non-commercial", () => {
    /**
     * The distinction the status name carries. Commercial output use is
     * granted through this endpoint; the downloadable weights are not
     * licensed for it, so the approval must not travel to a self-hosted copy.
     */
    expect(flux.licence).toMatch(/non-commercial/i);
    expect(flux.notes).toMatch(/self-hosting|another provider/i);
  });
});

describe("the registry fails closed", () => {
  it("refuses a catalogue model with no policy, for either caller", () => {
    expect(isRunnableFor("replicate/not-audited-yet", "public")).toBe(false);
    expect(isRunnableFor("replicate/not-audited-yet", "owner")).toBe(false);
  });

  it("refuses an empty or malformed id rather than throwing", () => {
    expect(isRunnableFor("", "owner")).toBe(false);
    expect(isRunnableFor("../../etc/passwd", "owner")).toBe(false);
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

  it("never lets owner-evaluation widen past its own status", () => {
    /**
     * The one way this design could rot: `caller === "owner"` leaking into a
     * branch it does not belong in. Asserted as a property over the whole
     * table rather than per model, so a new entry is covered automatically.
     */
    for (const policy of MODEL_POLICIES) {
      const ownerMayRun = isRunnableFor(policy.modelId, "owner");
      const publicMayRun = isRunnableFor(policy.modelId, "public");

      if (policy.status === "BLOCKED_COMMERCIAL") {
        expect(ownerMayRun, policy.modelId).toBe(false);
      }
      if (policy.status === "REVIEW_REQUIRED") {
        expect(ownerMayRun, policy.modelId).toBe(false);
      }
      // The owner is never *less* able than the public.
      if (publicMayRun) expect(ownerMayRun, policy.modelId).toBe(true);
    }
  });
});

describe("every recorded status is auditable", () => {
  it("fills in every required field", () => {
    for (const policy of MODEL_POLICIES) {
      for (const field of REQUIRED_FIELDS) {
        expect(
          String(policy[field]).trim(),
          `${policy.modelId}.${field}`,
        ).not.toBe("");
      }
    }
  });

  it("cites at least one source that can be re-read", () => {
    for (const policy of MODEL_POLICIES) {
      expect(policy.evidenceUrls.length, policy.modelId).toBeGreaterThan(0);
      for (const url of policy.evidenceUrls) {
        expect(url, policy.modelId).toMatch(/^https:\/\//);
      }
      expect(policy.verifiedOn, policy.modelId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("keeps audience and status consistent", () => {
    // The pair is what enforcement reads. A mismatch would be a silent hole.
    const expected: Record<string, string> = {
      ALLOWED_PUBLIC: "public",
      ALLOWED_PROVIDER_ENDPOINT_ONLY: "public",
      OWNER_EVALUATION_ONLY_PENDING_TERMS: "owner",
      BLOCKED_COMMERCIAL: "nobody",
      REVIEW_REQUIRED: "nobody",
    };

    for (const policy of MODEL_POLICIES) {
      expect(policy.permittedAudience, policy.modelId).toBe(
        expected[policy.status],
      );
    }
  });

  it("names no provider for a model nobody may run", () => {
    for (const policy of MODEL_POLICIES) {
      if (policy.permittedAudience !== "nobody") continue;
      expect(policy.permittedProvider, policy.modelId).toBe("none");
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
     * what our contract with them says. Neither is theirs to know — and the
     * same message covers an owner-evaluation model, so it cannot hint that
     * one exists.
     */
    expect(MODEL_UNAVAILABLE_MESSAGE).not.toMatch(VENDORS);
    expect(MODEL_UNAVAILABLE_MESSAGE).not.toMatch(/licen[cs]e|commercial/i);
    expect(MODEL_UNAVAILABLE_CODE).not.toMatch(VENDORS);
  });
});

describe("the hand-copied public ids stay in step", () => {
  it("matches every key in the studio's sequence facts map", async () => {
    /**
     * `services/ai/sequence-models.ts` keys its facts by public id written as
     * string literals, because it is imported by client components and the
     * mapping helper is server-only. A duplicated constant is a constant that
     * drifts — and the last time these two disagreed, every sequence quote in
     * the studio silently fell back to a flat credit label.
     *
     * So the duplication is allowed and pinned here.
     */
    const { SEQUENCE_MODEL_FACTS } =
      await import("@/services/ai/sequence-models");

    for (const [publicId, facts] of Object.entries(SEQUENCE_MODEL_FACTS)) {
      expect(catalogueModelId(publicId), publicId).toBe(facts.id);
    }
  });
});
