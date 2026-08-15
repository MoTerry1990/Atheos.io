"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, Play } from "lucide-react";

import { AnimatedBackground } from "@/features/marketing/components/animated-background";
import { GeneratedImage } from "@/features/marketing/components/generated-image";
import { HeroVideo } from "@/features/marketing/components/hero-video";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/features/marketing/i18n";
import { duration, easing } from "@/components/ui/motion";

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
 * Reduced motion is handled globally by `MotionConfig reducedMotion="user"`,
 * which strips the transforms and leaves the opacity fade. Nothing here branches
 * on the preference, which is what keeps it safe under SSR — see
 * `docs/DESIGN-SYSTEM.md`.
 */

/**
 * Four of the gallery's own generations, reused above the fold.
 *
 * Reused rather than newly generated: these are already in `public/marketing`,
 * already the right aspect ratio, and already carry their prompts. Making four
 * more would have cost provider credit to say the same thing twice.
 *
 * Chosen for contrast against each other — fog, chrome, aurora, neon — so the
 * row reads as range rather than as four versions of one look.
 */
const HERO_PROOF = [
  {
    src: "gallery-1",
    prompt: "Volumetric light through fog, anamorphic lens flare",
  },
  { src: "gallery-2", prompt: "Liquid chrome sculpture, studio reflection" },
  { src: "gallery-3", prompt: "Aurora over black water, long exposure" },
  { src: "gallery-4", prompt: "Neon rain on glass, shallow depth of field" },
] as const;

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.slow, ease: easing.out },
  },
};

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
        <motion.div
          variants={container}
          initial="hidden"
          animate="visible"
          className="mx-auto max-w-3xl text-center"
        >
          <motion.div variants={item}>
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
          </motion.div>

          {/* The two lines are separate variants children so the headline
              assembles itself rather than arriving as one block. */}
          <h1 className="mt-6 text-4xl font-semibold tracking-tighter text-balance sm:text-5xl lg:text-6xl">
            {/* The trailing space is not decorative. Both spans are `block`, so
                it collapses visually — but without it the h1's text content is
                "Every AI model.One interface.", which is what a screen reader
                announces and what a crawler indexes. */}
            <motion.span variants={item} className="block">
              {hero.headline[0]}{" "}
            </motion.span>
            <motion.span
              variants={item}
              className="block text-gradient-brand pb-2"
            >
              {hero.headline[1]}
            </motion.span>
          </h1>

          <motion.p
            variants={item}
            className="mx-auto mt-6 max-w-2xl text-base text-balance text-muted-foreground sm:text-lg"
          >
            {hero.subheadline}
          </motion.p>

          <motion.div
            variants={item}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
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
          </motion.div>

          {/* Real output, above the fold.
          
              This replaced a row of statistics — "3 modalities", "1 credit
              balance" — which were true, abstract, and asked the reader to
              take the product's word for the only thing they came to check.
              Four generations with the prompts that made them settle it in the
              space the numbers occupied.

              `priority` on the first tile only: it is plausibly the LCP
              element, and marking all four would have them compete with each
              other and with the headline. */}
          <motion.ul
            variants={item}
            className="mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {HERO_PROOF.map((tile, tileIndex) => (
              <li
                key={tile.src}
                className="relative aspect-square overflow-hidden rounded-xl ring-1 ring-white/10"
              >
                <GeneratedImage
                  src={tile.src}
                  prompt={tile.prompt}
                  sizes="(max-width: 640px) 50vw, 25vw"
                  priority={tileIndex === 0}
                />
              </li>
            ))}
          </motion.ul>
        </motion.div>
      </div>
    </section>
  );
}
