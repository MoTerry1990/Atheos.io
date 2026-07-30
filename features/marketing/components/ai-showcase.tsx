"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { useState } from "react";

import { Artwork } from "@/features/marketing/components/artwork";
import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";
import { SHOWCASE } from "@/features/marketing/content";
import { duration, easing } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

/**
 * Product showcase — one panel per modality.
 *
 * Two details doing real work:
 *
 * **`layoutId` on the tab pill.** The active-tab background is a single element
 * that Motion animates between positions, so the highlight *slides* rather than
 * disappearing and reappearing. It is a small effect that accounts for most of
 * why a tab bar feels expensive.
 *
 * **`mode="wait"` on the panel.** The outgoing panel finishes before the
 * incoming one starts. Without it both are mounted at once, the container jumps
 * to fit whichever is taller, and the whole page shifts underneath the reader.
 *
 * Tabs are real buttons with `aria-selected`, not styled divs, so the section is
 * operable by keyboard and announced correctly.
 */
export function AIShowcase() {
  const [active, setActive] = useState(SHOWCASE[0].id);
  const panel = SHOWCASE.find((tab) => tab.id === active) ?? SHOWCASE[0];

  return (
    <Section id="showcase">
      <SectionHeading
        eyebrow="The product"
        title="Three modalities. One pipeline."
        description="Image, video and audio share the same jobs, the same library and the same credits. Nothing here is a second product bolted on beside the first."
      />

      <Reveal delay={0.05} className="mt-12">
        <div
          role="tablist"
          aria-label="Modalities"
          className="mx-auto flex w-fit gap-1 rounded-xl border border-border bg-surface-sunken p-1"
        >
          {SHOWCASE.map((tab) => {
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`panel-${tab.id}`}
                onClick={() => setActive(tab.id)}
                className={cn(
                  "relative flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                  selected
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {selected ? (
                  <motion.span
                    layoutId="showcase-pill"
                    className="absolute inset-0 rounded-lg bg-card elevation-raised"
                    transition={{ duration: duration.normal, ease: easing.out }}
                  />
                ) : null}
                <tab.icon
                  className="relative size-4"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="relative">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </Reveal>

      <div className="mt-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={panel.id}
            id={`panel-${panel.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${panel.id}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: duration.normal, ease: easing.out }}
            className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
          >
            <div>
              <h3 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                {panel.headline}
              </h3>
              <p className="mt-4 text-base text-muted-foreground">
                {panel.body}
              </p>

              <ul className="mt-8 space-y-3">
                {panel.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Check className="size-3" strokeWidth={2.5} aria-hidden />
                    </span>
                    <span className="text-sm">{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Order flips on mobile so the artwork does not push the copy
                below the fold on a phone. */}
            <div className="order-first lg:order-last">
              <Artwork
                hue={panel.hue}
                seed={panel.hue}
                rich
                className="aspect-[4/3] w-full ring-1 ring-white/10"
              />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </Section>
  );
}
