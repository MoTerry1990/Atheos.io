"use client";

import { createContext, useContext, type ReactNode } from "react";

import { EN } from "@/features/marketing/i18n/en";
import { getCopy } from "@/features/marketing/i18n/dictionaries";
import type { MarketingCopy } from "@/features/marketing/i18n/copy";
import {
  DEFAULT_LOCALE,
  localise,
  type Locale,
} from "@/features/marketing/i18n/locales";

/**
 * Copy delivery.
 *
 * ## Why a context rather than a prop
 *
 * The marketing page is a stack of a dozen sections, most of them client
 * components several levels deep. Threading `copy` through every one of them
 * would put a prop on components that only pass it along, and would make
 * adding a section a change to its parent. The locale is genuinely ambient —
 * it is a property of the page, not of any component on it.
 *
 * Server components in this tree take `locale` as a prop and call `getCopy`
 * directly instead; a context cannot cross that boundary, and pretending
 * otherwise is how a server component ends up marked `"use client"` for no
 * reason.
 *
 * ## The default is English, deliberately
 *
 * A component rendered outside a provider — a preview route, a test, a section
 * reused on a non-marketing page — gets English rather than throwing. The
 * failure mode of a missing provider should be untranslated text, not a blank
 * page.
 */

export { getCopy };

interface LocaleValue {
  locale: Locale;
  copy: MarketingCopy;
}

const LocaleContext = createContext<LocaleValue>({
  locale: DEFAULT_LOCALE,
  copy: EN,
});

export function MarketingLocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  // Not memoised: `locale` is constant for the lifetime of a page, so the
  // object identity changes only when the whole tree is being replaced anyway.
  return (
    <LocaleContext.Provider value={{ locale, copy: getCopy(locale) }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useCopy(): MarketingCopy {
  return useContext(LocaleContext).copy;
}

/**
 * A locale-aware `href`.
 *
 * Anchors and external links pass through untouched — see `localise`.
 */
export function useHref(): (href: string) => string {
  const locale = useLocale();
  return (href: string) => localise(href, locale);
}
