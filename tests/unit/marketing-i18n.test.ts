import { describe, expect, it } from "vitest";

import { EN } from "@/features/marketing/i18n/en";
import { ES } from "@/features/marketing/i18n/es";
import { LOCALES, ROUTES, localise } from "@/features/marketing/i18n/locales";
import {
  FEATURES,
  GALLERY,
  SHOWCASE,
  STEPS,
  TEMPLATES,
  PRICING,
} from "@/features/marketing/content";
import { COMPARISON_ROWS } from "@/features/marketing/plan-comparison-rows";
import { PLAN_DEFINITIONS } from "@/services/billing/catalogue";

/**
 * The failure this file exists to catch is **silent**.
 *
 * Copy is joined to artwork by array index, and to plans by tier key. A
 * dictionary that is one entry short does not throw — it renders a card with
 * an icon, a hue, and no words. Nobody reviewing the English page would see
 * it, because the English page is the one that is complete.
 */

const DICTIONARIES = { en: EN, es: ES } as const;

describe("marketing dictionaries", () => {
  it("covers every locale", () => {
    for (const locale of LOCALES) {
      expect(DICTIONARIES[locale]).toBeDefined();
    }
  });

  it.each(Object.entries(DICTIONARIES))(
    "%s lines up with the artwork arrays",
    (_locale, copy) => {
      expect(copy.showcase).toHaveLength(SHOWCASE.length);
      expect(copy.features).toHaveLength(FEATURES.length);
      expect(copy.steps).toHaveLength(STEPS.length);
      expect(copy.templates).toHaveLength(TEMPLATES.length);
      expect(copy.gallery).toHaveLength(GALLERY.length);
      expect(copy.comparison.rows).toHaveLength(COMPARISON_ROWS.length);
    },
  );

  it.each(Object.entries(DICTIONARIES))(
    "%s names every plan the catalogue sells",
    (_locale, copy) => {
      for (const plan of PLAN_DEFINITIONS) {
        const entry = copy.plans[plan.tier];
        expect(entry, `missing plan copy for ${plan.tier}`).toBeDefined();
        expect(entry.name.length).toBeGreaterThan(0);
        expect(entry.features.length).toBeGreaterThan(0);
      }
      // A card is rendered per PRICING row, so a stray tier would render blank.
      expect(Object.keys(copy.plans).sort()).toEqual(
        PRICING.map((tier) => tier.tier).sort(),
      );
    },
  );

  it("keeps the same structure across languages", () => {
    // Compares shape, not content: same keys, same nesting, same array
    // lengths, everywhere. A key added to English and forgotten in Spanish
    // renders `undefined` on the page rather than falling back.
    function shape(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(shape);
      if (typeof value === "function") return "fn";
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, inner]) => [key, shape(inner)]),
        );
      }
      return typeof value;
    }

    expect(shape(ES)).toEqual(shape(EN));
  });

  it("actually translates — Spanish is not a copy of English", () => {
    // Cheap guard against a dictionary created by duplicating the English file
    // and translating only the parts somebody happened to scroll past.
    const untranslated = [
      ES.hero.subheadline === EN.hero.subheadline && "hero.subheadline",
      ES.pricing.title === EN.pricing.title && "pricing.title",
      ES.faq[0]?.answer === EN.faq[0]?.answer && "faq[0].answer",
      ES.plans.AGENCY.description === EN.plans.AGENCY.description &&
        "plans.AGENCY.description",
    ].filter(Boolean);

    expect(untranslated).toEqual([]);
  });

  it("does not restate a price in the copy", () => {
    // Prices come from the catalogue. A dollar figure written into a sentence
    // is one that will disagree with the checkout after the next price change,
    // and it will disagree in one language first.
    const text = JSON.stringify(ES) + JSON.stringify(EN);
    expect(text).not.toMatch(/\$\d/);
  });
});

describe("locale routing", () => {
  it("gives every route a path in every language", () => {
    for (const paths of Object.values(ROUTES)) {
      for (const locale of LOCALES) {
        expect(paths[locale]).toMatch(/^\//);
      }
    }
  });

  it("prefixes Spanish paths and leaves English alone", () => {
    expect(localise("/pricing", "en")).toBe("/pricing");
    expect(localise("/pricing", "es")).toBe("/es/pricing");
    expect(localise("/", "es")).toBe("/es");
  });

  it("never prefixes an anchor or an external link", () => {
    // Marketing navigation is mostly `#pricing`. Turning that into
    // `/es#pricing` forces a navigation to reach a section already on screen.
    expect(localise("#pricing", "es")).toBe("#pricing");
    expect(localise("https://example.com", "es")).toBe("https://example.com");
    expect(localise("mailto:hello@atheos.io", "es")).toBe(
      "mailto:hello@atheos.io",
    );
  });

  it("localises the pricing path, not just the prefix", () => {
    // `/es/pricing` would still rank for the English word, which is not the
    // query the Spanish page is for.
    expect(ROUTES.pricing.es).toBe("/es/precios");
  });
});
