import { TRUSTED_BY } from "@/features/marketing/content";
import { getCopy } from "@/features/marketing/i18n/dictionaries";
import type { Locale } from "@/features/marketing/i18n/locales";

/**
 * Infrastructure marquee.
 *
 * Note what this section is *not*: a wall of customer logos. Atheos is in
 * private beta and has none, and inventing them is the kind of shortcut that is
 * both dishonest and trivially caught. Naming the stack is verifiable, and it
 * answers the question a technical buyer is actually asking — is this a real
 * system or a weekend project?
 *
 * ## The marquee
 *
 * The track holds **two identical copies** of the list and translates by -50%.
 * At the moment the animation loops, the second copy sits exactly where the
 * first started, so the seam is invisible. Every other approach — animating
 * `left`, or JS-driven scrolling — either seams visibly or costs main-thread
 * time.
 *
 * Pure CSS, so the global reduced-motion rule stops it with no JS involved. The
 * duplicate copy is `aria-hidden`, otherwise a screen reader reads the whole
 * list twice.
 */
export function TrustedBy({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);

  return (
    <section aria-labelledby="trusted-by-label" className="border-y py-12">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <p
          id="trusted-by-label"
          className="mb-8 text-center text-2xs font-medium tracking-wider text-muted-foreground uppercase"
        >
          {copy.trustedBy.label}
        </p>
      </div>

      <div className="relative flex overflow-hidden mask-fade-x">
        <ul className="flex shrink-0 marquee-track items-center gap-12 pr-12 sm:gap-16 sm:pr-16">
          {TRUSTED_BY.map((item) => (
            <li
              key={item}
              className="shrink-0 text-lg font-medium tracking-tight whitespace-nowrap text-muted-foreground/70 transition-colors hover:text-foreground sm:text-xl"
            >
              {item}
            </li>
          ))}
        </ul>

        {/* The seamless half. Hidden from assistive tech — it is the same
            content, and announcing it twice is confusing rather than emphatic. */}
        <ul
          aria-hidden
          className="flex shrink-0 marquee-track items-center gap-12 pr-12 sm:gap-16 sm:pr-16"
        >
          {TRUSTED_BY.map((item) => (
            <li
              key={item}
              className="shrink-0 text-lg font-medium tracking-tight whitespace-nowrap text-muted-foreground/70 sm:text-xl"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
