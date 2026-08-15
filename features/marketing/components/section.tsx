"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { duration, easing } from "@/components/ui/motion";
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
 * Scroll-triggered reveal.
 *
 * `once: true` — re-animating on every scroll past turns a long page into a
 * flicker. The negative bottom margin starts the animation slightly before the
 * element reaches the fold so it has settled by the time it is actually looked
 * at, rather than animating in the centre of the screen.
 *
 * ## Reduced motion renders a plain div, with no hidden initial state
 *
 * `MotionConfig reducedMotion="user"` in `providers/motion-provider` already
 * suppresses the 24px translate. It does **not** suppress the opacity fade —
 * motion treats opacity as a non-vestibular property and keeps animating it —
 * so a reduced-motion reader still got 41 elements fading in on scroll.
 *
 * Skipping the wrapper entirely is better than shortening the fade, for a
 * reason beyond preference. `initial={{ opacity: 0 }}` is written into the
 * server HTML as an inline style, so those 40 elements — the h1, every h2, the
 * composer, both hero CTAs — arrive **invisible** and depend on JavaScript
 * running *and* an IntersectionObserver firing to appear. That normally
 * happens in milliseconds. When it does not, the page is blank.
 *
 * It has happened here before: `providers/index.tsx` records a period when
 * `ClerkProvider` threw during hydration and "every animation sat frozen at
 * its initial value" — a homepage that server-rendered perfectly and showed
 * nothing. Removing the hidden initial state for the readers who asked for
 * less motion narrows that blast radius at no cost to anybody else.
 *
 * The `useReducedMotion()` hook returns null on the server and resolves after
 * mount, so the server always emits the animated branch and hydration matches.
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
  const reduced = useReducedMotion();

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -100px 0px" }}
      transition={{ duration: duration.slow, ease: easing.out, delay }}
      className={className}
    >
      {children}
    </motion.div>
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
