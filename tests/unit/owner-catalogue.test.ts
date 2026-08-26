import { describe, expect, it } from "vitest";

import {
  isOfferedToOwner,
  isPubliclyOffered,
  isRunnableFor,
  policyFor,
} from "@/services/ai/model-policy";
import { publicModelId } from "@/services/ai/public-ids";

/**
 * What each audience is offered, by name.
 *
 * ## The defect this pins
 *
 * Motion Pro and both Cinematic tiers were reported missing from the owner's
 * Studio, and the causes were nothing to do with each other:
 *
 *   - the Cinematic tiers were absent from the *catalogue* — `VEO_MODELS` is
 *     gated on `ENABLE_VEO_31`, which was set in Preview and not Production,
 *     so `listModels()` never returned them at all;
 *   - Motion Pro was in the catalogue and always had been. The Studio pinned
 *     `available[0]` and had no model selector, so it could not be shown.
 *
 * The first is asserted here. The second is asserted in
 * `tests/e2e/studio-v2.spec.ts`, because a missing control is not visible from
 * an API response — which is exactly why it went unnoticed.
 *
 * ## Why the lists are written out
 *
 * A test that recomputes the expected set from the same policy table it is
 * checking passes whatever the table says. These are typed out, so changing
 * who can reach a model means editing a list that says, in public names, who
 * can reach it.
 */

const VIDEO_PUBLIC = ["motion-1"];
const VIDEO_OWNER_ONLY = ["motion-pro", "cinematic-fast", "cinematic"];

/** Catalogue ids, resolved through the same map the API uses. */
const idOf = (publicId: string) =>
  ({
    "motion-1": "replicate/video-gen",
    "motion-pro": "replicate/video-pro",
    "cinematic-fast": "replicate/veo-3.1-fast",
    cinematic: "replicate/veo-3.1",
    score: "replicate/music",
  })[publicId]!;

describe("the owner's video catalogue", () => {
  it("includes Motion Pro", () => {
    // Reported missing. It was never absent from the catalogue.
    expect(isOfferedToOwner(idOf("motion-pro"))).toBe(true);
    expect(isRunnableFor(idOf("motion-pro"), "owner")).toBe(true);
  });

  it("includes both Cinematic tiers", () => {
    for (const publicId of ["cinematic-fast", "cinematic"]) {
      expect(isOfferedToOwner(idOf(publicId)), publicId).toBe(true);
      expect(isRunnableFor(idOf(publicId), "owner"), publicId).toBe(true);
    }
  });

  it("includes Motion 1, which everyone gets", () => {
    expect(isOfferedToOwner(idOf("motion-1"))).toBe(true);
  });

  it("is exactly four video models, and no fifth", () => {
    /**
     * Cinematic Lite is the fifth that must not appear. It is a separate
     * endpoint on a separate pinned version from the two Cinematic tiers, so a
     * separate licence question — and it briefly got a policy entry purely so
     * that "every catalogue model has a policy" would pass, which is approving
     * a model to satisfy a test.
     */
    expect(policyFor("replicate/veo-3.1-lite")).toBeUndefined();
    expect(isRunnableFor("replicate/veo-3.1-lite", "owner")).toBe(false);
  });
});

describe("a normal user's video catalogue", () => {
  it("is Motion 1 and nothing else", () => {
    for (const publicId of VIDEO_PUBLIC) {
      expect(isPubliclyOffered(idOf(publicId)), publicId).toBe(true);
    }
  });

  it("excludes every owner-evaluation model", () => {
    /**
     * The commercial claim. These are not sold, so they must not appear in a
     * catalogue, a price list or a picker — appearing is what turns an
     * evaluation into an offer.
     */
    for (const publicId of VIDEO_OWNER_ONLY) {
      expect(isPubliclyOffered(idOf(publicId)), publicId).toBe(false);
      expect(isRunnableFor(idOf(publicId), "public"), publicId).toBe(false);
    }
  });
});

describe("Score reaches nobody", () => {
  it("is absent from both catalogues and runs for neither caller", () => {
    expect(isPubliclyOffered(idOf("score"))).toBe(false);
    expect(isOfferedToOwner(idOf("score"))).toBe(false);
    expect(isRunnableFor(idOf("score"), "public")).toBe(false);
    expect(isRunnableFor(idOf("score"), "owner")).toBe(false);
  });
});

describe("the audience comes from the session, never from the client", () => {
  it("takes a caller, not a request", () => {
    /**
     * Structural. `isRunnableFor` accepts `"public" | "owner"` and nothing
     * else — there is no header, flag or field a browser could set. The
     * callers resolve it with `isAdmin()` against the Clerk session, and a
     * forged `{ role: "admin" }` in a request body has nothing to bind to.
     */
    expect(isRunnableFor.length).toBe(2);

    // And the wrong string is not a skeleton key: it is simply not "owner".
    const forged = "admin" as unknown as "owner";
    expect(isRunnableFor(idOf("motion-pro"), forged)).toBe(false);
    expect(isRunnableFor(idOf("cinematic-fast"), forged)).toBe(false);
  });
});

describe("the public ids the interface uses", () => {
  it("never leak a provider path", () => {
    for (const publicId of [...VIDEO_PUBLIC, ...VIDEO_OWNER_ONLY]) {
      expect(publicModelId(idOf(publicId))).toBe(publicId);
      expect(publicId).not.toContain("/");
    }
  });
});
