"use client";

import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
import { useState } from "react";

import { useCopy } from "@/features/marketing/i18n";
import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";
import { duration, easing } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

/**
 * FAQ accordion.
 *
 * ## Why the answers are always in the DOM
 *
 * `AnimatePresence` unmounts the closed panels, which would normally be a
 * problem for SEO — a crawler that never runs the interaction sees no answers.
 * The fix is not to keep them mounted and hidden, it is that the same content is
 * emitted as `FAQPage` JSON-LD from `structured-data.tsx`, generated from the
 * same `FAQ` constant. Google reads the structured data; humans read the
 * accordion; neither can drift from the other because there is one source.
 *
 * ## Accessibility
 *
 * Each trigger is a real `<button>` with `aria-expanded` and `aria-controls`.
 * The plus icon rotates 45° into an ×, which is a cheaper and calmer transition
 * than swapping two icons.
 *
 * Height animation uses `height: auto`, which Motion measures for us — the
 * usual alternatives (a fixed max-height, or a CSS grid `1fr` trick) either
 * clip long answers or ease at the wrong rate.
 */
export function Faq() {
  const copy = useCopy();

  /**
   * Everything closed on arrival.
   *
   * The first item used to be expanded, which is a common default and the
   * wrong one here: it makes that one question look answered and the rest look
   * like a list, and it adds height to a section whose whole job is to be
   * skimmed. An accordion that starts closed also gives the reader the shape
   * of what is available before any of it costs them scrolling.
   */
  const [open, setOpen] = useState<number | null>(null);

  return (
    <Section id="faq">
      <SectionHeading
        eyebrow={copy.sections.faq.eyebrow}
        title={copy.sections.faq.title}
        description={copy.sections.faq.description}
      />

      <div className="mx-auto mt-12 max-w-3xl">
        {copy.faq.map((entry, index) => {
          const expanded = open === index;

          return (
            <Reveal key={entry.question} delay={Math.min(index * 0.03, 0.15)}>
              <div className="border-b border-border">
                <h3>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : index)}
                    aria-expanded={expanded}
                    aria-controls={`faq-panel-${index}`}
                    className="flex w-full items-start justify-between gap-6 rounded-lg py-5 text-left focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                  >
                    <span className="text-base font-medium">
                      {entry.question}
                    </span>
                    <Plus
                      className={cn(
                        "mt-0.5 size-5 shrink-0 text-muted-foreground transition-transform duration-300",
                        expanded && "rotate-45 text-primary",
                      )}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </button>
                </h3>

                <AnimatePresence initial={false}>
                  {expanded ? (
                    <motion.div
                      id={`faq-panel-${index}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{
                        duration: duration.normal,
                        ease: easing.out,
                      }}
                      className="overflow-hidden"
                    >
                      <p className="pb-5 text-sm leading-relaxed text-muted-foreground">
                        {entry.answer}
                      </p>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
