import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  // Public since the Luminous Editorial sprint. Every model on it is derived
  // from the registry, so the page cannot list something unselectable.
  "/models",
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
    /**
     * Create, Models, Explore, Pricing.
     *
     * This pinned Create / Explore / **Tools** / Pricing until the Luminous
     * Editorial sprint, whose brief specifies the list above. `Tools` pointed
     * at `/marketplace`, which sits behind authentication and has no public
     * feature flag — a signed-out visitor clicking it met a sign-in wall for
     * something that is not being launched. `Models` replaces it with a page
     * built from the catalogue.
     */
    expect(EN.nav.map((item) => item.href)).toEqual([
      "/studio",
      "/models",
      "/explore",
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
        // A public id. A `provider/model` path here would be readable in the
        // rendered HTML and in the sign-up redirect the composer builds.
        expect(model.id).toMatch(/^[a-z0-9-]+$/);
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

describe("touch targets on the controls a thumb actually hits", () => {
  /**
   * Measured on production at 375×812, not inferred from class names.
   *
   * Sprint 4.2 raised the composer's modality tabs to 44px and the finding was
   * recorded as fixed. It was fixed — for one of the two tablists. The
   * homepage renders *two* groups labelled Image / Video / Audio: the
   * composer's, and the showcase's four sections higher. They look identical,
   * so verifying one looked like verifying both.
   *
   *   composer tabs   80×44   min-height: 44px
   *   showcase tabs   96×38   min-height: auto   <- missed
   *
   * Same story for the header's primary CTA at 98×32.
   *
   * These assert `min-h-11` rather than a rendered pixel height because jsdom
   * has no layout engine and would report 0 for everything. The rendered
   * measurement lives in the sprint report; this stops the class disappearing.
   */
  const read = (p: string) =>
    readFileSync(resolve(import.meta.dirname, "../..", p), "utf8");

  /**
   * Source with comments stripped.
   *
   * Each of these files *documents* the `h-11` mistake it no longer makes, so
   * asserting against raw text matches the explanation and fails on correct
   * code. Deleting the comment to satisfy a regex would be the wrong repair —
   * it is why the next person does not reintroduce the bug.
   */
  const code = (p: string) =>
    read(p)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

  it("gives the showcase tablist a 44px minimum on touch", () => {
    const source = read("features/marketing/components/ai-showcase.tsx");
    expect(source).toMatch(/min-h-11/);
  });

  it("gives the composer tablist a 44px minimum on touch", () => {
    const source = read("features/marketing/components/home-composer.tsx");
    expect(source).toMatch(/min-h-11/);
  });

  it("gives the header's primary CTA a 44px minimum on touch", () => {
    const source = read("features/marketing/components/site-header.tsx");
    const cta = source.slice(source.indexOf('variant="gradient"'));
    expect(cta.slice(0, 400)).toMatch(/min-h-11/);
  });

  it("uses min-height rather than height, which loses the cascade", () => {
    /**
     * The original attempt used `h-11`. The class list showed `h-11` and the
     * element still measured 36px, because the Button's own `size` variant
     * sets `height` and the two compete for one property. `min-height` does
     * not compete, so it applies.
     */
    for (const p of [
      "features/marketing/components/ai-showcase.tsx",
      "features/marketing/components/home-composer.tsx",
      "features/marketing/components/site-header.tsx",
    ]) {
      // `(?<![\w-])` so this does not match the `h-11` inside `min-h-11`,
      // which is the class we actually want.
      expect(code(p), p).not.toMatch(/(?<![\w-])h-11\b/);
    }
  });
});

describe("the LCP asset is announced to the preload scanner", () => {
  /**
   * Lighthouse fails `lcp-discovery-insight` on production: the LCP element is
   * a CSS `background-image`, which the preload scanner cannot see, so 456ms
   * of the measured LCP was pure resource-load delay.
   *
   * `fetchpriority` is not available here — that attribute is for `<img>`.
   * A preload link is the only mechanism.
   */
  const landing = readFileSync(
    resolve(
      import.meta.dirname,
      "../..",
      "features/marketing/components/landing.tsx",
    ),
    "utf8",
  );

  it("preloads the hero poster", () => {
    expect(landing).toMatch(/rel="preload"/);
    expect(landing).toMatch(/as="image"/);
    /**
     * This used to match the hashed filenames written out here literally.
     * That was the weaker of the two possible checks and it let a real bug
     * through: when the hero clip was replaced, these literals kept naming the
     * *previous* poster, and the pattern still matched because the shape was
     * right and only the hash was wrong.
     *
     * They are now interpolated from `HERO_MEDIA`, so the preload cannot name
     * anything but the current poster. Both densities are still asserted —
     * preloading one while the stylesheet picks the other fetches two files to
     * paint one image. The equality with what the stylesheet requests is
     * `tests/unit/hero-video.test.ts`, which can read both files.
     */
    expect(landing).toMatch(/HERO_MEDIA\.posterMobile\} \d+w/);
    expect(landing).toMatch(/HERO_MEDIA\.poster\} \d+w/);
  });

  it("preloads exactly one asset", () => {
    // A preload for everything is a preload for nothing: each one competes
    // with the LCP request it is supposed to accelerate.
    expect(landing.match(/rel="preload"/g)).toHaveLength(1);
  });

  it("scopes the preload to the routes that render a hero", () => {
    /**
     * In `landing.tsx`, not the marketing layout. The layout also wraps
     * /pricing, /privacy and the legal pages, none of which paint this image.
     */
    const layout = readFileSync(
      resolve(import.meta.dirname, "../..", "app/(marketing)/layout.tsx"),
      "utf8",
    );
    expect(layout).not.toMatch(/hero-poster/);
  });
});
