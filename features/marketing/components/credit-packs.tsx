import { PACK_DEFINITIONS, formatMoney } from "@/services/billing/catalogue";
import { getCopy } from "@/features/marketing/i18n/dictionaries";
import type { Locale } from "@/features/marketing/i18n/locales";
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

export function CreditPacks({ locale }: { locale: Locale }) {
  const { packs } = getCopy(locale);

  return (
    <Section id="credits">
      <SectionHeading
        eyebrow={packs.eyebrow}
        title={packs.title}
        description={packs.description}
      />

      <Reveal delay={0.05} className="mt-10">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">{packs.description}</caption>
            <thead className="bg-surface-sunken">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium">
                  {packs.pack}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {packs.price}
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-3 text-right font-medium sm:table-cell"
                >
                  {packs.videos}
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-3 text-right font-medium sm:table-cell"
                >
                  {packs.images}
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
                      {packs.credits(pack.credits.toLocaleString("en-US"))}
                    </th>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(pack.amount)}
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
          {packs.note}
        </p>
      </Reveal>
    </Section>
  );
}
