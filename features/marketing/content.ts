import {
  Boxes,
  Coins,
  GitBranch,
  Layers,
  Lock,
  Music,
  Sparkles,
  Video,
  Wand2,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";

import { PLAN_DEFINITIONS } from "@/services/billing/catalogue";
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
}

export const FEATURES: readonly Feature[] = [
  { icon: Layers, wide: true },
  { icon: Coins },
  { icon: GitBranch },
  { icon: Boxes },
  { icon: Lock },
  { icon: Wand2, wide: true },
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
  { number: "04" },
] as const;

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export interface Template {
  hue: number;
}

export const TEMPLATES: readonly Template[] = [
  { hue: 303 },
  { hue: 262 },
  { hue: 237 },
  { hue: 162 },
  { hue: 70 },
  { hue: 25 },
] as const;

/* -------------------------------------------------------------------------- */
/* Gallery                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Gallery tiles.
 *
 * The artwork is generated in the browser from these seeds rather than shipped
 * as image files. That is a deliberate constraint: showing AI-generated images
 * we have not actually generated — or stock photos dressed up as output —
 * would misrepresent the product. The prompt caption on each tile is in the
 * dictionaries, at the matching index.
 */
export const GALLERY = [
  { hue: 303, seed: 11 },
  { hue: 237, seed: 27 },
  { hue: 162, seed: 43 },
  { hue: 328, seed: 58 },
  { hue: 262, seed: 71 },
  { hue: 45, seed: 89 },
  { hue: 280, seed: 97 },
  { hue: 190, seed: 103 },
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
  /** Per month, billed yearly. **Minor units.** */
  yearly: number;
  /**
   * What the card actually charges on a yearly plan, for the whole year.
   *
   * Carried explicitly rather than left to the card to multiply. The number a
   * yearly buyer is agreeing to is the one that leaves their account, and a
   * page that shows only the divided-by-twelve figure is technically true and
   * practically a surprise at the checkout screen.
   */
  yearlyTotal: number;
  /** The allowance, already grouped — "20,000". The unit noun is translated. */
  credits: string;
  featured?: boolean;
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
export const PRICING: readonly PricingTier[] = PLAN_DEFINITIONS.map((plan) => ({
  id: plan.tier.toLowerCase(),
  tier: plan.tier,
  monthly: plan.monthly,
  yearly: plan.yearly,
  yearlyTotal: plan.yearly * 12,
  credits: plan.monthlyCredits.toLocaleString("en-US"),
  featured: plan.featured,
}));

export { Sparkles };
