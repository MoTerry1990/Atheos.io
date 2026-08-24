"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Section shell and heading.
 *
 * Every section on the page uses these, so vertical rhythm and heading
 * hierarchy are decided once. A landing page where each section invents its own
 * padding is the most common reason a page feels assembled rather than designed
 * — the eye reads the inconsistency long before it reads the copy.
 */

/**
 * Which editorial band a section belongs to.
 *
 * ## Why this is not just a background class
 *
 * The page needs a deliberate rhythm — cinematic dark, soft light, dark again —
 * and `bg-*` classes cannot provide it, because every colour on the page
 * currently follows the *reader's* theme. `next-themes` runs with
 * `enableSystem`, so a visitor whose OS is light saw an entirely white homepage
 * and no alternation at all.
 *
 * A band redefines the semantic roles for its subtree (see `styles/globals.css`
 * § 2b), so everything inside it — cards, muted text, borders, buttons —
 * follows the band rather than the theme, with no changes at any call site.
 *
 * `none` keeps a section transparent, which is right for one that sits on the
 * hero's own media.
 */
export type Band = "dark" | "light" | "none";

export function Section({
  id,
  band = "none",
  size = "default",
  className,
  children,
}: {
  id?: string;
  band?: Band;
  /**
   * Vertical rhythm.
   *
   * The audit found all ten sections on 112px top and bottom — uniform, and
   * therefore no rhythm at all: nothing was emphasised because everything was.
   * `wide` is for the one or two sections that carry the page.
   */
  size?: "default" | "wide" | "tight";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-band={band === "none" ? undefined : band}
      // scroll-mt clears the fixed header when an anchor link lands here.
      // Without it every in-page link puts the heading underneath the nav.
      className={cn(
        "scroll-mt-20",
        size === "wide" && "py-24 sm:py-36",
        size === "default" && "py-20 sm:py-28",
        size === "tight" && "py-14 sm:py-20",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        {children}
      </div>
    </section>
  );
}

/**
 * Entrance reveal — **CSS only, visible by default**.
 *
 * This was a `motion.div` with `initial={{ opacity: 0, y: 24 }}` and a
 * `whileInView` transition. That writes `style="opacity:0"` into the
 * server-rendered HTML, so the content only became visible once JavaScript had
 * loaded, hydrated, and an IntersectionObserver had fired.
 *
 * It failed in production: one Chrome profile showed the background and header
 * with a blank hero, and clearing site data did not reliably fix it. Forty
 * elements on the homepage were shipping invisible and waiting on a chain of
 * four things to go right.
 *
 * Now the animation lives entirely in `styles/globals.css`. The element's
 * resting state is visible; the `.reveal` class only describes how it arrives.
 * No JavaScript, no observer, no library, and nothing to fail.
 *
 * `delay` staggers a group. It is applied as `animation-delay`, which under
 * `both` fill mode holds the opening frame — so a long delay *is* a period of
 * invisibility. Keep them under ~250ms.
 *
 * Reduced-motion readers never match the rule and see the resting state
 * immediately.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("reveal", className)}
      style={delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  as: Heading = "h2",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  align?: "center" | "left";
  /**
   * The heading level.
   *
   * `h2` by default, because the landing page has exactly one `h1` and it is
   * in the hero. A *standalone* page — `/models`, a model page — opens with
   * this component and therefore needs `h1`, or the document has no top-level
   * heading at all and a screen reader has nothing to land on.
   */
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <Reveal
      className={cn(
        "max-w-2xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow ? (
        <p className="mb-3 text-2xs font-medium tracking-wider text-primary uppercase">
          {eyebrow}
        </p>
      ) : null}

      {/* h2 by default: a landing page has exactly one h1, in the hero, and
          sections that each open with an h1 destroy the document outline that
          screen readers and search engines both navigate by. Pages that open
          with this component pass `as="h1"` instead. */}
      <Heading className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </Heading>

      {description ? (
        <p className="mt-4 text-base text-balance text-muted-foreground sm:text-lg">
          {description}
        </p>
      ) : null}
    </Reveal>
  );
}
