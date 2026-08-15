import { Sparkles } from "lucide-react";
import Link from "next/link";

import { LanguageLink } from "@/features/marketing/components/language-link";
import { SITE } from "@/features/marketing/content";
import { getCopy } from "@/features/marketing/i18n/dictionaries";
import {
  localise,
  pathFor,
  type Locale,
} from "@/features/marketing/i18n/locales";

/**
 * Footer.
 *
 * The beta disclaimer sits here rather than only in the FAQ, because the footer
 * is where a careful reader goes to find out what a company is not saying
 * elsewhere. Burying it would make finding it feel like catching us out.
 *
 * Link columns collapse to two on mobile rather than one — four single-column
 * stacks is a very long footer on a phone, and these are all short labels.
 */
export function SiteFooter({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);

  const year = new Date().getFullYear();

  return (
    <footer className="border-t">
      <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_2fr]">
          <div>
            <Link
              href={pathFor("home", locale)}
              className="flex w-fit items-center gap-2 font-semibold tracking-tight"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-brand">
                <Sparkles
                  className="size-4 text-white"
                  strokeWidth={2}
                  aria-hidden
                />
              </span>
              {SITE.name}
            </Link>

            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              {copy.site.description}
            </p>
          </div>

          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-8 sm:grid-cols-4"
          >
            {copy.footer.groups.map((group) => (
              <div key={group.title}>
                <h2 className="mb-4 text-2xs font-medium tracking-wider uppercase">
                  {group.title}
                </h2>
                {/* Padding on the anchor, not spacing on the list item: the
                    tap target has to be the link itself. At `text-sm` these
                    were 19px tall, under the 24px minimum in WCAG 2.5.8, which
                    on a phone means thumbs miss them. */}
                <ul className="space-y-0.5">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={localise(link.href, locale)}
                        className="inline-block py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            © {year} {SITE.name}. {copy.footer.rights}
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="text-xs text-muted-foreground">{copy.footer.note}</p>
            {/* The site's only language control, now that a Spanish-preferring
                visitor is routed automatically. See language-link.tsx. */}
            <LanguageLink className="text-xs" />
          </div>
        </div>
      </div>
    </footer>
  );
}
