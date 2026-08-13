import { Artwork } from "@/features/marketing/components/artwork";
import { GALLERY } from "@/features/marketing/content";
import { getCopy } from "@/features/marketing/i18n/dictionaries";
import type { Locale } from "@/features/marketing/i18n/locales";
import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";

/**
 * Gallery.
 *
 * A masonry-ish grid using CSS columns, which lets tiles keep their natural
 * heights instead of being cropped to a uniform square. Varying the shapes is
 * what makes a gallery look like a gallery rather than a spreadsheet.
 *
 * ## An honesty note, stated on the page
 *
 * These tiles are procedurally generated, not model output — Atheos has not
 * generated anything yet, and passing off stock imagery or someone else's AI art
 * as our product's work would be a lie the product would then have to live up
 * to. The caption below the grid says so plainly rather than hoping nobody
 * notices. Real generations replace these in Sprint 4.
 *
 * `break-inside-avoid` is load-bearing: without it a CSS-columns layout splits
 * a card across a column boundary and renders half of it in each.
 */
export function Gallery({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);

  return (
    <Section id="gallery">
      <SectionHeading
        eyebrow={copy.sections.gallery.eyebrow}
        title={copy.sections.gallery.title}
        description={copy.sections.gallery.description}
      />

      <Reveal delay={0.05} className="mt-12">
        <div className="columns-2 gap-3 sm:gap-4 md:columns-3 lg:columns-4">
          {GALLERY.map((tile, index) => (
            <figure
              key={copy.gallery[index] ?? index}
              className="group mb-3 break-inside-avoid sm:mb-4"
            >
              <div className="relative overflow-hidden rounded-xl ring-1 ring-white/10">
                <Artwork
                  hue={tile.hue}
                  seed={tile.seed}
                  rich
                  // Alternating aspect ratios give the masonry its rhythm.
                  className={
                    index % 3 === 0
                      ? "aspect-[3/4] w-full"
                      : index % 3 === 1
                        ? "aspect-square w-full"
                        : "aspect-[4/5] w-full"
                  }
                />

                {/* The prompt, revealed on hover. Always present in the DOM, so
                    it is available to a screen reader and to search engines
                    regardless of pointer capability. */}
                <figcaption className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/85 to-transparent p-3 text-xs text-white/90 transition-transform duration-300 group-focus-within:translate-y-0 group-hover:translate-y-0 motion-reduce:translate-y-0">
                  {copy.gallery[index]}
                </figcaption>
              </div>
            </figure>
          ))}
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <p className="mt-8 text-center text-xs text-muted-foreground">
          Artwork on this page is procedurally generated for illustration.
          Atheos is in private beta — we would rather show nothing than show
          output we have not produced.
        </p>
      </Reveal>
    </Section>
  );
}
