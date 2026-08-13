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
 * Prefixes an in-app link with the locale, leaving anchors and absolute URLs
 * alone.
 *
 * Anchors matter: most marketing navigation is `#pricing`, which must stay a
 * fragment on the current page rather than becoming `/es#pricing` and forcing
 * a navigation to reach a section already on screen.
 */
export function localise(href: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return href;
  if (
    href.startsWith("#") ||
    href.startsWith("http") ||
    href.startsWith("mailto:")
  ) {
    return href;
  }
  if (href === "/") return "/es";
  return `/es${href}`;
}
