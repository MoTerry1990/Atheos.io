"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useCopy, useLocale } from "@/features/marketing/i18n";
import {
  LOCALES,
  LOCALE_NAMES,
  ROUTES,
  type Locale,
} from "@/features/marketing/i18n/locales";
import { cn } from "@/lib/utils";

/**
 * English / Español.
 *
 * ## A pair of links, not a select
 *
 * Two options do not need a menu, and a real `<a>` per language is what makes
 * the other version crawlable. A `<select>` with an `onChange` router push is
 * invisible to a search engine, so the Spanish page would never be discovered
 * from the English one — which is most of the point of publishing it.
 *
 * ## It maps the page, not the prefix
 *
 * The Spanish pricing page is `/es/precios`, not `/es/pricing`, so switching
 * cannot be string surgery on the current path. `ROUTES` holds every
 * translated pair and the lookup is by page identity. A path with no known
 * translation falls back to that language's home page rather than producing a
 * URL that 404s — landing on the Spanish home is a small disappointment, a
 * 404 is a dead end.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const current = useLocale();
  const copy = useCopy();
  const pathname = usePathname();

  function target(locale: Locale): string {
    const match = Object.values(ROUTES).find((route) =>
      Object.values(route).includes(pathname as never),
    );
    return match ? match[locale] : ROUTES.home[locale];
  }

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-full border border-border bg-surface-sunken p-0.5",
        className,
      )}
      role="group"
      aria-label={copy.language.label}
    >
      {LOCALES.map((locale) => {
        const active = locale === current;
        return (
          <Link
            key={locale}
            href={target(locale)}
            // Tells a crawler these are the same page in two languages, which
            // is what stops them competing with each other in the index.
            hrefLang={locale}
            aria-current={active ? "true" : undefined}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
              active
                ? "bg-card text-foreground elevation-raised"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {/* The name in its own language — somebody looking for Spanish is
                scanning for "Español", not for "Spanish". */}
            {LOCALE_NAMES[locale]}
          </Link>
        );
      })}
    </div>
  );
}
