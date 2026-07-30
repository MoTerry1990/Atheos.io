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

/**
 * All marketing copy, in one module.
 *
 * Every word on the landing page lives here rather than inline in JSX. Three
 * reasons that pay off quickly:
 *
 * 1. Copy changes are the most frequent edits a landing page gets, and they
 *    should not require reading layout code.
 * 2. The FAQ has to be rendered twice — once as an accordion, once as JSON-LD
 *    structured data. Two copies of the same text drift, and Google notices when
 *    the structured data stops matching the visible page.
 * 3. It makes the honesty audit trivial: every claim the product makes is in one
 *    file where it can be checked against what actually ships.
 *
 * **Nothing here asserts a fact we cannot back up.** No fabricated customer
 * counts, no invented logos, no made-up testimonials. Placeholder social proof
 * is a liability, not a growth tactic — see `TRUSTED_BY` below.
 */

export const SITE = {
  name: "Atheos",
  domain: "atheos.io",
  tagline: "One interface. Every AI model.",
  description:
    "Generate images, video, audio and creative assets across multiple AI providers from a single, beautifully designed workspace.",
} as const;

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

export const NAV_LINKS = [
  { href: "#showcase", label: "Product" },
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
] as const;

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

export const HERO = {
  announcement: "Now in private beta",
  headline: ["Every AI model.", "One interface."],
  subheadline:
    "Stop juggling six subscriptions and six mental models. Atheos puts image, video and audio generation behind a single workspace — with one library, one credit balance, and one place to learn.",
  primaryCta: { label: "Request early access", href: "#pricing" },
  secondaryCta: { label: "See how it works", href: "#how-it-works" },
  // Capability statements, not usage metrics. A pre-launch product quoting
  // "50,000 creators" is the fastest way to lose the ones it has.
  stats: [
    { value: "3", label: "Modalities" },
    { value: "1", label: "Credit balance" },
    { value: "0", label: "Vendor lock-in" },
  ],
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
 */
export const TRUSTED_BY = {
  label: "Built on infrastructure you already trust",
  items: [
    "Next.js",
    "Vercel",
    "PostgreSQL",
    "Stripe",
    "Clerk",
    "Cloudflare",
    "Supabase",
    "Prisma",
  ],
} as const;

/* -------------------------------------------------------------------------- */
/* Showcase                                                                    */
/* -------------------------------------------------------------------------- */

export interface ShowcaseTab {
  id: string;
  label: string;
  icon: LucideIcon;
  headline: string;
  body: string;
  bullets: readonly string[];
  /** Drives the procedural artwork rendered alongside. */
  hue: number;
}

export const SHOWCASE: readonly ShowcaseTab[] = [
  {
    id: "image",
    label: "Image",
    icon: ImageIcon,
    headline: "Every image model, side by side",
    body: "Run the same prompt across providers and compare the results in one view. The differences between models are obvious when you can see them together — and invisible when you cannot.",
    bullets: [
      "Compare providers on identical prompts",
      "Image-to-image and reference-driven generation",
      "Seeds, aspect ratios and negative prompts where supported",
    ],
    hue: 303,
  },
  {
    id: "video",
    label: "Video",
    icon: Video,
    headline: "Video that survives the wait",
    body: "Video generation takes minutes, not seconds. Atheos treats that as normal: jobs queue, run in the background, and tell you honestly when there is nothing to report.",
    bullets: [
      "Background jobs you can navigate away from",
      "Honest progress — no fake percentage bars",
      "Results delivered from our storage, not an expiring vendor link",
    ],
    hue: 237,
  },
  {
    id: "audio",
    label: "Audio",
    icon: Music,
    headline: "Voice, music and sound design",
    body: "The same pipeline, the same library, the same credits. Audio is not a bolted-on second product with its own rules.",
    bullets: [
      "Voice synthesis and music generation",
      "One asset library across all three modalities",
      "Per-modality pricing, one balance",
    ],
    hue: 162,
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Features                                                                    */
/* -------------------------------------------------------------------------- */

export interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
  /** Spans two columns on wide screens. */
  wide?: boolean;
}

export const FEATURES: readonly Feature[] = [
  {
    icon: Layers,
    title: "One library for everything",
    body: "Images, video and audio land in the same place, searchable and taggable, whichever model produced them. Your work is not scattered across six vendor dashboards.",
    wide: true,
  },
  {
    icon: Coins,
    title: "One credit balance",
    body: "No separate subscriptions to reconcile. Spend from a single balance, see exactly what each generation cost, and get refunded automatically when a provider fails.",
  },
  {
    icon: GitBranch,
    title: "No vendor lock-in",
    body: "Providers sit behind one interface. When a better model ships, it appears as an option — not as a migration project.",
  },
  {
    icon: Boxes,
    title: "Built for comparison",
    body: "The same prompt across multiple models, rendered side by side. The only reliable way to choose a model is to see them disagree.",
  },
  {
    icon: Lock,
    title: "Your assets, your storage",
    body: "Generated media is copied into our storage immediately. Vendor URLs expire; a library full of dead links a week later is not a library.",
  },
  {
    icon: Wand2,
    title: "Designed to be lived in",
    body: "Dark by default, keyboard-friendly, and fast. This is a tool for long sessions, not a demo that looks good in a screenshot.",
    wide: true,
  },
] as const;

/* -------------------------------------------------------------------------- */
/* How it works                                                                */
/* -------------------------------------------------------------------------- */

export const STEPS = [
  {
    number: "01",
    title: "Describe it",
    body: "Write a prompt. Add reference images if the model supports them. Atheos shows only the controls the chosen model actually understands, so you are never guessing which settings apply.",
  },
  {
    number: "02",
    title: "Pick your models",
    body: "Choose one model, or several. Running the same prompt across providers costs more credits and answers the question you actually have: which of these is right for this job?",
  },
  {
    number: "03",
    title: "Let it run",
    body: "Jobs run in the background. Close the tab if you want. Credits are debited on success and refunded automatically when a provider fails on its own account.",
  },
  {
    number: "04",
    title: "Keep what works",
    body: "Results land in your library with the prompt, the seed and the parameters attached — so a good generation can be reproduced, not just admired.",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export interface Template {
  title: string;
  category: string;
  body: string;
  hue: number;
}

export const TEMPLATES: readonly Template[] = [
  {
    title: "Product on set",
    category: "Commercial",
    body: "Studio lighting, seamless backdrop, controlled reflections.",
    hue: 303,
  },
  {
    title: "Cinematic still",
    category: "Film",
    body: "Anamorphic framing, practical light, shallow depth of field.",
    hue: 262,
  },
  {
    title: "Editorial portrait",
    category: "Photography",
    body: "Soft key, rim separation, neutral colour science.",
    hue: 237,
  },
  {
    title: "Isometric scene",
    category: "Illustration",
    body: "Clean geometry, flat palette, consistent light angle.",
    hue: 162,
  },
  {
    title: "Motion loop",
    category: "Video",
    body: "Seamless four-second cycle for backgrounds and headers.",
    hue: 70,
  },
  {
    title: "Voice-over read",
    category: "Audio",
    body: "Calm, mid-range, unhurried — for explainer narration.",
    hue: 25,
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Gallery                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Gallery tiles.
 *
 * The artwork is generated in the browser from these seeds rather than shipped
 * as image files. That is a deliberate constraint of this sprint: showing
 * AI-generated images we have not actually generated — or stock photos dressed
 * up as output — would misrepresent the product before it has shipped.
 *
 * These are replaced with real generations in Sprint 4, once the pipeline
 * exists to produce them honestly.
 */
export const GALLERY = [
  { prompt: "Volumetric light through fog, anamorphic", hue: 303, seed: 11 },
  { prompt: "Liquid chrome, studio reflection", hue: 237, seed: 27 },
  { prompt: "Aurora over black water, long exposure", hue: 162, seed: 43 },
  { prompt: "Neon rain, shallow depth of field", hue: 328, seed: 58 },
  { prompt: "Isometric city, dusk palette", hue: 262, seed: 71 },
  { prompt: "Solar flare, macro detail", hue: 45, seed: 89 },
  { prompt: "Deep space nebula, true blacks", hue: 280, seed: 97 },
  { prompt: "Bioluminescence, underwater", hue: 190, seed: 103 },
] as const;

/* -------------------------------------------------------------------------- */
/* Pricing                                                                     */
/* -------------------------------------------------------------------------- */

export interface PricingTier {
  id: string;
  name: string;
  description: string;
  monthly: number;
  yearly: number;
  credits: string;
  features: readonly string[];
  cta: string;
  featured?: boolean;
}

export const PRICING: readonly PricingTier[] = [
  {
    id: "starter",
    name: "Starter",
    description: "Enough to find out whether this fits how you work.",
    monthly: 0,
    yearly: 0,
    credits: "200 credits monthly",
    features: [
      "Image generation",
      "Single asset library",
      "Standard queue",
      "Community support",
    ],
    cta: "Start free",
  },
  {
    id: "studio",
    name: "Studio",
    description: "For people who generate every day and need it to be fast.",
    monthly: 24,
    yearly: 19,
    credits: "3,000 credits monthly",
    features: [
      "Image, video and audio",
      "Side-by-side model comparison",
      "Priority queue",
      "Collections and tagging",
      "Automatic refunds on provider failure",
      "Email support",
    ],
    cta: "Request early access",
    featured: true,
  },
  {
    id: "scale",
    name: "Scale",
    description: "For teams putting generated work into production.",
    monthly: 79,
    yearly: 64,
    credits: "12,000 credits monthly",
    features: [
      "Everything in Studio",
      "Highest queue priority",
      "Bulk generation and export",
      "Usage analytics and cost breakdown",
      "Early access to new providers",
      "Priority support",
    ],
    cta: "Talk to us",
  },
] as const;

export const PRICING_NOTE =
  "Credits are consumed per generation and priced by modality — video costs more than an image because it costs us more. Unused credits roll over for one month. Cancel any time.";

/* -------------------------------------------------------------------------- */
/* FAQ                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Rendered twice: as the visible accordion and as FAQPage JSON-LD. Keeping one
 * source means the structured data cannot drift from the page, which Google
 * treats as a quality signal — and penalises when it breaks.
 */
export const FAQ = [
  {
    question: "Which AI providers does Atheos support?",
    answer:
      "Atheos is built provider-agnostic: every model sits behind one internal interface, so adding a provider is a configuration change rather than a rebuild. The specific launch line-up is being finalised during the private beta, and we will publish it before general availability rather than promise it now.",
  },
  {
    question: "Do I need my own API keys?",
    answer:
      "No. Atheos handles provider access and billing. You spend credits from a single balance and never manage vendor accounts, rate limits or separate invoices.",
  },
  {
    question: "What happens to my credits if a generation fails?",
    answer:
      "They are refunded automatically. Credits are tracked in an append-only ledger, so every debit and refund is auditable — a failed generation on the provider's side is never charged to you.",
  },
  {
    question: "Who owns the output?",
    answer:
      "You do, subject to the terms of the underlying model provider. Atheos does not claim rights over anything you generate, and we do not train models on your prompts or assets.",
  },
  {
    question: "Where are my generated files stored?",
    answer:
      "In our own object storage, not on a provider's temporary URL. Generated media is copied across as soon as a job completes, so your library still works months later. You can export or delete anything at any time.",
  },
  {
    question: "Can I compare models on the same prompt?",
    answer:
      "Yes — that is one of the reasons the product exists. Run a prompt across several models and see the results side by side. Each run consumes credits per model, since each is a real generation.",
  },
  {
    question: "Is there a free tier?",
    answer:
      "Yes. Starter includes 200 credits a month at no cost, with no card required. It is enough to decide whether Atheos fits how you work.",
  },
  {
    question: "When does Atheos launch?",
    answer:
      "Atheos is in private beta. Request early access and we will get in touch as capacity opens up — we would rather onboard slowly and keep generation fast than open the doors and queue everyone.",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Footer                                                                      */
/* -------------------------------------------------------------------------- */

export const FOOTER_LINKS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Templates", href: "#templates" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Gallery", href: "#gallery" },
      { label: "FAQ", href: "#faq" },
      { label: "Design system", href: "/design-system" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#" },
      { label: "Contact", href: "#" },
      { label: "Careers", href: "#" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "#" },
      { label: "Terms", href: "#" },
      { label: "Acceptable use", href: "#" },
    ],
  },
] as const;

export const FOOTER_NOTE =
  "Atheos is in private beta. Product details may change before general availability.";

export { Sparkles };
