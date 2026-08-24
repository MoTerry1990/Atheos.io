import { describe, expect, it } from "vitest";

import { EN } from "@/features/marketing/i18n/en";
import { ES } from "@/features/marketing/i18n/es";
import {
  publicModelBySlug,
  publicModels,
  slugFor,
} from "@/features/marketing/lib/public-models";
import { AUDIO_CAPABILITIES } from "@/services/ai/audio-strategy";
import { listModels } from "@/services/ai/registry";
import { isModelEnabled } from "@/services/billing/model-costs";

/**
 * What the public site is allowed to claim.
 *
 * ## Why these are not "marketing tests"
 *
 * Every assertion here is about a promise that costs money when it is wrong. A
 * model advertised but not selectable is a visitor who signs up for something
 * that does not exist. A silent model described as having sound is the exact
 * defect the audio audit found in production: the delivered clip had no audio
 * stream and nothing in the product had ever been in a position to notice.
 *
 * The marketing surface derives its facts from the catalogue precisely so these
 * can be checked mechanically rather than by reading the page.
 */

describe("3. only models that actually exist are published", () => {
  it("publishes nothing the registry does not resolve", () => {
    const registry = new Set(listModels().map((m) => m.id));
    for (const model of publicModels()) {
      expect(registry.has(model.id)).toBe(true);
    }
  });

  it("publishes nothing the cost table has disabled", () => {
    // An unpriced or loss-making model cannot be sold, so it cannot be
    // advertised either.
    for (const model of publicModels()) {
      expect(isModelEnabled(model.id)).toBe(true);
    }
  });

  it("18. never publishes a flag-disabled model", () => {
    /**
     * `nano-banana-2` and `nano-banana-pro` are `enabled: true` in the cost
     * table and absent from the registry while `ENABLE_SMART_IMAGE` is off.
     * Publishing them would advertise something no visitor can select — the
     * two gates disagree, and both have to pass.
     */
    const published = publicModels().map((m) => m.id);
    expect(published).not.toContain("replicate/nano-banana-2");
    expect(published).not.toContain("replicate/nano-banana-pro");
  });

  it("never publishes a mock model", () => {
    // Mocks exist so the pipeline runs without provider credentials. They are
    // not a product.
    for (const model of publicModels()) {
      expect(model.id.startsWith("mock/")).toBe(false);
    }
  });

  it("has a page for every published model and none for the rest", () => {
    for (const model of publicModels()) {
      expect(publicModelBySlug(model.slug)?.id).toBe(model.id);
    }
    expect(publicModelBySlug("nano-banana-2")).toBeNull();
    expect(publicModelBySlug("definitely-not-a-model")).toBeNull();
  });
});

describe("4. published facts match the catalogue", () => {
  it("quotes the registry's credit cost, not a written-down one", () => {
    const registry = new Map(listModels().map((m) => [m.id, m]));
    for (const model of publicModels()) {
      expect(model.credits).toBe(registry.get(model.id)!.creditCost);
    }
  });

  it("names the model the way the registry names it", () => {
    const registry = new Map(listModels().map((m) => [m.id, m]));
    for (const model of publicModels()) {
      expect(model.name).toBe(registry.get(model.id)!.displayName);
    }
  });

  it("reports reference support from the model's own capabilities", () => {
    const registry = new Map(listModels().map((m) => [m.id, m]));
    for (const model of publicModels()) {
      expect(model.supportsReferenceImage).toBe(
        registry.get(model.id)!.capabilities.supportsImageInput,
      );
    }
  });

  it("14. never leaks a provider slug into a public name or URL", () => {
    // "wan-2.2-t2v-fast" is an implementation detail; "Motion 1" is the
    // product. A provider name on a public page is a promise about a vendor.
    for (const model of publicModels()) {
      expect(model.name).not.toMatch(/wan-|seedance|flux-|bytedance|veo-/i);
      expect(model.slug).not.toContain("/");
    }
  });
});

describe("6. a silent model never claims sound", () => {
  it("marks Motion 1 and Motion Pro as Atheos-added, not native", () => {
    /**
     * The audited defect, as a test. Both are `wan-2.2-t2v-fast` and
     * `seedance-1-lite`, whose schemas have no audio output at all. The public
     * page must say Atheos adds the sound afterwards.
     */
    for (const id of ["replicate/video-gen", "replicate/video-pro"]) {
      const model = publicModels().find((m) => m.id === id);
      if (!model) continue; // not published in this configuration
      expect(model.audio).toBe("atheos");
      expect(model.audio).not.toBe("native");
    }
  });

  it("only claims native sound where the capability table says so", () => {
    for (const model of publicModels()) {
      if (model.audio !== "native" || model.modality !== "VIDEO") continue;
      expect(AUDIO_CAPABILITIES[model.id]?.strategies).toContain("NATIVE");
    }
  });

  it("states a limitation for every published model", () => {
    // A model with nothing it cannot do has not been described honestly.
    for (const model of publicModels()) {
      expect(model.limitation.length).toBeGreaterThan(20);
    }
  });
});

describe("7. resolution and duration are never overstated", () => {
  it("quotes a maximum duration only where the model declares one", () => {
    const registry = new Map(listModels().map((m) => [m.id, m]));
    for (const model of publicModels()) {
      const declared =
        registry.get(model.id)!.capabilities.maxDurationSeconds ?? null;
      expect(model.maxDurationSeconds).toBe(declared);
    }
  });

  it("offers no estimated time it has not measured", () => {
    // Null rather than a guess. A wait time invented for a marketing page is
    // a promise nobody made.
    for (const model of publicModels()) {
      expect(
        model.estimatedSeconds === null || model.estimatedSeconds > 0,
      ).toBe(true);
    }
  });
});

describe("1-2. navigation goes somewhere real", () => {
  const ROUTES = new Set([
    "/studio",
    "/models",
    "/explore",
    "/pricing",
    "/sign-in",
    "/sign-up",
  ]);

  for (const [name, copy] of [
    ["en", EN],
    ["es", ES],
  ] as const) {
    it(`${name} nav has no dead destinations`, () => {
      for (const link of copy.nav) {
        expect(ROUTES.has(link.href)).toBe(true);
      }
    });

    it(`${name} nav is the four agreed items`, () => {
      expect(copy.nav.map((l) => l.href)).toEqual([
        "/studio",
        "/models",
        "/explore",
        "/pricing",
      ]);
    });

    it(`17. ${name} nav does not advertise the Marketplace`, () => {
      /**
       * `/marketplace` is behind authentication and has no public feature
       * flag. A public nav item pointing at it sends a signed-out visitor to a
       * sign-in wall for a feature that is not being launched.
       */
      for (const link of copy.nav) {
        expect(link.href).not.toContain("marketplace");
      }
    });
  }
});

describe("slugs are stable and reversible", () => {
  it("drops the provider prefix and nothing else", () => {
    expect(slugFor("replicate/video-pro")).toBe("video-pro");
    expect(slugFor("openai/gpt-image-1")).toBe("gpt-image-1");
  });

  it("produces a unique slug per published model", () => {
    const slugs = publicModels().map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
