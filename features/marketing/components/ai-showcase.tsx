"use client";

import { motion } from "motion/react";
import { Check } from "lucide-react";
import { useRef, useState } from "react";

import { GeneratedImage } from "@/features/marketing/components/generated-image";
import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";
import { SHOWCASE } from "@/features/marketing/content";
import { useCopy } from "@/features/marketing/i18n";
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
 * **No `AnimatePresence`.** There used to be one, wrapping the panel with
 * `mode="wait"`, and it broke the feature outright: the outgoing panel's exit
 * animation never reported completion, so the incoming panel was never mounted.
 * Clicking Video set `aria-selected="true"` and left the Image panel on screen
 * indefinitely — two of the three things Atheos sells were invisible on its own
 * homepage, behind tabs that looked like they worked.
 *
 * A keyed `motion.div` with no exit variant is what replaced it. React unmounts
 * the old panel and mounts the new one because the `key` changed, which is a
 * guarantee; the entry animation is decoration on top of that. Nothing about a
 * tab panel needs an exit animation, and the one it had was load-bearing in
 * exactly the wrong way.
 *
 * Tabs are real buttons with `aria-selected`, not styled divs, so the section is
 * operable by keyboard and announced correctly.
 */
export function AIShowcase() {
  const copy = useCopy();
  const [active, setActive] = useState(SHOWCASE[0].id);

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /**
   * Arrow keys move between tabs; Home and End jump to the ends.
   *
   * Selection follows focus, which is the right choice here because switching
   * panels costs nothing — no request, no loss of work. Where it *does* cost
   * something the pattern is to require Enter, and this is not that case.
   *
   * Wrapping at both ends rather than stopping: a three-item group is small
   * enough that hitting a wall reads as a broken control.
   */
  function onTabKeyDown(event: React.KeyboardEvent, index: number) {
    const last = SHOWCASE.length - 1;

    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;

    if (next === null) return;

    event.preventDefault();
    const tab = SHOWCASE[next];
    if (!tab) return;

    setActive(tab.id);
    tabRefs.current[next]?.focus();
  }

  // Index rather than the object, because the artwork (icon, hue) lives in
  // `SHOWCASE` and the words live in the dictionary. They are joined here and
  // a test asserts the two arrays stay the same length.
  const index = Math.max(
    0,
    SHOWCASE.findIndex((tab) => tab.id === active),
  );
  const panel = SHOWCASE[index];
  const panelCopy = copy.showcase[index];

  return (
    <Section id="showcase">
      <SectionHeading
        eyebrow={copy.sections.showcase.eyebrow}
        title={copy.sections.showcase.title}
        description={copy.sections.showcase.description}
      />

      <Reveal delay={0.05} className="mt-12">
        <div
          role="tablist"
          aria-label="Modalities"
          className="mx-auto flex w-fit gap-1 rounded-xl border border-border bg-surface-sunken p-1"
        >
          {SHOWCASE.map((tab, tabIndex) => {
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
                onKeyDown={(event) => onTabKeyDown(event, tabIndex)}
                /**
                 * Only the selected tab is reachable by Tab.
                 *
                 * The tablist pattern makes the whole group one stop and moves
                 * *within* it using the arrow keys. Leaving every tab
                 * focusable makes a three-item group three stops on the way to
                 * the panel, which is the difference between a tablist and
                 * three buttons that look like one.
                 */
                tabIndex={selected ? 0 : -1}
                ref={(node) => {
                  tabRefs.current[tabIndex] = node;
                }}
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
                <span className="relative">
                  {copy.showcase[tabIndex]?.label}
                </span>
              </button>
            );
          })}
        </div>
      </Reveal>

      <div className="mt-10">
        <motion.div
          key={panel.id}
          id={`panel-${panel.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${panel.id}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: duration.normal, ease: easing.out }}
          className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
        >
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {panelCopy?.headline}
            </h3>
            <p className="mt-4 text-base text-muted-foreground">
              {panelCopy?.body}
            </p>

            <ul className="mt-8 space-y-3">
              {(panelCopy?.bullets ?? []).map((bullet) => (
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
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl ring-1 ring-white/10">
              <GeneratedImage
                src={`showcase-${panel.id}`}
                prompt={panelCopy?.headline ?? ""}
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
          </div>
        </motion.div>
      </div>
    </Section>
  );
}
