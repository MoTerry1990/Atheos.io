import {
  Coins,
  Layers,
  Lock,
  Music,
  Sparkles,
  Video,
  Wand2,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";

import { visiblePlanDefinitions } from "@/services/billing/catalogue";
import type { PlanTier } from "@/lib/generated/prisma/enums";

/**
 * Everything about the landing page that is **not** words.
 *
 * Until the site became bilingual this module held the copy too. It cannot any
 * more: two languages means two sets of words, and a module exporting one of
 * them is a module that will eventually render on the wrong page. The text
 * moved to `features/marketing/i18n/{en,es}.ts`. What stays here is the data
 * that reads the same in every language — icons, hues, artwork seeds, layout
 * flags, and the numbers that come from the billing catalogue.
 *
 * The two halves are joined **by index** at render time, so these arrays and
 * their dictionary counterparts must stay the same length and in the same
 * order. `tests/unit/marketing-i18n.test.ts` asserts exactly that, because the
 * failure is silent: a missing entry renders a card with no text rather than
 * throwing.
 *
 * **Nothing here asserts a fact we cannot back up.** No fabricated customer
 * counts, no invented logos, no made-up testimonials. Placeholder social proof
 * is a liability, not a growth tactic — see `TRUSTED_BY`.
 */

export const SITE = {
  // The wordmark, shown in the sidebar, the page title and every OG image.
  // `Atheos.io` rather than `Atheos` — the domain is the brand here, and the
  // two being different is the kind of inconsistency people notice without
  // being able to say why.
  //
  // The name and the domain read the same in every language. The tagline and
  // the description do not, and live in the dictionaries.
  name: "Atheos.io",
  domain: "atheos.io",
} as const;

/* -------------------------------------------------------------------------- */
/* Trusted by                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The infrastructure Atheos is built on — not a customer list.
 *
 * A pre-launch product does not have logos to show, and inventing them is
 * fraud dressed as marketing. Naming the stack is credible, verifiable, and
 * genuinely reassuring to a technical buyer deciding whether this is a weekend
 * project.
 *
 * Product names, so they are never translated. Only the label above them is.
 */
export const TRUSTED_BY = [
  "Next.js",
  "Vercel",
  "PostgreSQL",
  "Stripe",
  "Clerk",
  "Cloudflare",
  "Supabase",
  "Prisma",
] as const;

/* -------------------------------------------------------------------------- */
/* Showcase                                                                    */
/* -------------------------------------------------------------------------- */

export interface ShowcaseTab {
  id: string;
  icon: LucideIcon;
  /** Drives the procedural artwork rendered alongside. */
  hue: number;
}

export const SHOWCASE: readonly ShowcaseTab[] = [
  { id: "image", icon: ImageIcon, hue: 303 },
  { id: "video", icon: Video, hue: 237 },
  { id: "audio", icon: Music, hue: 162 },
] as const;

/* -------------------------------------------------------------------------- */
/* Features                                                                    */
/* -------------------------------------------------------------------------- */

export interface Feature {
  icon: LucideIcon;
  /** Spans two columns on wide screens. */
  wide?: boolean;
  /**
   * A generation under `public/marketing`, without the extension.
   *
   * Only the wide cards have one — see the note in `features.tsx`.
   */
  image?: string;
}

export const FEATURES: readonly Feature[] = [
  { icon: Layers, wide: true, image: "feature-library" },
  { icon: Coins },
  { icon: Lock },
  { icon: Wand2, wide: true, image: "feature-craft" },
] as const;

/* -------------------------------------------------------------------------- */
/* How it works                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Step markers.
 *
 * The words are in the dictionaries; what stays is the count and the numeral
 * on each marker, which reads the same in every language.
 */
export const STEPS = [
  { number: "01" },
  { number: "02" },
  { number: "03" },
] as const;

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export interface Template {
  hue: number;
  /** The still under `public/marketing`, without the extension. */
  image: string;
  /** Carried into the studio, so the card makes what it shows. */
  modality: "image" | "video";
  prompt: string;
}

/**
 * Four, not six.
 *
 * `prompt` and `modality` are what a card is *for*: clicking one used to send
 * every visitor to the same `/studio` with nothing carried, which made six
 * distinct-looking cards six identical links. Now each one opens the studio
 * with its own prompt already in the field.
 *
 * The prompts match `template-N.webp` in `public/marketing`, which are the
 * images these cards show — so the card previews what it will make.
 */
export const TEMPLATES: readonly Template[] = [
  {
    hue: 303,
    image: "template-1",
    modality: "image",
    prompt:
      "A matte black perfume bottle on a seamless backdrop, studio lighting, controlled reflections, product photography",
  },
  {
    hue: 262,
    image: "template-2",
    modality: "image",
    prompt:
      "Cinematic film still, lone figure in a corridor, anamorphic framing, practical light, shallow depth of field",
  },
  {
    hue: 237,
    image: "template-3",
    modality: "image",
    prompt:
      "Editorial portrait, soft key light, rim separation, neutral colour science, magazine cover quality",
  },
  {
    hue: 162,
    image: "template-5",
    modality: "video",
    prompt:
      "Abstract looping motion graphic, flowing ribbons of light, seamless cycle",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Pricing                                                                     */
/* -------------------------------------------------------------------------- */

export interface PricingTier {
  id: string;
  /** The catalogue key, used to look up translated names and bullets. */
  tier: PlanTier;
  /** Per month, billed monthly. **Minor units** — format at the point of use. */
  monthly: number;
  /**
   * The allowance, already grouped — "1,800". The unit noun is translated.
   *
   * **Null when it has not been settled yet.** The card renders a "confirmed at
   * launch" line instead of a number. A pricing page that prints a credit count
   * the backend cannot safely honour is a promise, and the first customer to
   * count their credits is the one who finds out it was a guess.
   */
  credits: string | null;
  featured?: boolean;
  /** `launch_disabled` plans show a price and cannot be bought yet. */
  status: "active" | "launch_disabled" | "retired";
}

/**
 * Derived from the billing catalogue, not written twice.
 *
 * `services/billing/catalogue.ts` owns the numbers; this shapes them for a
 * marketing card. Two lists would eventually advertise one price and charge
 * another, and the buyer would find out at the card form.
 *
 * Imported from `catalogue` rather than `plans` on purpose: this module reaches
 * client components, and `plans` reads server environment variables.
 *
 * Money stays in minor units all the way to the component, which formats it
 * once. Names and feature bullets come from the dictionary, keyed by `tier`.
 */
export const PRICING: readonly PricingTier[] = visiblePlanDefinitions().map(
  (plan) => ({
    id: plan.tier.toLowerCase(),
    tier: plan.tier,
    monthly: plan.monthly,
    credits: plan.monthlyCredits?.toLocaleString("en-US") ?? null,
    featured: plan.featured,
    status: plan.status,
  }),
);

export { Sparkles };

/* -------------------------------------------------------------------------- */
/* Made with Atheos                                                            */
/* -------------------------------------------------------------------------- */

export interface MadeItem {
  kind: "image" | "video";
  /** Poster/still under `public/marketing`, without the extension. */
  poster: string;
  /** Absolute path to the clip. Only for `kind: "video"`. */
  video?: string;
  /** The prompt that produced it. Shown on the card and carried into the studio. */
  prompt: string;
  /**
   * Display name of the model, **only when it is known**.
   *
   * Optional rather than defaulted: a card claiming to be real output with an
   * invented model name attached would undo the entire point of the section.
   */
  model?: string;
}

/**
 * The discovery grid.
 *
 * Every entry is genuine output, shown with the prompt that produced it.
 * Nothing here is stock, and nothing is a placeholder.
 *
 * ## The four clips this file spent two sprints asking for
 *
 * It used to say "only two videos exist, and the Replicate account is out of
 * credit, so more cannot honestly be made right now" — and then refused to pad
 * the grid rather than repeat a clip or dress an image as a video card.
 *
 * Sprint 4.4 made them. `made-video-3` … `made-video-6` come from the same
 * pinned `wan-2.2-t2v-fast` version the product's `replicate/video-gen` model
 * resolves to, generated by `scripts/generate-sprint44-assets.mjs` for $0.81
 * against an authorised $1.50. Four different subjects — fashion, product,
 * surreal, environment — because the grid exists to show range, and four
 * variations on drifting particles would have shown none.
 *
 * ## Why the two original video cards are gone
 *
 * They borrowed `hero-poster` and `auth-poster`, which were framed 1.75 and
 * 0.57 for a 0.80 tile: the first lost 54% of its width to the crop. The new
 * clips are 720x1280 portrait with their own frame-0 posters, so the poster and
 * the first frame are the same image and the hover crossfade does not jump.
 * `hero.mp4` and `auth.mp4` are still the hero and auth-panel backgrounds —
 * they were only ever wrong *here*.
 *
 * **They are not a perfect fit either, and the difference is written down.**
 * `wan-2.2-t2v-fast` offers 9:16 or 16:9 and nothing between, so 0.5625 into an
 * 0.80 tile still crops about 30% of the height, and 720p leaves the posters at
 * 720x900 effective against the 786x982 the 2x density rule wants. That is a
 * large improvement on what it replaces and short of the target;
 * `docs/HOMEPAGE_MEDIA_REMAINING.md` carries the verdict, and
 * `tests/unit/homepage-media.test.ts` is what forced it to be recorded rather
 * than quietly shipped.
 *
 * `video` is a base path with no extension. The card appends `.webm` then
 * `.mp4`, so the browser takes VP9 where it can and H.264 where it cannot.
 */
export const MADE_WITH_ATHEOS: readonly MadeItem[] = [
  {
    kind: "video",
    poster: "made-video-3",
    video: "/marketing/made-video-3",
    prompt:
      "Slow orbital camera move around a faceless mannequin in an iridescent violet and cyan structured garment, fabric catching rim light, dark studio background, volumetric haze, editorial fashion lighting, cinematic",
    model: "Motion 1",
  },
  {
    kind: "image",
    poster: "gallery-5",
    prompt: "Isometric city at dusk, miniature tilt shift",
    model: "FLUX",
  },
  {
    kind: "video",
    poster: "made-video-4",
    video: "/marketing/made-video-4",
    prompt:
      "A faceted glass bottle rotating slowly while levitating above a dark reflective surface, violet and cyan gel lighting, refracted caustics moving across the surface, seamless studio cyclorama, macro product advertisement, cinematic",
    model: "Motion 1",
  },
  {
    kind: "image",
    poster: "gallery-2",
    prompt: "Liquid chrome sculpture, studio reflection",
    model: "FLUX",
  },
  {
    kind: "video",
    poster: "made-video-5",
    video: "/marketing/made-video-5",
    prompt:
      "Violet and cyan ink blooming through clear water and unfurling into the shape of luminous wings, slow graceful expansion, deep black background, high contrast, surreal, cinematic macro",
    model: "Motion 1",
  },
  {
    kind: "image",
    poster: "gallery-8",
    prompt: "Bioluminescent jellyfish, underwater",
    model: "FLUX",
  },
  {
    kind: "video",
    poster: "made-video-6",
    video: "/marketing/made-video-6",
    prompt:
      "Slow vertical camera rise through a neon-lit rain-slick canyon city at night, violet and cyan signage glow reflecting in wet stone, volumetric fog, cinematic anamorphic",
    model: "Motion 1",
  },
  {
    kind: "image",
    poster: "gallery-4",
    prompt: "Neon rain on glass, shallow depth of field",
    model: "FLUX",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Homepage composer                                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the landing composer offers, per modality.
 *
 * A deliberate, narrow mirror of `services/ai/providers/replicate.ts`. It has
 * to be a copy: the registry reads server environment variables, and this runs
 * in a client component on a statically rendered page.
 *
 * Two things keep the copy honest. Every `id` here is a real model id, carried
 * into the studio and resolved there against the actual registry — so a stale
 * entry produces a model the studio does not select, not a generation that
 * charges for something else. And `tests/unit/composer-models.test.ts` asserts
 * each id exists in the registry, which is what catches the drift.
 *
 * Fewer options than the studio, on purpose: the studio is where somebody
 * chooses between two video models, and the homepage is where they decide
 * whether to bother.
 */
/**
 * Public ids, not catalogue ids.
 *
 * These reach a browser twice over: as `<option value>` in the rendered HTML
 * and inside the `redirect_url` the sign-up link carries. `replicate/…` in
 * either is the same disclosure the public model contract exists to prevent.
 *
 * It was also simply broken. The studio validates the seeded `model` against
 * the list it loads from `/api/generations`, and that list has carried public
 * ids since the contract landed — so a catalogue id never matched, and every
 * composer link silently fell back to picking any model of the right
 * modality. Using the public id fixes the leak and the seed together.
 */
export interface ComposerModality {
  id: "image" | "video" | "audio";
  models: readonly { id: string; label: string }[];
  /** Empty for audio, which has no aspect ratio. */
  aspectRatios: readonly string[];
}

export const COMPOSER_MODALITIES: readonly ComposerModality[] = [
  {
    id: "image",
    models: [
      { id: "atheos-image-fast", label: "Atheos Image Fast" },
      { id: "atheos-image-realistic", label: "Atheos Image Realistic" },
    ],
    aspectRatios: ["1:1", "16:9", "9:16", "4:3"],
  },
  {
    id: "video",
    models: [
      { id: "motion-1", label: "Motion 1 · 720p" },
      /**
       * Motion Pro is absent for the same reason Score is: no publishable
       * licence. See `services/ai/model-policy.ts`, which refuses it.
       */
    ],
    aspectRatios: ["16:9", "9:16"],
  },
  {
    id: "audio",
    models: [
      /**
       * Score is absent by licence, not by oversight. MusicGen's weights are
       * CC-BY-NC-4.0, which forbids the commercial use selling it would be.
       * See `services/ai/model-policy.ts` — that registry is the authority and
       * refuses the model server-side; this list must agree with it.
       */
      { id: "foley", label: "Foley" },
    ],
    aspectRatios: [],
  },
] as const;
