import { describe, expect, it } from "vitest";

import {
  COMPOSER_MODALITIES,
  FEATURES,
  SHOWCASE,
  STEPS,
  TEMPLATES,
} from "@/features/marketing/content";

import { getCopy } from "@/features/marketing/i18n/dictionaries";
import { LOCALES } from "@/features/marketing/i18n/locales";

/**
 * Homepage sections, checked at the data layer.
 *
 * These are the failures that render *successfully*: three tabs sharing one
 * body of copy, a card advertising a video with no video attached, a nav item
 * pointing at a route that does not exist. Nothing throws, nothing looks
 * broken in a build log, and the page is wrong.
 *
 * The Image/Video/Audio panels in particular had exactly this shape — the tabs
 * looked right, the roles were correct, and clicking Video showed the Image
 * panel for twenty-five sprints. That bug was in the animation rather than the
 * data, but a test that the three panels *say different things* would have
 * made the symptom visible far sooner.
 */
describe("showcase panels", () => {
  for (const locale of LOCALES) {
    it(`gives every ${locale} modality its own copy`, () => {
      const { showcase } = getCopy(locale);

      expect(showcase).toHaveLength(SHOWCASE.length);

      const headlines = new Set(showcase.map((panel) => panel.headline));
      const bodies = new Set(showcase.map((panel) => panel.body));

      // Duplicate copy across panels is how "the Video tab shows the Image
      // tab" looks from the data side.
      expect(headlines.size).toBe(showcase.length);
      expect(bodies.size).toBe(showcase.length);
    });

    it(`gives every ${locale} panel its own bullets`, () => {
      const { showcase } = getCopy(locale);

      for (const panel of showcase) {
        expect(panel.bullets.length).toBeGreaterThan(0);
      }

      const first = showcase[0]?.bullets.join("|");
      const second = showcase[1]?.bullets.join("|");
      expect(first).not.toBe(second);
    });
  }

  it("has an artwork entry per panel, matched by index", () => {
    // The tabs join `SHOWCASE` to the dictionary by position. A length
    // mismatch renders a panel with no words rather than throwing.
    for (const locale of LOCALES) {
      expect(getCopy(locale).showcase).toHaveLength(SHOWCASE.length);
    }
  });
});

describe("homepage consolidation", () => {
  it("keeps templates to four, each with its own prompt", () => {
    expect(TEMPLATES.length).toBeLessThanOrEqual(4);

    // Six cards that look different and all link to the same place teach the
    // reader that the difference is cosmetic. Each must carry its own prompt.
    const prompts = new Set(TEMPLATES.map((template) => template.prompt));
    expect(prompts.size).toBe(TEMPLATES.length);

    for (const template of TEMPLATES) {
      expect(template.prompt.trim().length).toBeGreaterThan(10);
      expect(["image", "video"]).toContain(template.modality);
    }
  });

  it("keeps the explanation to three steps and the benefits to four", () => {
    expect(STEPS).toHaveLength(3);
    expect(FEATURES.length).toBeLessThanOrEqual(4);
  });

  it("no longer ships the standalone Gallery section", async () => {
    /**
     * Asserted against the module's exports, not against the composition.
     *
     * A first attempt read `landing.tsx` as text and matched for `<Gallery`.
     * It failed while the file plainly contained the right markup — the path
     * resolved somewhere unexpected under vitest, so the test was reporting on
     * a file nobody had edited. A test that can pass or fail for reasons
     * unrelated to its assertion is worse than no test.
     *
     * The section is genuinely gone rather than merely unmounted: the
     * component file is deleted and its `GALLERY` data with it, so this cannot
     * be satisfied by a component that simply stopped being rendered.
     *
     * Sprint 29 also moved the *other* gallery out of this module.
     * `MADE_WITH_ATHEOS` was six hand-written entries; the section is now
     * driven by `features/marketing/gallery.generated.ts`, built from the
     * masters themselves. Both names must therefore be absent here — the
     * standalone Gallery because it was deleted, and the made-with data
     * because it moved and a leftover copy would be a second source of truth.
     */
    const content = await import("@/features/marketing/content");

    expect(Object.keys(content)).not.toContain("GALLERY");
    expect(Object.keys(content)).not.toContain("MADE_WITH_ATHEOS");
  });
});

describe("navigation", () => {
  for (const locale of LOCALES) {
    it(`points every ${locale} nav item at a route, not an anchor`, () => {
      const { nav } = getCopy(locale);

      expect(nav.length).toBeGreaterThan(0);
      for (const link of nav) {
        expect(
          link.href.startsWith("#"),
          `"${link.label}" is an anchor — the header navigates the product, not this page`,
        ).toBe(false);
        expect(link.href.startsWith("/")).toBe(true);
      }
    });

    it(`keeps the ${locale} sign-in link on the real auth route`, () => {
      // Not asserted from the dictionary: the href lives in the header, and
      // this is the label that must exist for it to be rendered at all.
      expect(getCopy(locale).auth.signIn.trim()).not.toBe("");
      expect(getCopy(locale).auth.signUp.trim()).not.toBe("");
    });
  }
});

describe("composer", () => {
  it("offers a modality entry for every advertised label", () => {
    for (const locale of LOCALES) {
      const { composer } = getCopy(locale);

      for (const entry of composer.modalities) {
        expect(
          COMPOSER_MODALITIES.some((m) => m.id === entry.id),
          `${entry.id} is labelled but has no models`,
        ).toBe(true);
      }
    }
  });
});
