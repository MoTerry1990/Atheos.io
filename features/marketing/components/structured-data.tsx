import { PRICING, SITE } from "@/features/marketing/content";
import { getCopy } from "@/features/marketing/i18n/dictionaries";
import { HTML_LANG, type Locale } from "@/features/marketing/i18n/locales";
import { env } from "@/lib/env";

/**
 * JSON-LD structured data.
 *
 * Three schemas, each doing a specific job in search results:
 *
 *   Organization        establishes the entity — the knowledge-panel anchor
 *   SoftwareApplication categorises the product and surfaces the price range
 *   FAQPage             makes the FAQ eligible for expandable rich results
 *
 * Everything is generated from the same constants the visible page renders.
 * Structured data that disagrees with the page is treated by Google as
 * spam — worse than having none — and hand-maintained duplicates always drift.
 *
 * ## On `dangerouslySetInnerHTML`
 *
 * It is the documented way to emit JSON-LD, and it is safe *here* specifically
 * because every value is an author-controlled constant from `content.ts`. If
 * user-supplied text ever reaches this file, the `<` characters must be escaped
 * first — the string is injected into a `<script>` element verbatim.
 */
export function StructuredData({ locale }: { locale: Locale }) {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;
  const copy = getCopy(locale);

  const paidTiers = PRICING.filter((tier) => tier.monthly > 0);
  const lowest = Math.min(...paidTiers.map((tier) => tier.monthly));
  const highest = Math.max(...paidTiers.map((tier) => tier.monthly));

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${baseUrl}/#organization`,
        name: SITE.name,
        url: baseUrl,
        description: copy.site.description,
        logo: `${baseUrl}/opengraph-image`,
      },
      {
        "@type": "WebSite",
        "@id": `${baseUrl}/#website`,
        url: baseUrl,
        name: SITE.name,
        description: copy.site.description,
        publisher: { "@id": `${baseUrl}/#organization` },
        inLanguage: HTML_LANG[locale],
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${baseUrl}/#software`,
        name: SITE.name,
        applicationCategory: "MultimediaApplication",
        operatingSystem: "Web",
        description: copy.site.description,
        url: baseUrl,
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "USD",
          lowPrice: lowest,
          highPrice: highest,
          offerCount: PRICING.length,
        },
        // Deliberately no `aggregateRating`. Inventing review scores is both
        // a policy violation and the sort of thing that gets a site
        // manually penalised. We will add it when there are real reviews.
      },
      {
        "@type": "FAQPage",
        "@id": `${baseUrl}/#faq`,
        mainEntity: copy.faq.map((entry) => ({
          "@type": "Question",
          name: entry.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: entry.answer,
          },
        })),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
