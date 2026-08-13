import { FEATURES } from "@/features/marketing/content";
import { getCopy } from "@/features/marketing/i18n/dictionaries";
import type { Locale } from "@/features/marketing/i18n/locales";
import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";
import { cn } from "@/lib/utils";

/**
 * Feature grid.
 *
 * A bento layout — two cards span two columns, the rest one — because a
 * perfectly uniform 3×2 grid reads as a checklist. Varying the weight tells the
 * eye which claims matter most without needing a heading to say so.
 *
 * This is a Server Component. The only motion is the scroll reveal, which
 * `Reveal` handles as a client island per card. There is no reason to ship the
 * card markup itself to the browser as JavaScript.
 */
export function Features({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);

  return (
    <Section id="features">
      <SectionHeading
        eyebrow={copy.sections.features.eyebrow}
        title={copy.sections.features.title}
        description={copy.sections.features.description}
      />

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((entry, index) => (
          <Reveal
            key={copy.features[index]?.title ?? index}
            // Cap the cumulative delay: a long stagger means the last card is
            // still arriving after the user has scrolled past it.
            delay={Math.min(index * 0.06, 0.24)}
            className={cn(entry.wide && "lg:col-span-2")}
          >
            <article
              className={cn(
                "group relative h-full overflow-hidden rounded-2xl border border-border bg-card p-6",
                "transition-colors duration-300 hover:border-primary/30",
              )}
            >
              {/* Brand wash that fades in on hover. Pointer-events off so it
                  never intercepts a click on the card. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-brand-subtle opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />

              <div className="relative">
                <span className="mb-5 inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <entry.icon
                    className="size-5"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </span>

                <h3 className="text-base font-semibold">
                  {copy.features[index]?.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {copy.features[index]?.body}
                </p>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
