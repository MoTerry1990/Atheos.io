import {
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";

/**
 * Testimonials.
 *
 * ## There are none, because there are no customers
 *
 * Atheos has never launched. It has zero users, and therefore zero people who
 * could have said anything about it. `ROADMAP.md` recorded the constraint in
 * Sprint 2 and it has held through twenty-one sprints: no invented customer
 * logos, no fabricated metrics, no `aggregateRating` in structured data without
 * real reviews.
 *
 * A testimonials section is the single most tempting place to break that. It is
 * also the place where breaking it does the most damage — a fake quote with a
 * fake name and a fake job title is fraud, it is what a reader checks first,
 * and one discovered fake makes every true claim on the page suspect.
 *
 * ## So the component renders nothing until `TESTIMONIALS` has entries
 *
 * Not a placeholder. Not "coming soon". Not three lorem-ipsum cards with stock
 * avatars waiting to be filled in — those get shipped by accident.
 * `TESTIMONIALS` is an empty array, this returns `null`, and the section simply
 * is not on the page.
 *
 * This is the same pattern the product already uses in two other places, for
 * the same reason: trending returns empty rather than falling back to recent
 * (§ 34), and featured creators stays blank until somebody is featured. A
 * surface with nothing real to show shows nothing.
 *
 * ## What to do instead of waiting
 *
 * The page already carries the proof it can honestly make. `TrustedBy` names
 * the actual infrastructure — verifiable, and it answers what a technical buyer
 * is really asking. `AIModels` reads the engine's own catalogue and prints how
 * many providers are genuinely connected, including the number that are not.
 *
 * Neither is a testimonial. Both are evidence, which is what a testimonial is
 * supposed to be a proxy for.
 */

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  /** Only set once the person has agreed in writing to be quoted. */
  consented: boolean;
}

/**
 * Real quotes only.
 *
 * Adding an entry is a statement that a named person said this and agreed to be
 * quoted. If that is not true of a line, it does not go here — there is no
 * "representative" or "composite" testimonial, because a composite is a
 * fabrication with extra steps.
 */
export const TESTIMONIALS: readonly Testimonial[] = [];

export function Testimonials() {
  const usable = TESTIMONIALS.filter((entry) => entry.consented);

  // Nothing real to show, so nothing is shown. Deliberately not a placeholder:
  // an empty state here would be an advertisement for the absence.
  if (usable.length === 0) return null;

  return (
    <Section id="testimonials">
      <SectionHeading eyebrow="From users" title="What people build with it" />

      <ul className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {usable.map((entry) => (
          <li key={`${entry.name}-${entry.quote.slice(0, 24)}`}>
            <figure className="flex h-full flex-col rounded-xl border border-border bg-card p-5">
              <blockquote className="flex-1 text-sm leading-relaxed">
                {entry.quote}
              </blockquote>
              <figcaption className="mt-4 text-xs">
                <span className="font-medium">{entry.name}</span>
                <span className="text-muted-foreground"> · {entry.role}</span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </Section>
  );
}
