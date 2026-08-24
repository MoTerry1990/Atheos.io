import { describe, expect, it } from "vitest";

import { EN } from "@/features/marketing/i18n/en";
import { ES } from "@/features/marketing/i18n/es";
import { LOCALES, ROUTES, localise } from "@/features/marketing/i18n/locales";
import {
  FEATURES,
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
      // Exact, since Sprint 4.1: four values in the enum, four entries here.
      expect(Object.keys(copy.plans).sort()).toEqual(
        PRICING.map((tier) => tier.tier).sort(),
      );
    },
  );

  it.each(Object.entries(DICTIONARIES))(
    "%s calls each plan what the catalogue calls it",
    (locale, copy) => {
      /**
       * The check that was missing, and what it cost.
       *
       * The pricing card renders `plans[tier].name` from the dictionary, not
       * `PLAN_DEFINITIONS[].name` from the catalogue. Sprint 4 renamed the
       * catalogue to Free / Creator / Pro / Studio and left the dictionary
       * alone, so the live page went on advertising an **Agency** plan — with
       * the old feature list and a "20,000 credits a month" claim — under the
       * new $89.99 price. Every test passed. Nothing threw.
       *
       * Two sources for one customer-facing string will diverge. English is
       * pinned exactly; Spanish only has to be non-empty, because "Gratis" is
       * the correct translation of "Free" and demanding equality would forbid
       * translating at all.
       */
      for (const plan of PLAN_DEFINITIONS) {
        const name = copy.plans[plan.tier].name;

        if (locale === "en") {
          expect(name, `${plan.tier} is "${name}" in copy`).toBe(plan.name);
        } else {
          expect(name.trim().length).toBeGreaterThan(0);
        }

        // No plan may be named after one that no longer exists, in either
        // language. "Agency" and "Starter" are both retired.
        expect(name).not.toMatch(/agency/i);
      }
    },
  );

  it.each(Object.entries(DICTIONARIES))(
    "%s promises no credit allowance the backend has not settled",
    (_locale, copy) => {
      // A feature bullet is as much a promise as the credit line on the card,
      // and it is not covered by the `credits: null` guard. Paid plans have no
      // settled allowance yet, so no bullet on one may quote a number of
      // credits.
      for (const plan of PLAN_DEFINITIONS) {
        if (plan.monthlyCredits !== null) continue;

        for (const feature of copy.plans[plan.tier].features) {
          expect(
            feature,
            `${plan.tier} advertises credits it cannot honour`,
          ).not.toMatch(/\bcr[eé]dit/i);
        }
      }
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
      ES.plans.STUDIO.description === EN.plans.STUDIO.description &&
        "plans.STUDIO.description",
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

  it("resolves a Spanish path by lookup, not by prefixing", () => {
    /**
     * This test previously asserted `/es/pricing`, which **404s**. The Spanish
     * pricing page is at `/es/precios` — the paths are translated too — so the
     * test was pinning the bug rather than the behaviour.
     *
     * `localise` prefixed anything that was not an anchor or an absolute URL,
     * which produced nine dead links on every Spanish page: four in the header
     * and five in the footer. It is a `ROUTES` lookup now.
     */
    expect(localise("/pricing", "en")).toBe("/pricing");
    expect(localise("/pricing", "es")).toBe("/es/precios");
    expect(localise("/", "es")).toBe("/es");
  });

  it("returns English-only routes unchanged rather than inventing a twin", () => {
    // The studio, explore, the marketplace and the legal pages have no Spanish
    // version. Prefixing them produced a 404; returning them sends the reader
    // to a working page in the wrong language, which is the better failure.
    for (const href of [
      "/studio",
      "/explore",
      "/marketplace",
      "/privacy",
      "/terms",
      "/acceptable-use",
      "/connect",
    ]) {
      expect(localise(href, "es")).toBe(href);
    }
  });

  it("never sends a nav or footer link somewhere that does not exist", () => {
    /**
     * The check that would have caught it. Every link either has a `ROUTES`
     * twin, or is returned unchanged — and in no case does a `/es/...` path
     * appear that is not one of the two real Spanish routes.
     */
    const real = new Set<string>(
      Object.values(ROUTES).map((paths) => paths.es),
    );

    for (const [locale, copy] of Object.entries(DICTIONARIES)) {
      if (locale !== "es") continue;

      const links = [
        ...copy.nav.map((item) => item.href),
        ...copy.footer.groups.flatMap((group) =>
          group.links.map((link) => link.href),
        ),
      ];

      for (const href of links) {
        const resolved = localise(href, "es");
        if (resolved.startsWith("/es")) {
          expect(
            real.has(resolved),
            `${href} -> ${resolved} does not exist`,
          ).toBe(true);
        }
      }
    }
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
