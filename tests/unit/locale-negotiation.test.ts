import { describe, expect, it } from "vitest";

import {
  localeRedirect,
  preferredLocale,
  spanishTwin,
} from "@/features/marketing/i18n/negotiate";

/**
 * Automatic language selection.
 *
 * Every case here is a way this feature goes wrong in production rather than
 * in a build: a redirect loop, a Spanish speaker stuck on English because the
 * header was parsed naively, an English speaker dragged to Spanish because
 * `es` appeared anywhere in their header, or a crawler indexing the wrong
 * page because a metadata request was redirected.
 *
 * The rule the whole module turns on: **an explicit choice is never
 * overridden.** Someone who clicked "English" on a Spanish page has answered,
 * and redirecting them back on the next navigation is the page arguing with
 * them.
 */

const doc = { fetchDest: "document" as const, cookie: undefined };

describe("preferredLocale", () => {
  it("honours q-weights rather than list order", () => {
    // Spanish appears first but is weighted lower. Taking `split(",")[0]`
    // would give this visitor Spanish against their stated preference.
    expect(preferredLocale("es;q=0.5,en;q=1.0")).toBe("en");
    expect(preferredLocale("en;q=0.3,es;q=0.9")).toBe("es");
  });

  it("matches on the base tag", () => {
    for (const tag of ["es-419", "es-PE", "es-ES", "es"]) {
      expect(preferredLocale(tag)).toBe("es");
    }
    expect(preferredLocale("en-GB")).toBe("en");
  });

  it("returns null for an absent, empty or wildcard header", () => {
    expect(preferredLocale(null)).toBeNull();
    expect(preferredLocale("")).toBeNull();
    // `*` is "anything", which is not a preference for Spanish.
    expect(preferredLocale("*")).toBeNull();
  });

  it("ignores languages the site is not published in", () => {
    expect(preferredLocale("fr-FR,de;q=0.8")).toBeNull();
    // ...but still finds a supported one further down the list.
    expect(preferredLocale("fr-FR,es;q=0.8")).toBe("es");
  });

  it("treats a malformed weight as unweighted, not as zero", () => {
    expect(preferredLocale("es;q=,en;q=0.2")).toBe("es");
  });
});

describe("spanishTwin", () => {
  it("maps translated paths, not prefixed ones", () => {
    expect(spanishTwin("/")).toBe("/es");
    // Not `/es/pricing` — that route does not exist and would 404.
    expect(spanishTwin("/pricing")).toBe("/es/precios");
  });

  it("returns null for pages with no Spanish version", () => {
    for (const path of ["/studio", "/settings", "/connect", "/terms"]) {
      expect(spanishTwin(path)).toBeNull();
    }
  });
});

describe("localeRedirect", () => {
  it("sends a Spanish-preferring first visit to the Spanish page", () => {
    expect(
      localeRedirect({
        ...doc,
        pathname: "/",
        acceptLanguage: "es-419,es;q=0.9",
      }),
    ).toBe("/es");
  });

  it("leaves an English-preferring visitor alone", () => {
    expect(
      localeRedirect({
        ...doc,
        pathname: "/",
        acceptLanguage: "en-US,en;q=0.9",
      }),
    ).toBeNull();
  });

  it("never overrides an explicit choice, in either direction", () => {
    // The English-choosing Spanish speaker: the case that would otherwise
    // redirect on every single navigation.
    expect(
      localeRedirect({
        ...doc,
        cookie: "en",
        pathname: "/",
        acceptLanguage: "es-419,es;q=0.9",
      }),
    ).toBeNull();

    expect(
      localeRedirect({
        ...doc,
        cookie: "es",
        pathname: "/",
        acceptLanguage: "en-US",
      }),
    ).toBeNull();
  });

  it("cannot loop, because Spanish paths are never negotiated", () => {
    for (const pathname of ["/es", "/es/precios"]) {
      expect(
        localeRedirect({ ...doc, pathname, acceptLanguage: "es-419" }),
      ).toBeNull();
    }
  });

  it("only redirects top-level document requests", () => {
    // An RSC payload, an image, or a crawler's metadata fetch. Redirecting one
    // produces a broken preview card rather than a translated page.
    for (const fetchDest of ["empty", "image", "script", null]) {
      expect(
        localeRedirect({
          cookie: undefined,
          fetchDest,
          pathname: "/",
          acceptLanguage: "es-419",
        }),
      ).toBeNull();
    }
  });

  it("does not redirect a page that has no Spanish twin", () => {
    expect(
      localeRedirect({ ...doc, pathname: "/studio", acceptLanguage: "es-419" }),
    ).toBeNull();
  });
});
