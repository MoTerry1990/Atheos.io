import { describe, expect, it } from "vitest";

import { COMPOSER_MODALITIES } from "@/features/marketing/content";
import { listModels } from "@/services/ai/registry";

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

  it("uses non-empty, namespaced model ids", () => {
    for (const modality of COMPOSER_MODALITIES) {
      for (const model of modality.models) {
        expect(model.id).toMatch(/^[a-z]+\/[a-z0-9-]+$/);
        expect(model.label.trim()).not.toBe("");
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
        expect(known, `${model.id} is not in the registry`).toContain(model.id);
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
