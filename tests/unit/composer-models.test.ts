import { describe, expect, it } from "vitest";

import { COMPOSER_MODALITIES } from "@/features/marketing/content";
import { listModels } from "@/services/ai/registry";
import { catalogueModelId } from "@/services/ai/public-ids";

/**
 * The homepage composer's model list is a hand-written mirror of the registry.
 *
 * It has to be: the registry reads server environment variables and the
 * composer is a client component on a statically rendered page. A copy that
 * nothing checks is a copy that goes stale, and the failure would be quiet —
 * the studio simply would not select the model the homepage promised, and the
 * user would generate on whatever the default happens to be.
 *
 * The registry falls back to an explicitly-labelled mock provider when no
 * provider keys are configured, which is the case under test. So this asserts
 * the *shape* — every advertised modality has at least one model, and no id is
 * empty — and, where the real Replicate models are present, that each
 * advertised id actually exists.
 *
 * ## Public ids, since the leak fix
 *
 * These used to be catalogue paths, which put `replicate/flux-schnell` into
 * the rendered HTML twice — as an `<option value>` and inside the sign-up
 * `redirect_url`. They are public ids now, so the assertions below resolve
 * through `catalogueModelId` before comparing against the registry.
 *
 * That also fixed a silent bug: the studio validates the seeded model against
 * the list it loads from `/api/generations`, which has carried public ids
 * since the contract landed. A catalogue id never matched, so every composer
 * link fell back to "any model of this modality".
 */
describe("composer model list", () => {
  const known = new Set(listModels().map((model) => model.id));

  it("offers at least one model per advertised modality", () => {
    for (const modality of COMPOSER_MODALITIES) {
      expect(
        modality.models.length,
        `${modality.id} advertises no model`,
      ).toBeGreaterThan(0);
    }
  });

  it("uses public ids, never a catalogue path", () => {
    for (const modality of COMPOSER_MODALITIES) {
      for (const model of modality.models) {
        // A slug, not `provider/model`. The slash is the leak.
        expect(model.id).toMatch(/^[a-z0-9-]+$/);
        expect(model.id).not.toContain("/");
        expect(model.label.trim()).not.toBe("");
      }
    }
  });

  it("names no vendor in a label either", () => {
    /**
     * The ids were only half of it. "Flux Fast" identifies Black Forest Labs'
     * model family as precisely as the path did, to anyone who would think to
     * look it up.
     */
    for (const modality of COMPOSER_MODALITIES) {
      for (const model of modality.models) {
        expect(model.label).not.toMatch(
          /flux|veo|wan|seedance|musicgen|replicate|bytedance/i,
        );
      }
    }
  });

  it("resolves every advertised id back to a real model", () => {
    for (const modality of COMPOSER_MODALITIES) {
      for (const model of modality.models) {
        expect(
          catalogueModelId(model.id),
          `${model.id} maps to no catalogue model`,
        ).not.toBeNull();
      }
    }
  });

  it("names only models the registry knows, when it is configured", () => {
    // Skipped against the mock provider — it exposes its own ids, and failing
    // here would only be reporting that no API token is set in CI.
    const configured = [...known].some((id) => id.startsWith("replicate/"));
    if (!configured) return;

    for (const modality of COMPOSER_MODALITIES) {
      for (const model of modality.models) {
        const catalogueId = catalogueModelId(model.id);
        expect(known, `${model.id} is not in the registry`).toContain(
          catalogueId,
        );
      }
    }
  });

  it("gives audio no aspect ratio and everything else at least one", () => {
    for (const modality of COMPOSER_MODALITIES) {
      if (modality.id === "audio") {
        expect(modality.aspectRatios).toHaveLength(0);
      } else {
        expect(modality.aspectRatios.length).toBeGreaterThan(0);
      }
    }
  });
});
