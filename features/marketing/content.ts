import {
  Coins,
  Layers,
  Lock,
  Music,
  Sparkles,
  Video,
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
  /**
   * The generation shown beside the copy, named rather than derived.
   *
   * This used to be built at render time as `showcase-${panel.id}`. A composed
   * filename is invisible to every grep and to the test that was supposed to
   * prove a withdrawn asset had stopped rendering — `showcase-image` was on
   * the withdrawal list, the test searched the source for that literal, the
   * literal was never there, and the file kept being served. Naming it is what
   * makes it checkable.
   */
  image: string;
  /** One line under the media, stating exactly what it is. */
  mediaCaption: string;
  /** Video tab only. Muted autoplay with an explicit sound control. */
  video?: { src: string; poster: string; label: string };
  /** Audio tab only. A real playable example, never autoplayed. */
  audio?: {
    src: string;
    title: string;
    description: string;
    /** Fallback until `loadedmetadata` reports the real duration. */
    seconds: number;
  };
}

export const SHOWCASE: readonly ShowcaseTab[] = [
  {
    id: "image",
    icon: ImageIcon,
    hue: 303,
    /**
     * `img-technology-01`, generated 2 September at a native 2752x1536 and
     * downscaled here to 2048 for a panel that paints up to ~1200 CSS px.
     * It is a downscale of a native capture, so it is sharp on a high-density
     * display — and it is not 4K, and is never described as 4K.
     */
    image: "showcase/ai-technology-2048.acd3b7032d",
    mediaCaption:
      "AI-generated image - macro of a circuit board, 2048px from a 2752px native generation",
  },
  {
    id: "video",
    icon: Video,
    hue: 237,
    image: "showcase/ai-technology-2048.acd3b7032d",
    video: {
      src: "/marketing/showcase/neural-core.ae93b2317c.mp4",
      poster: "/marketing/showcase/neural-core-1120.ae93b2317c.webp",
      label: "AI-generated video of a processor core, with sound design",
    },
    /**
     * The exact claim. The picture is model output; the sound is a separately
     * generated Foley ambience mixed in locally. No commercially approved
     * model in the catalogue generates audio, so "native audio" would be false.
     */
    mediaCaption: "AI-generated video with sound design",
  },
  {
    id: "audio",
    icon: Music,
    hue: 162,
    image: "showcase/ai-technology-2048.acd3b7032d",
    audio: {
      src: "/marketing/showcase/ambience.ae93b2317c.m4a",
      title: "Futuristic Workspace Ambience",
      description:
        "Room tone, the faint hum of a large screen and distant city traffic.",
      seconds: 8,
    },
    // Sound effects and ambience, which is what the approved model does.
    // Music generation is not offered and is not implied here.
    mediaCaption: "AI-generated environmental sound design",
  },
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
  { icon: Layers, wide: true, image: "gallery-7" },
  { icon: Coins },
  { icon: Lock },
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
    hue: 237,
    image: "template-4",
    modality: "image",
    prompt:
      "Isometric illustration of a small workshop, clean geometry, flat palette, consistent light angle",
  },
  {
    hue: 162,
    image: "template-6",
    modality: "video",
    prompt:
      "A studio microphone in a darkened recording booth, warm rim light, calm and unhurried",
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

/**
 * The gallery is no longer defined here.
 *
 * It used to be six hand-written entries naming files in `public/marketing`.
 * Sprint 29 replaced it with a manifest generated from the masters themselves —
 * `features/marketing/gallery.generated.ts`, produced by
 * `scripts/build-gallery-media.mjs` — because every field on a card is a
 * measured fact: the real pixel dimensions, the content hash in the filename,
 * the prompt that produced it. A hand-kept copy drifts from the files on disk
 * the first time somebody re-encodes one, and the section's whole claim is
 * that what it says about each piece is true.
 *
 * `docs/GALLERY-PROVENANCE.md` records where each master came from.
 */

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
