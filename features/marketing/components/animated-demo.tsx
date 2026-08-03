"use client";

import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";
import { cn } from "@/lib/utils";

/**
 * The animated demo.
 *
 * ## What it shows, and what it deliberately does not
 *
 * It replays the **shape** of a generation: a prompt is typed, settings resolve,
 * the job queues, runs, and completes. That sequence is real — it is the actual
 * state machine in `GenerationStatus`, in the real order, with the real labels.
 *
 * What it does **not** do is show output. There is no generated image here and
 * no claim that one appeared, because every image this product could show would
 * either be a stock photo pretending to be model output or mock-provider output
 * pretending to be a real model. Both are the thing the honesty constraint in
 * `ROADMAP.md` § Sprint 2 exists to prevent, and both are trivially caught.
 *
 * So the final frame is the composition surface with the outputs *represented*
 * as tiles, and a caption saying exactly that. A demo that is honest about
 * being a diagram is more persuasive than one a viewer suspects is a mockup.
 *
 * ## It does not run until it is seen, and it stops when it is not
 *
 * `useInView` gates the whole loop. A landing page that runs a timer for a
 * section three screens below the fold burns battery to animate something
 * nobody is looking at — and on a phone that is the difference a visitor
 * actually feels.
 *
 * ## Motion is CSS-transform only
 *
 * Every frame animates `opacity` and `transform`. Nothing here triggers layout,
 * which is what keeps this section off the critical path for CLS — the
 * container is a fixed aspect ratio and the contents move inside it.
 */

interface Frame {
  id: string;
  label: string;
  caption: string;
  /** Progress through the sequence, 0–1, for the rail. */
  progress: number;
}

const FRAMES: readonly Frame[] = [
  {
    id: "prompt",
    label: "Prompt",
    caption: "A slow push through morning fog over still water",
    progress: 0.12,
  },
  {
    id: "model",
    label: "Model",
    caption: "Routed to the cheapest model that supports the operation",
    progress: 0.34,
  },
  {
    id: "queued",
    label: "Queued",
    caption: "Credits reserved · job owned by a server-side worker",
    progress: 0.56,
  },
  {
    id: "running",
    label: "Running",
    caption: "Close the tab if you like — the worker keeps going",
    progress: 0.78,
  },
  {
    id: "done",
    label: "Complete",
    caption: "Stored, priced, and filed into the project",
    progress: 1,
  },
];

const FRAME_MS = 2_200;

export function AnimatedDemo() {
  const ref = useRef<HTMLDivElement>(null);
  // `amount: 0.4` rather than the default: the section is tall, and starting
  // the loop the instant one pixel enters means it is half over by the time it
  // is actually readable.
  const inView = useInView(ref, { amount: 0.4 });
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!inView) return;

    const timer = setInterval(
      () => setIndex((current) => (current + 1) % FRAMES.length),
      FRAME_MS,
    );

    return () => clearInterval(timer);
  }, [inView]);

  const frame = FRAMES[index];

  return (
    <Section id="demo">
      <SectionHeading
        eyebrow="How it runs"
        title="Describe it once. The engine handles the rest."
        description="Model selection, credit reservation, retries, provider failover and storage are all decided server-side. The interface stays a prompt and a button."
      />

      <div ref={ref} className="mt-10">
        <div
          className={cn(
            "relative overflow-hidden rounded-xl border border-border bg-card",
            // Fixed ratio so nothing below shifts as frames change. The whole
            // sequence happens inside a box whose size never varies.
            "aspect-[16/9] sm:aspect-[2/1]",
          )}
        >
          {/* Chrome. Static, so the eye has a fixed frame to read against. */}
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
            <span aria-hidden className="size-2 rounded-full bg-muted" />
            <span aria-hidden className="size-2 rounded-full bg-muted" />
            <span aria-hidden className="size-2 rounded-full bg-muted" />
            <span className="ml-2 font-mono text-2xs text-muted-foreground">
              atheos.io/studio
            </span>
          </div>

          <div className="grid h-[calc(100%-2.25rem)] grid-cols-[1fr] sm:grid-cols-[13rem_1fr]">
            {/* Step rail. Doubles as the progress indicator. */}
            <ol className="hidden flex-col gap-1 border-r border-border p-3 sm:flex">
              {FRAMES.map((entry, entryIndex) => (
                <li key={entry.id}>
                  <div
                    className={cn(
                      "relative rounded-md px-2.5 py-1.5 text-xs transition-colors",
                      entryIndex === index
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {entryIndex === index ? (
                      <motion.span
                        aria-hidden
                        layoutId="demo-step"
                        className="absolute inset-0 rounded-md bg-accent"
                        transition={{
                          type: "spring",
                          stiffness: 380,
                          damping: 34,
                        }}
                      />
                    ) : null}
                    <span className="relative">{entry.label}</span>
                  </div>
                </li>
              ))}
            </ol>

            <div className="relative grid place-items-center p-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={frame.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.32, ease: [0.25, 1, 0.5, 1] }}
                  className="w-full max-w-md text-center"
                >
                  {frame.id === "done" ? (
                    <div className="grid grid-cols-2 gap-2">
                      {[0, 1, 2, 3].map((tile) => (
                        <motion.div
                          key={tile}
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{
                            delay: tile * 0.06,
                            duration: 0.3,
                            ease: [0.25, 1, 0.5, 1],
                          }}
                          className="aspect-[4/3] rounded-md border border-border bg-gradient-brand-subtle"
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="font-mono text-sm leading-relaxed text-foreground">
                      {frame.caption}
                    </p>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Progress. `scaleX` rather than width — composited, so this
                  animates on the GPU and never triggers layout. */}
              <div className="absolute inset-x-4 bottom-3 h-0.5 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full w-full origin-left rounded-full bg-gradient-brand"
                  animate={{ scaleX: frame.progress }}
                  transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline" size="sm">
            Illustration
          </Badge>
          <p className="text-xs text-muted-foreground">
            {frame.id === "done" ? (
              <>
                Tiles represent where results appear — this is a diagram of the
                flow, not generated output.
              </>
            ) : (
              frame.caption
            )}
          </p>
        </div>

        {/* The sequence in text, for anyone who cannot see the animation or has
            reduced motion on. The loop is decorative; the information is not. */}
        <p className="sr-only">
          The generation flow: a prompt is written, a model is selected
          automatically, credits are reserved and the job is queued, a
          server-side worker runs it, and the results are stored and filed into
          a project.
        </p>
      </div>
    </Section>
  );
}
