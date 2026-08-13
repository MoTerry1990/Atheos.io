import type { Metadata } from "next";

import {
  HTML_LANG,
  LOCALES,
  ROUTES,
  type Locale,
  type RouteKey,
} from "@/features/marketing/i18n/locales";

/**
 * `canonical` plus the `hreflang` set, for one page in one language.
 *
 * Both halves matter and they do different jobs. The canonical says "this URL
 * is the real one for this content", which stops tracking parameters
 * fragmenting the page's authority. The alternates say "the same content also
 * exists at these URLs, in these languages", which is what stops the English
 * and Spanish versions being read as duplicates and competing.
 *
 * `x-default` points at English: it is what a crawler serves when it cannot
 * match any of the declared languages, and sending an unmatched visitor to the
 * Spanish page would be a guess.
 *
 * Every entry is a path, not an absolute URL — Next resolves them against
 * `metadataBase` from the root layout, which is the only place the hostname
 * should be written down.
 */
export function alternatesFor(
  route: RouteKey,
  locale: Locale,
): Metadata["alternates"] {
  const languages: Record<string, string> = {};
  for (const other of LOCALES) {
    languages[HTML_LANG[other]] = ROUTES[route][other];
  }
  languages["x-default"] = ROUTES[route].en;

  return { canonical: ROUTES[route][locale], languages };
}
