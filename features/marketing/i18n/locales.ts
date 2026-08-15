/**
 * The languages the public site is published in.
 *
 * ## English keeps the bare paths
 *
 * `/` and `/pricing`, not `/en` and `/en/pricing`. Those URLs are already
 * indexed and already linked, and moving them to buy symmetry would cost real
 * ranking for a tidier route tree. Spanish is additive: `/es` and `/es/precios`.
 *
 * ## Spanish here means Latin American Spanish
 *
 * `es-419`, not `es-ES`. Atheos is being built from Peru and its first Spanish
 * speakers are American. The differences are small but constant — *computadora*
 * not *ordenador*, *video* not *vídeo*, and second person plural is *ustedes*,
 * never *vosotros*. Copy written in peninsular Spanish reads as translated, and
 * a page that reads as translated reads as an afterthought.
 *
 * The `hreflang` value stays `es` rather than `es-419` so that every Spanish
 * speaker matches it; the region tag would narrow the audience for no benefit.
 */

export const LOCALES = ["en", "es"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** What `<html lang>` and `hreflang` should say. */
export const HTML_LANG: Record<Locale, string> = {
  en: "en",
  es: "es",
};

/** What OpenGraph wants, which is not the same format. */
export const OG_LOCALE: Record<Locale, string> = {
  en: "en_US",
  es: "es_419",
};

/** Shown in the language switcher, in the language being offered. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

/**
 * Where a given page lives in each language.
 *
 * Paths are localised too — `/es/precios`, not `/es/pricing`. A Spanish page
 * behind an English URL is the same afterthought as peninsular copy, and the
 * word is what someone searches for.
 */
export const ROUTES = {
  home: { en: "/", es: "/es" },
  pricing: { en: "/pricing", es: "/es/precios" },
} as const satisfies Record<string, Record<Locale, string>>;

export type RouteKey = keyof typeof ROUTES;

export function pathFor(route: RouteKey, locale: Locale): string {
  return ROUTES[route][locale];
}

/**
 * The Spanish equivalent of an English path, when one exists.
 *
 * ## This used to prefix, and that produced nine dead links per page
 *
 * The previous implementation returned `/es${href}` for anything that was not
 * an anchor, a mailto or an absolute URL. Only **two** routes have a Spanish
 * twin — `/` and `/pricing` — so on `/es` every other link 404'd:
 *
 *   /es/studio  /es/explore  /es/marketplace  /es/pricing
 *   /es/privacy /es/terms    /es/acceptable-use /es/connect
 *
 * Four in the header, five in the footer, on every Spanish page. Nothing threw
 * and the build was clean; the links simply did not go anywhere. The Spanish
 * pricing page is at `/es/precios` — the paths are translated too — so even
 * the one route that *did* have a twin was linked to at the wrong URL.
 *
 * ## So it is a lookup, not a transformation
 *
 * `ROUTES` is the list of pages that exist in both languages. Anything absent
 * from it is English-only and is returned unchanged, which sends the reader to
 * a working English page. That is a real limitation — the studio, explore, the
 * marketplace and the legal pages are not translated — and a working page in
 * the wrong language is unambiguously better than a 404 in the right one.
 *
 * `spanishTwin()` in `negotiate.ts` already worked this way, and warned that
 * prefixing "would send a visitor to a URL that 404s". It was right; the
 * warning was just in the wrong file.
 */
export function localise(href: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return href;

  // Fragments stay on the page, absolute URLs and mail links leave the site.
  if (
    href.startsWith("#") ||
    href.startsWith("http") ||
    href.startsWith("mailto:")
  ) {
    return href;
  }

  for (const paths of Object.values(ROUTES)) {
    if (paths.en === href) return paths[locale];
  }

  // English-only. Better a working page than a translated 404.
  return href;
}
