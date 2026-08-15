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

export function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      // scroll-mt clears the fixed header when an anchor link lands here.
      // Without it every in-page link puts the heading underneath the nav.
      className={cn("scroll-mt-20 py-20 sm:py-28", className)}
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
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  align?: "center" | "left";
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

      {/* h2 throughout: the page has exactly one h1, in the hero. Sections that
          each open with an h1 destroy the document outline that screen readers
          and search engines both navigate by. */}
      <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>

      {description ? (
        <p className="mt-4 text-base text-balance text-muted-foreground sm:text-lg">
          {description}
        </p>
      ) : null}
    </Reveal>
  );
}
