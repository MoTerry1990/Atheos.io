"use client";

import { Languages } from "lucide-react";
import { usePathname } from "next/navigation";

import { useLocale } from "@/features/marketing/i18n";
import { LOCALE_COOKIE } from "@/features/marketing/i18n/negotiate";
import {
  LOCALE_NAMES,
  ROUTES,
  type Locale,
} from "@/features/marketing/i18n/locales";
import { cn } from "@/lib/utils";

/**
 * The one language control on the site, in the footer.
 *
 * ## Why it left the header
 *
 * A visitor whose browser prefers Spanish is now sent to the Spanish page
 * before anything renders — see `middleware.ts`. Once that works, a permanent
 * English/Español pair in the header is a control most people never need,
 * occupying the row that holds the two things they do: sign in, and start.
 *
 * It stays reachable, and stays a real link so the other language is still
 * crawlable. It is simply not competing with the primary actions any more.
 *
 * ## It offers the *other* language, not both
 *
 * A toggle showing the current language as well is asking somebody to identify
 * which of two words they are already reading. One link, naming where it goes.
 *
 * ## Clicking it is an explicit choice, and is remembered
 *
 * The cookie it sets is the one `localeRedirect` checks first. Without it, a
 * Spanish-preferring visitor who clicks "English" is redirected straight back
 * to Spanish on their next navigation — the page fighting a decision they just
 * made. Set before navigating rather than after, so the redirect the click
 * triggers already sees it.
 *
 * A year, `SameSite=Lax`, no `Secure` flag in development so it works on
 * `localhost`. It holds a two-letter language code and nothing else.
 */
export function LanguageLink({ className }: { className?: string }) {
  const current = useLocale();
  const pathname = usePathname();

  const other: Locale = current === "en" ? "es" : "en";

  /**
   * The equivalent page, not the prefixed path.
   *
   * `/es/precios`, not `/es/pricing` — the paths are translated too, so this
   * is a lookup by page identity rather than string surgery. A page with no
   * known twin falls back to that language's home rather than producing a URL
   * that 404s: a small disappointment beats a dead end.
   */
  const match = Object.values(ROUTES).find((route) =>
    Object.values(route).includes(pathname as never),
  );
  const href = match ? match[other] : ROUTES.home[other];

  function remember() {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LOCALE_COOKIE}=${other}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }

  return (
    <a
      href={href}
      hrefLang={other}
      onClick={remember}
      // Names the destination language rather than the word "language", which
      // is what a screen-reader user needs to decide whether to follow it.
      aria-label={`Ver este sitio en ${LOCALE_NAMES[other]}`.replace(
        "Ver este sitio en",
        other === "es" ? "Ver este sitio en" : "View this site in",
      )}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-muted-foreground",
        "transition-colors hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        className,
      )}
    >
      <Languages className="size-3.5" aria-hidden />
      {LOCALE_NAMES[other]}
    </a>
  );
}
