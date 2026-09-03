import { describe, expect, it } from "vitest";

import { GALLERY } from "@/features/marketing/gallery.generated";
import { GALLERY_SOURCE_MODELS } from "@/services/marketing/gallery-provenance.generated";
import { SHOWCASE } from "@/features/marketing/content";
import { MODEL_POLICIES } from "@/services/ai/model-policy";
import {
  isPublishable,
  publicationVerdict,
  publishableModelIds,
  SHOWCASE_SOURCE_MODELS,
} from "@/services/marketing/publication-policy";

/**
 * Publication eligibility, enforced against the manifest rather than trusted.
 *
 * ## The incident this exists for
 *
 * Sprint 29 published 29 gallery cards. On audit, **25 of them** came from
 * models that were not approved for public commercial use:
 *
 *   - 18 images from `nano-banana-pro`, which has **no entry** in
 *     `model-policy.ts` at all.
 *   - 7 videos from `replicate/video-pro` and `replicate/veo-3.1-fast`, both
 *     `OWNER_EVALUATION_ONLY_PENDING_TERMS`.
 *
 * Nothing caught it, and the reason is worth stating plainly: the generation
 * path enforces the policy registry, and the marketing manifest never went near
 * the generation path. It was assembled from files on disk by a build script,
 * and a file on disk does not know what made it.
 *
 * The fix is that every manifest entry now records `sourceModel`, and this
 * suite refuses the build if any of them is not publishable. A forged entry
 * naming an invented model fails the same way, because a model the registry
 * does not recognise is not approved rather than not known.
 */

describe("the registry decides, and it fails closed", () => {
  it("refuses a model that is not in the registry at all", () => {
    /**
     * The exact hole. `nano-banana-pro` is a real, working, priced model that
     * simply had no policy row — and "no row" was silently read as "fine".
     */
    for (const missing of [
      "replicate/nano-banana-pro",
      "replicate/nano-banana-2",
    ]) {
      const verdict = publicationVerdict(missing);
      expect(verdict.publishable, missing).toBe(false);
      expect(verdict.status, missing).toBeNull();
      expect(verdict.reason).toContain("no entry");
    }
  });

  it("refuses owner-evaluation-only models", () => {
    // Evaluating a model privately is not permission to publish its output as
    // advertising, and the terms are by definition still pending.
    for (const owner of [
      "replicate/video-pro",
      "replicate/veo-3.1",
      "replicate/veo-3.1-fast",
      "google/omni-1.1-flash",
    ]) {
      expect(isPublishable(owner), owner).toBe(false);
    }
  });

  it("refuses a blocked model", () => {
    expect(isPublishable("replicate/music")).toBe(false);
  });

  it("refuses anything that is not a recognised id", () => {
    // A forged manifest entry names whatever it likes.
    for (const bad of [
      "",
      "   ",
      null,
      undefined,
      42,
      {},
      "replicate/made-up",
    ]) {
      expect(isPublishable(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("permits the two statuses that genuinely allow publication", () => {
    expect(isPublishable("replicate/video-gen")).toBe(true);
    expect(isPublishable("replicate/sfx")).toBe(true);
    // Non-commercial weights, commercial output through the hosted endpoint
    // the approval is scoped to — which is the endpoint publication uses.
    expect(isPublishable("replicate/flux-dev")).toBe(true);
    expect(isPublishable("replicate/flux-schnell")).toBe(true);
  });

  it("agrees with the registry it reads from", () => {
    // The allowlist is derived, never hand-maintained; a second hand-kept copy
    // is what drifts.
    for (const id of publishableModelIds()) {
      const policy = MODEL_POLICIES.find((entry) => entry.modelId === id)!;
      expect(policy.commercialOutput, id).toBe("permitted");
    }
  });
});

describe("nothing unpublishable is published", () => {
  it("every gallery card records the model that made it", () => {
    // A card with no recorded model cannot be checked, and an unchecked card
    // is how 25 of them shipped. The record is server-only: putting it in the
    // client manifest would ship provider identities to the browser, which is
    // the boundary `tests/unit/gallery.test.ts` guards.
    for (const item of GALLERY) {
      expect(GALLERY_SOURCE_MODELS[item.id], item.id).toBeTruthy();
    }
  });

  it("every gallery card comes from a publishable model", () => {
    for (const item of GALLERY) {
      const verdict = publicationVerdict(GALLERY_SOURCE_MODELS[item.id]);
      expect(verdict.publishable, `${item.id}: ${verdict.reason}`).toBe(true);
    }
  });

  it("carries none of the withdrawn cards", () => {
    /**
     * Named individually. The manifest is regenerated from
     * `media-source/gallery-selection.json`, so re-adding one is a single line
     * — and every other assertion here would stay green if the model were
     * still unapproved but the entry lied about it.
     */
    const ids = GALLERY.map((item) => item.id);
    for (const withdrawn of [
      "paint-ridges",
      "circuit-macro",
      "silver-hair",
      "camel-coat-walk",
      "ink-bloom",
      "vase-turntable",
      "grass-goldenhour",
      "four-shot-cut",
      "display-macro",
      "room-at-dusk",
      "hotel-corridor",
    ]) {
      expect(ids, withdrawn).not.toContain(withdrawn);
    }
  });

  it("keeps the showcase on publishable models too", () => {
    /**
     * The showcase is three hand-written entries rather than a generated
     * manifest, so it needs its own check. The Image tab previously served a
     * `nano-banana-pro` still — the same unapproved model as the gallery
     * images, on the most prominent surface on the page.
     */
    for (const tab of SHOWCASE) {
      const model = SHOWCASE_SOURCE_MODELS[tab.id];
      expect(model, `${tab.id} records no model`).toBeTruthy();
      const verdict = publicationVerdict(model);
      expect(verdict.publishable, `${tab.id}: ${verdict.reason}`).toBe(true);
    }
  });
});
