import { STEPS } from "@/features/marketing/content";
import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";

/**
 * The four-step process.
 *
 * An ordered list, semantically — `<ol>`, because the order is the content. A
 * div soup with numbers typed into it looks identical and tells a screen reader
 * nothing about sequence.
 *
 * The connecting rail is drawn once behind the whole list rather than as a
 * border on each item, so it does not appear below the final step where there
 * is nothing left to connect to.
 */
export function HowItWorks() {
  return (
    <Section id="how-it-works" className="border-y bg-surface-sunken/40">
      <SectionHeading
        eyebrow="How it works"
        title="Four steps, no ceremony"
        description="From an idea to something in your library, with the parts that usually go wrong handled for you."
      />

      <ol className="relative mx-auto mt-14 max-w-3xl">
        {/* The rail. Stops short of the last marker so it does not dangle. */}
        <div
          aria-hidden
          className="absolute top-2 bottom-16 left-[1.4rem] w-px bg-gradient-to-b from-primary/40 via-primary/20 to-transparent sm:left-[1.65rem]"
        />

        {STEPS.map((step, index) => (
          <li key={step.number} className="relative">
            <Reveal delay={Math.min(index * 0.08, 0.32)}>
              <div className="flex gap-5 pb-12 sm:gap-7">
                <span
                  className={
                    "relative z-10 flex size-11 shrink-0 border-primary/30 bg-background text-primary " +
                    "items-center justify-center rounded-full border font-mono text-sm font-medium sm:size-14"
                  }
                >
                  {step.number}
                </span>

                <div className="pt-1.5 sm:pt-3">
                  <h3 className="text-lg font-semibold tracking-tight">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </Section>
  );
}
