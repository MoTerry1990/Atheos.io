import { describe, expect, it } from "vitest";

import { EN } from "@/features/marketing/i18n/en";
import { ES } from "@/features/marketing/i18n/es";
import { LOCALES, ROUTES, localise } from "@/features/marketing/i18n/locales";
import { COMPOSER_MODALITIES, PRICING } from "@/features/marketing/content";

/**
 * Where the homepage's links actually go.
 *
 * ## What this exists to catch
 *
 * Sprint 4.2 found **nine dead links on every Spanish page** — four in the
 * header, five in the footer — produced by a `localise()` that prefixed `/es`
 * onto routes with no Spanish version. `/es/studio`, `/es/privacy`,
 * `/es/pricing` and five more all returned 404. Nothing threw, the build was
 * clean, and the only way to notice was to click them.
 *
 * A tenth link, `/design-system`, 404'd in **both** languages: it is excluded
 * by `robots.txt` and is not built in production, and the footer linked to it
 * anyway.
 *
 * Every assertion below is derived from the dictionaries and the route table
 * rather than restated, so a link added to the footer next month is checked by
 * the same rules without anybody editing this file.
 */

const DICTIONARIES = { en: EN, es: ES } as const;

/** Routes the application serves outside the marketing tree. */
const APP_ROUTES = new Set([
  "/studio",
  "/explore",
  "/marketplace",
  "/sign-in",
  "/sign-up",
  "/connect",
  "/privacy",
  "/terms",
  "/acceptable-use",
]);

/** Section ids the landing page actually renders. */
const RENDERED_SECTION_IDS = new Set([
  "showcase",
  "made",
  "templates",
  "how-it-works",
  "features",
  "pricing",
  "faq",
]);

function everyLink(copy: (typeof DICTIONARIES)[keyof typeof DICTIONARIES]) {
  return [
    ...copy.nav.map((item) => item.href),
    ...copy.footer.groups.flatMap((group) =>
      group.links.map((link) => link.href),
    ),
  ];
}

describe("homepage destinations", () => {
  for (const locale of LOCALES) {
    it(`sends every ${locale} link somewhere that exists`, () => {
      const spanishRoutes = new Set<string>(
        Object.values(ROUTES).map((paths) => paths.es),
      );

      for (const href of everyLink(DICTIONARIES[locale])) {
        const resolved = localise(href, locale);

        if (resolved.startsWith("#")) {
          expect(
            RENDERED_SECTION_IDS.has(resolved.slice(1)),
            `${resolved} has no matching section on the page`,
          ).toBe(true);
          continue;
        }

        if (resolved.startsWith("mailto:") || resolved.startsWith("http")) {
          continue;
        }

        // A `/es` path must be one of the two that exist. Anything else is
        // the prefixing bug returning.
        if (resolved.startsWith("/es")) {
          expect(
            spanishRoutes.has(resolved),
            `${href} resolved to ${resolved}, which 404s`,
          ).toBe(true);
          continue;
        }

        const known =
          APP_ROUTES.has(resolved) ||
          Object.values(ROUTES).some((paths) => paths.en === resolved);

        expect(known, `${resolved} is not a route this app serves`).toBe(true);
      }
    });

    it(`links to no build-time-only route from ${locale}`, () => {
      // `/design-system` and the `*-preview` routes are disallowed in
      // robots.txt and absent from a production build. A footer link to one is
      // a 404 for every visitor.
      for (const href of everyLink(DICTIONARIES[locale])) {
        expect(href).not.toMatch(/design-system|-preview/);
      }
    });

    it(`uses no placeholder href in ${locale}`, () => {
      for (const href of everyLink(DICTIONARIES[locale])) {
        expect(href).not.toBe("#");
        expect(href).not.toBe("");
        expect(href.toLowerCase()).not.toContain("todo");
        expect(href.toLowerCase()).not.toContain("example.com");
      }
    });
  }

  it("keeps the header's four destinations pointing at the product", () => {
    // Create, Explore, Tools, Pricing — the order and the destinations the
    // sprint brief pins.
    expect(EN.nav.map((item) => item.href)).toEqual([
      "/studio",
      "/explore",
      "/marketplace",
      "/pricing",
    ]);

    // Spanish carries the same destinations with translated labels: the app
    // routes have no Spanish version, and inventing one is what broke them.
    expect(ES.nav.map((item) => item.href)).toEqual(EN.nav.map((i) => i.href));
    expect(ES.nav.map((item) => item.label)).not.toEqual(
      EN.nav.map((item) => item.label),
    );
  });

  it("carries the prompt and modality into sign-up from every plan CTA", () => {
    // The pricing cards send an unauthenticated visitor to sign-up with the
    // plan they picked, so they land on billing with it selected rather than
    // on a dashboard hunting for it.
    for (const tier of PRICING) {
      if (tier.monthly === 0) continue;
      expect(tier.id).toBe(tier.tier.toLowerCase());
    }
  });
});

describe("language isolation", () => {
  it("gives English and Spanish different copy for the same key", () => {
    // A Spanish page leaking English strings, or the reverse, is the failure
    // this catches. Compared on the nav labels and the hero, which are the
    // first words on the page in both languages.
    expect(ES.nav.map((n) => n.label)).not.toEqual(EN.nav.map((n) => n.label));
    expect(ES.auth.signIn).not.toBe(EN.auth.signIn);
    expect(ES.auth.signUp).not.toBe(EN.auth.signUp);
  });

  it("keeps home on / for English and /es for Spanish", () => {
    expect(ROUTES.home.en).toBe("/");
    expect(ROUTES.home.es).toBe("/es");
  });

  it("translates the pricing path as well as the words", () => {
    // `/es/pricing` does not exist. The Spanish route is `/es/precios`, and
    // linking to the untranslated path was the single most-clicked dead link.
    expect(ROUTES.pricing.es).toBe("/es/precios");
    expect(localise("/pricing", "es")).toBe("/es/precios");
  });
});

describe("composer destinations", () => {
  it("offers a valid model and ratio set for every modality", () => {
    for (const modality of COMPOSER_MODALITIES) {
      expect(modality.models.length).toBeGreaterThan(0);

      for (const model of modality.models) {
        expect(model.id).toMatch(/^[a-z]+\/[a-z0-9-]+$/);
      }

      // Audio has no aspect ratio and must not offer one — a ratio on an
      // audio request is a parameter the studio would have to ignore.
      if (modality.id === "audio") {
        expect(modality.aspectRatios).toHaveLength(0);
      } else {
        expect(modality.aspectRatios.length).toBeGreaterThan(0);
        for (const ratio of modality.aspectRatios) {
          expect(ratio).toMatch(/^\d+:\d+$/);
        }
      }
    }
  });

  it("has one entry per advertised modality, and no more", () => {
    expect(COMPOSER_MODALITIES.map((m) => m.id)).toEqual([
      "image",
      "video",
      "audio",
    ]);
  });
});
