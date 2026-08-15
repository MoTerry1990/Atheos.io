import type { PlanTier } from "@/lib/generated/prisma/enums";

/**
 * The shape every language must fill.
 *
 * ## Text only — never numbers, icons or hues
 *
 * A dictionary that carries a price is a dictionary that will eventually carry
 * a *different* price in one language. Money, credit allowances, model
 * capabilities and artwork seeds stay in `services/billing/catalogue.ts` and
 * `features/marketing/content.ts`, and are merged with this by index or by
 * tier at render time. The translator's job is words.
 *
 * ## Arrays are positional
 *
 * `showcase[1]` is the video tab in every language, because the icon and the
 * hue for that tab live in code at the same index. A translation that reorders
 * or drops an entry silently mismatches the artwork, so a test asserts the
 * lengths agree across locales.
 */

export interface LinkCopy {
  label: string;
  href: string;
}

export interface SectionCopy {
  eyebrow: string;
  title: string;
  description: string;
  /** An extra line beneath the section, where one is needed. */
  note?: string;
}

export interface MarketingCopy {
  /** Headings for each band of the landing page. */
  sections: {
    showcase: SectionCopy;
    features: SectionCopy;
    howItWorks: SectionCopy;
    templates: SectionCopy;
    gallery: SectionCopy;
    faq: SectionCopy;
  };

  site: {
    tagline: string;
    description: string;
  };

  nav: readonly LinkCopy[];

  /** Sign-in / sign-up, in the header. */
  auth: {
    signIn: string;
    signUp: string;
    dashboard: string;
  };

  hero: {
    announcement: string;
    headline: readonly [string, string];
    subheadline: string;
    primaryCta: LinkCopy;
    secondaryCta: LinkCopy;
    stats: readonly { value: string; label: string }[];
  };

  /**
   * The composer that sits under the hero.
   *
   * `note` is not decoration — it is the sentence that stops the field
   * pretending to generate. See `home-composer.tsx`.
   */
  composer: {
    placeholder: string;
    modalities: readonly { id: "image" | "video"; label: string }[];
    cta: string;
    note: string;
  };

  trustedBy: { label: string };

  showcase: readonly {
    label: string;
    headline: string;
    body: string;
    bullets: readonly string[];
  }[];

  features: readonly { title: string; body: string }[];

  steps: readonly { title: string; body: string }[];

  templates: readonly { title: string; category: string; body: string }[];

  /** Prompt captions on the gallery tiles. */
  gallery: readonly string[];

  pricing: {
    eyebrow: string;
    title: string;
    description: string;
    monthly: string;
    yearly: string;
    yearlySave: string;
    mostPopular: string;
    perMonth: string;
    forever: string;
    billedYearly: string;
    save: string;
    creditsMonthly: (credits: string) => string;
    ctaFree: string;
    ctaChoose: (plan: string) => string;
    note: string;
  };

  /** Plan names and selling points, by tier. Prices come from the catalogue. */
  plans: Record<
    PlanTier,
    { name: string; description: string; features: readonly string[] }
  >;

  packs: {
    eyebrow: string;
    title: string;
    description: string;
    pack: string;
    price: string;
    videos: string;
    images: string;
    credits: (count: string) => string;
    note: string;
  };

  comparison: {
    eyebrow: string;
    title: string;
    description: string;
    feature: string;
    caption: string;
    free: string;
    perMonth: string;
    included: string;
    notIncluded: string;
    rows: readonly { label: string; note?: string }[];
    /** Cell values that are words rather than ticks. */
    values: {
      community: string;
      email: string;
      allSix: string;
    };
  };

  enterprise: {
    eyebrow: string;
    title: string;
    body: readonly [string, string];
    cta: string;
    needsTitle: string;
    needs: readonly string[];
  };

  faq: readonly { question: string; answer: string }[];

  footer: {
    groups: readonly { title: string; links: readonly LinkCopy[] }[];
    note: string;
    rights: string;
  };

  language: {
    label: string;
  };
}
