import { PACK_DEFINITIONS } from "@/services/billing/catalogue";
import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";

/**
 * One-off credit packs.
 *
 * Sits below the subscription tiers because it answers a different question:
 * not "which plan am I" but "I need more, once". Two people buy these — the
 * one who has finished their free credits and is not ready to commit monthly,
 * and the subscriber who has an unusually heavy week.
 *
 * Shown as a plain price table rather than as cards competing with the plans
 * above. A top-up is not a tier and should not look like one.
 */

/** What a pack is worth, in the units a buyer actually thinks in. */
function outcomes(credits: number) {
  // The fast video model is 90 credits; a standard image is 4.
  const videos = Math.floor(credits / 90);
  const images = Math.floor(credits / 4);
  return { videos, images };
}

export function CreditPacks() {
  return (
    <Section id="credits">
      <SectionHeading
        eyebrow="Top-ups"
        title="Or buy credits when you need them"
        description="One-off packs, no subscription. They never expire and they stack on top of a plan's monthly allowance."
      />

      <Reveal delay={0.05} className="mt-10">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">
              One-off credit packs, showing price and what each pack generates
            </caption>
            <thead className="bg-surface-sunken">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium">
                  Pack
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Price
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-3 text-right font-medium sm:table-cell"
                >
                  Videos
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-3 text-right font-medium sm:table-cell"
                >
                  Images
                </th>
              </tr>
            </thead>
            <tbody>
              {PACK_DEFINITIONS.map((pack) => {
                const { videos, images } = outcomes(pack.credits);
                return (
                  <tr key={pack.id} className="border-t border-border">
                    <th
                      scope="row"
                      className="px-4 py-3 text-left font-medium whitespace-nowrap"
                    >
                      {pack.name}
                    </th>
                    <td className="px-4 py-3 text-right tabular-nums">
                      ${(pack.amount / 100).toFixed(2)}
                    </td>
                    <td className="hidden px-4 py-3 text-right text-muted-foreground tabular-nums sm:table-cell">
                      {videos}
                    </td>
                    <td className="hidden px-4 py-3 text-right text-muted-foreground tabular-nums sm:table-cell">
                      {images}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-muted-foreground">
          Video counts assume the standard model at five seconds. Longer clips
          and the higher-quality model cost more — the studio shows the exact
          price before you generate, never after.
        </p>
      </Reveal>
    </Section>
  );
}
