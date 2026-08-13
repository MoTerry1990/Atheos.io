import { ArrowUpRight } from "lucide-react";

import { GeneratedImage } from "@/features/marketing/components/generated-image";
import { Badge } from "@/components/ui/badge";
import { TEMPLATES } from "@/features/marketing/content";
import { getCopy } from "@/features/marketing/i18n/dictionaries";
import type { Locale } from "@/features/marketing/i18n/locales";
import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";

/**
 * Starting points.
 *
 * On mobile this is a horizontal snap-scroller rather than a stacked column.
 * Six full-width cards stacked vertically is six screens of scrolling to learn
 * one idea; a swipe carousel communicates "there is a set of these" in a single
 * gesture. `snap-mandatory` makes it land cleanly instead of drifting to a
 * half-visible card.
 *
 * The scroller is not focus-trapping or keyboard-hostile: each card is a normal
 * link, so tabbing through scrolls the container natively.
 */
export function Templates({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);

  return (
    <Section id="templates">
      <SectionHeading
        align="left"
        eyebrow={copy.sections.templates.eyebrow}
        title={copy.sections.templates.title}
        description={copy.sections.templates.description}
      />

      <div className="mt-12 flex snap-x snap-mandatory [scrollbar-width:none] gap-4 overflow-x-auto pb-4 md:grid md:grid-cols-2 md:overflow-visible md:pb-0 lg:grid-cols-3 [&::-webkit-scrollbar]:hidden">
        {TEMPLATES.map((template, index) => (
          <Reveal
            key={copy.templates[index]?.title ?? index}
            delay={Math.min(index * 0.05, 0.2)}
            className="w-[78%] shrink-0 snap-start sm:w-[46%] md:w-auto"
          >
            <a
              href="#pricing"
              className="group block h-full overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none motion-reduce:hover:translate-y-0"
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden">
                <GeneratedImage
                  src={`template-${index + 1}`}
                  prompt={copy.templates[index]?.body ?? ""}
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="transition-transform duration-500 group-hover:scale-105 motion-reduce:group-hover:scale-100"
                />
                <Badge
                  variant="default"
                  size="sm"
                  className="absolute top-3 left-3 bg-background/80 backdrop-blur-sm"
                >
                  {copy.templates[index]?.category}
                </Badge>
              </div>

              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold">
                    {copy.templates[index]?.title}
                  </h3>
                  <ArrowUpRight
                    className="size-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary"
                    aria-hidden
                  />
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {copy.templates[index]?.body}
                </p>
              </div>
            </a>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
