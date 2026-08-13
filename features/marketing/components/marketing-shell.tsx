import type { ReactNode } from "react";

import { SiteFooter } from "@/features/marketing/components/site-footer";
import { SiteHeader } from "@/features/marketing/components/site-header";
import { StructuredData } from "@/features/marketing/components/structured-data";
import { MarketingLocaleProvider } from "@/features/marketing/i18n";
import type { Locale } from "@/features/marketing/i18n/locales";

/**
 * Header, footer and locale, around a marketing page.
 *
 * ## Why this is not the route group's layout
 *
 * A layout does not know which page is beneath it, and the header needs the
 * locale — it renders the navigation and the language switcher. `/es` and `/`
 * are different routes under the *same* layout, so the layout cannot tell them
 * apart. Each page renders its own shell and passes the locale in.
 *
 * The provider is here rather than in each page so that a page cannot render a
 * client section without one and silently fall back to English.
 */
export function MarketingShell({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <MarketingLocaleProvider locale={locale}>
      <div className="flex min-h-dvh flex-col">
        <StructuredData locale={locale} />
        <SiteHeader />

        {/* No top padding: the hero deliberately sits underneath the
            transparent header and provides its own clearance. */}
        <main className="flex-1">{children}</main>

        <SiteFooter locale={locale} />
      </div>
    </MarketingLocaleProvider>
  );
}
