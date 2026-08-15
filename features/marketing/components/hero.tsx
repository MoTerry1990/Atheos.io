"use client";

import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";

import { AnimatedBackground } from "@/features/marketing/components/animated-background";
import { HeroVideo } from "@/features/marketing/components/hero-video";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/features/marketing/i18n";

/**
 * Hero.
 *
 * The entrance is a single orchestrated sequence rather than each element
 * animating on its own schedule. Independent animations that happen to overlap
 * look accidental; a stagger with one shared easing reads as intent.
 *
 * `initial`/`animate` rather than `whileInView` — the hero is above the fold by
 * definition, and a scroll-triggered animation up here can fail to fire at all
 * if the browser restores a scroll position on reload.
 *
 * Reduced motion is handled by the `.reveal` rule, which only applies under
 * `prefers-reduced-motion: no-preference`,
 * which strips the transforms and leaves the opacity fade. Nothing here branches
 * on the preference, which is what keeps it safe under SSR — see
 * `docs/DESIGN-SYSTEM.md`.
 */

/**
 * Stagger, as `animation-delay` values.
 *
 * These were motion variants with `initial="hidden"` — `opacity: 0` written
 * into the server HTML for the h1, the subheadline and both CTAs. See
 * `styles/globals.css` for why that is gone: the hero is the one part of the
 * page that must never wait on JavaScript to appear.
 *
 * Kept small. Under `both` fill mode the delay is a window in which the
 * element is still transparent, so a long stagger is a long blank hero.
 */
const STAGGER = [0, 0.08, 0.16, 0.24, 0.32] as const;

export function Hero() {
  const { hero } = useCopy();

  return (
    <section className="relative isolate overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
      {/* Video first, then the procedural background on top of it at low
          opacity. The two together read as one surface; the drifting orbs give
          the still poster something to do on the browsers that block autoplay,
          and they mask the loop point on the ones that do not. */}
      <HeroVideo />
      <AnimatedBackground />

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="reveal">
            <a
              href="#showcase"
              className="group inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/50 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              {hero.announcement}
              <ArrowRight
                className="size-3 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </a>
          </div>

          {/* The two lines are separate variants children so the headline
              assembles itself rather than arriving as one block. */}
          <h1 className="mt-6 text-4xl font-semibold tracking-tighter text-balance sm:text-5xl lg:text-6xl">
            {/* The trailing space is not decorative. Both spans are `block`, so
                it collapses visually — but without it the h1's text content is
                "Every AI model.One interface.", which is what a screen reader
                announces and what a crawler indexes. */}
            <span
              className="reveal block"
              style={{ animationDelay: `${STAGGER[1]}s` }}
            >
              {hero.headline[0]}{" "}
            </span>
            <span
              className="reveal block text-gradient-brand pb-2"
              style={{ animationDelay: `${STAGGER[2]}s` }}
            >
              {hero.headline[1]}
            </span>
          </h1>

          <p
            className="reveal mx-auto mt-6 max-w-2xl text-base text-balance text-muted-foreground sm:text-lg"
            style={{ animationDelay: `${STAGGER[3]}s` }}
          >
            {hero.subheadline}
          </p>

          <div
            className="reveal mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
            style={{ animationDelay: `${STAGGER[4]}s` }}
          >
            {/* Full-width buttons on mobile: a centred pill on a 375px screen
                wastes the most valuable real estate on the page. */}
            <Button
              variant="gradient"
              size="lg"
              className="w-full sm:w-auto"
              asChild
            >
              <Link href={hero.primaryCta.href}>
                {hero.primaryCta.label}
                <ArrowRight />
              </Link>
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="w-full sm:w-auto"
              asChild
            >
              <a href={hero.secondaryCta.href}>
                <Play />
                {hero.secondaryCta.label}
              </a>
            </Button>
          </div>

          {/* The four-tile proof strip lived here and has moved.
          
              It was added when the gallery was ninth and the hero had nothing
              but type. "Made with Atheos" is now the third section on the
              page — the same images, with their prompts and a way into the
              studio, one scroll below. Keeping both meant showing the same
              four generations twice within a screen and a half, and it crowded
              the composer that sits directly beneath this. */}
        </div>
      </div>
    </section>
  );
}
