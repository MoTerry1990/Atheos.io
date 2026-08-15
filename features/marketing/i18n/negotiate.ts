import {
  DEFAULT_LOCALE,
  ROUTES,
  type Locale,
} from "@/features/marketing/i18n/locales";

/**
 * Choosing a language for a first-time visitor.
 *
 * ## The signal is `Accept-Language`, and only that
 *
 * Not the country. A Peruvian on an English-configured laptop wants English —
 * they chose that setting — and an Argentine reading from Madrid still wants
 * Spanish. Country is a proxy for language that is wrong often enough to be
 * insulting when it is, and the browser is already carrying the answer.
 *
 * Vercel does send `x-vercel-ip-country`, so the temptation is real. It stays
 * unused.
 *
 * ## An explicit choice always wins
 *
 * The cookie is checked before the header and is never overwritten by
 * negotiation. Somebody who clicked "English" on a Spanish page has answered
 * the question, and asking again on the next navigation — by redirecting them
 * back — is the bug this whole module exists to avoid.
 */

/** Set only by the footer switcher. Its presence means "the visitor decided". */
export const LOCALE_COOKIE = "atheos_locale";

/**
 * Parse `Accept-Language` and return the highest-priority supported language.
 *
 * The header is a q-weighted list — `es-419,es;q=0.9,en;q=0.8` — and the
 * weights matter: taking the first entry would give Spanish to somebody whose
 * browser says `en;q=1.0, es;q=0.5` merely because Spanish appears in the list
 * at all.
 *
 * Base tags are compared, so `es-419`, `es-PE` and `es-ES` all match `es`.
 * Returns null when nothing supported appears, which means "leave them where
 * they are" rather than "use the default".
 */
export function preferredLocale(header: string | null): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      if (!tag) return null;

      const q = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));

      // A malformed weight is treated as absent rather than as zero: `q=`
      // should not silently rank a language last.
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;

      return {
        base: tag.split("-")[0]?.toLowerCase() ?? "",
        weight: Number.isFinite(weight) ? weight : 1,
      };
    })
    .filter(
      (entry): entry is { base: string; weight: number } => entry !== null,
    )
    .sort((a, b) => b.weight - a.weight);

  for (const entry of ranked) {
    // `*` means "anything", which is not a preference for Spanish.
    if (entry.base === "*") return null;
    if (entry.base === "es") return "es";
    if (entry.base === "en") return "en";
  }

  return null;
}

/**
 * The Spanish twin of an English marketing path, or null when there is none.
 *
 * Derived from `ROUTES` rather than by prefixing, because the paths are
 * localised too — `/es/precios`, not `/es/pricing`. Prefixing would send a
 * visitor to a URL that 404s, which is a worse outcome than not redirecting.
 *
 * **Only the marketing pages have twins.** `/studio`, `/settings` and the rest
 * of the application are English-only, and redirecting into a Spanish route
 * that does not exist is the redirect loop this returns null to prevent.
 */
export function spanishTwin(pathname: string): string | null {
  for (const paths of Object.values(ROUTES)) {
    if (paths.en === pathname) return paths.es;
  }
  return null;
}

/** Whether a path already belongs to the Spanish tree. */
export function isSpanishPath(pathname: string): boolean {
  return pathname === "/es" || pathname.startsWith("/es/");
}

/**
 * Should this request be redirected, and where to?
 *
 * Returns null for every reason not to touch it — which is most requests.
 * Written as one function so the conditions are readable together rather than
 * scattered through the middleware.
 */
export function localeRedirect(input: {
  pathname: string;
  acceptLanguage: string | null;
  cookie: string | undefined;
  /** `Sec-Fetch-Dest`, used to leave anything that is not a page alone. */
  fetchDest: string | null;
}): string | null {
  const { pathname, acceptLanguage, cookie, fetchDest } = input;

  // An explicit choice, in either direction. Never overridden.
  if (cookie === "en" || cookie === "es") return null;

  // Already Spanish — negotiating again could only send them back.
  if (isSpanishPath(pathname)) return null;

  /**
   * Only top-level document requests.
   *
   * `Sec-Fetch-Dest: document` is sent by every current browser for a page
   * navigation and by nothing else — not for the RSC payloads Next fetches on
   * client navigation, not for images, not for the metadata and OG-image
   * requests crawlers make. Redirecting one of those produces a broken preview
   * card rather than a translated page.
   *
   * Crawlers that send no `Sec-Fetch-Dest` at all fall through to null, so
   * Googlebot indexes the English page it asked for. That is the correct
   * outcome: `hreflang` is how it discovers the Spanish one.
   */
  if (fetchDest !== "document") return null;

  const twin = spanishTwin(pathname);
  if (!twin) return null;

  return preferredLocale(acceptLanguage) === "es" && DEFAULT_LOCALE !== "es"
    ? twin
    : null;
}
