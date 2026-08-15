import type { MarketingCopy } from "@/features/marketing/i18n/copy";

/**
 * English — the source text.
 *
 * When a claim changes it changes here first, and `es.ts` follows. A test
 * asserts the two agree structurally, so a new bullet added on this side
 * cannot silently ship as an English string on the Spanish page.
 */
export const EN: MarketingCopy = {
  sections: {
    showcase: {
      eyebrow: "The product",
      title: "Three modalities. One pipeline.",
      description:
        "Image, video and audio share the same jobs, the same library and the same credits. Nothing here is a second product bolted on beside the first.",
    },
    features: {
      eyebrow: "Why Atheos",
      title: "Built around the parts that actually hurt",
      description:
        "Not a longer feature list. A shorter one, aimed at the specific friction of working across several AI providers at once.",
    },
    howItWorks: {
      eyebrow: "How it works",
      title: "Four steps, no ceremony",
      description:
        "From an idea to something in your library, with the parts that usually go wrong handled for you.",
    },
    templates: {
      eyebrow: "Templates",
      title: "Start from something that already works",
      description:
        "Prompt scaffolds with the parameters pre-set for a look. Edit anything — they are starting points, not rails.",
    },
    faq: {
      eyebrow: "FAQ",
      title: "The questions worth answering",
      description:
        "Including the ones with answers we would rather not have to give yet.",
    },
  },

  site: {
    tagline: "One interface. Every AI model.",
    description:
      "Generate images, video, audio and creative assets across multiple AI providers from a single, beautifully designed workspace.",
  },

  /**
   * Four items, and every one of them a place rather than a scroll position.
   *
   * The previous five were all anchors on this page, which made the header a
   * table of contents for a document instead of navigation for a product. A
   * visitor who wants to see what other people made now has somewhere to go.
   */
  nav: [
    { href: "/studio", label: "Create" },
    { href: "/explore", label: "Explore" },
    { href: "/marketplace", label: "Tools" },
    { href: "/pricing", label: "Pricing" },
  ],

  auth: {
    signIn: "Sign in",
    signUp: "Start creating",
    dashboard: "Dashboard",
  },

  hero: {
    announcement: "Create without limits",
    headline: ["One creative studio.", "Every AI model."],
    subheadline:
      "Generate images, videos and audio from one beautifully simple workspace.",
    primaryCta: {
      label: "Start creating",
      href: "/sign-up?redirect_url=%2Fstudio",
    },
    secondaryCta: { label: "Explore creations", href: "#made" },
    stats: [
      { value: "3", label: "Modalities" },
      { value: "1", label: "Credit balance" },
      { value: "0", label: "Vendor lock-in" },
    ],
  },

  composer: {
    placeholders: {
      image:
        "A lone figure on a rain-slick street, neon reflections, anamorphic",
      video:
        "Slow push through a foggy forest at dawn, shafts of light, drifting mist",
      audio: "Warm ambient score, soft synth pads, calm and unhurried",
    },
    modalities: [
      { id: "image", label: "Image" },
      { id: "video", label: "Video" },
      { id: "audio", label: "Audio" },
    ],
    cta: "Create",
    promptLabel: "Prompt",
    note: "Free to start — 100 credits a month, no card. Your prompt comes with you.",
    noteEmpty: "Free to start — 100 credits a month, no card required.",
  },

  made: {
    eyebrow: "Made with Atheos",
    title: "Ideas become images, motion and sound.",
    // "Real creations" is accurate — every card is verified output from
    // scripts/generate-marketing-assets.ts, on the pinned model versions the
    // product runs. It says images *and* clips rather than implying all six
    // move, because two do.
    description:
      "Real creations from the models on the free plan — still images and short clips. Take any prompt into your own workspace.",
    tryThis: "Try this",
    play: "Play preview",
  },

  trustedBy: { label: "Built on infrastructure you already trust" },

  showcase: [
    {
      label: "Image",
      headline: "Every image model, side by side",
      body: "Run the same prompt across providers and compare the results in one view. The differences between models are obvious when you can see them together — and invisible when you cannot.",
      bullets: [
        "Compare providers on identical prompts",
        "Image-to-image and reference-driven generation",
        "Seeds, aspect ratios and negative prompts where supported",
      ],
    },
    {
      label: "Video",
      headline: "Video that survives the wait",
      body: "Video generation takes minutes, not seconds. Atheos treats that as normal: jobs queue, run in the background, and tell you honestly when there is nothing to report.",
      bullets: [
        "Background jobs you can navigate away from",
        "Honest progress — no fake percentage bars",
        "Results delivered from our storage, not an expiring vendor link",
      ],
    },
    {
      label: "Audio",
      headline: "Voice, music and sound design",
      body: "The same pipeline, the same library, the same credits. Audio is not a bolted-on second product with its own rules.",
      bullets: [
        "Voice synthesis and music generation",
        "One asset library across all three modalities",
        "Per-modality pricing, one balance",
      ],
    },
  ],

  features: [
    {
      title: "One library for everything",
      body: "Images, video and audio land in the same place, searchable and taggable, whichever model produced them. Your work is not scattered across six vendor dashboards.",
    },
    {
      title: "One credit balance",
      body: "No separate subscriptions to reconcile. Spend from a single balance, see exactly what each generation cost, and get refunded automatically when a provider fails.",
    },
    {
      title: "Your assets, your storage",
      body: "Generated media is copied into our storage immediately. Vendor URLs expire; a library full of dead links a week later is not a library.",
    },
    {
      title: "Designed to be lived in",
      body: "Dark by default, keyboard-friendly, and fast. This is a tool for long sessions, not a demo that looks good in a screenshot.",
    },
  ],

  steps: [
    {
      title: "Describe it",
      body: "Write a prompt. Add reference images if the model supports them. Atheos shows only the controls the chosen model actually understands, so you are never guessing which settings apply.",
    },
    {
      title: "Pick your models",
      body: "Choose one model, or several. Running the same prompt across providers costs more credits and answers the question you actually have: which of these is right for this job?",
    },
    {
      title: "Keep what works",
      body: "Results land in your library with the prompt, the seed and the parameters attached — so a good generation can be reproduced, not just admired.",
    },
  ],

  templates: [
    {
      title: "Product on set",
      category: "Commercial",
      body: "Studio lighting, seamless backdrop, controlled reflections.",
    },
    {
      title: "Cinematic still",
      category: "Film",
      body: "Anamorphic framing, practical light, shallow depth of field.",
    },
    {
      title: "Editorial portrait",
      category: "Photography",
      body: "Soft key, rim separation, neutral colour science.",
    },
    {
      title: "Motion loop",
      category: "Video",
      body: "Seamless four-second cycle for backgrounds and headers.",
    },
  ],

  pricing: {
    eyebrow: "Pricing",
    title: "Pay for generations, not seats",
    description:
      "One balance across every model and modality. No per-provider subscriptions to reconcile at the end of the month.",
    monthly: "Monthly",
    yearly: "Yearly",
    yearlySave: "−20%",
    mostPopular: "Most popular",
    perMonth: "/ month",
    forever: "forever",
    billedYearly: "billed yearly",
    save: "save",
    creditsMonthly: (credits) => `${credits} credits monthly`,
    ctaFree: "Start free",
    ctaChoose: (plan) => `Choose ${plan}`,
    note: "Credits are consumed per generation and priced by modality — video costs more than an image because it costs us more. Unused credits roll over for one month. Cancel any time.",
  },

  plans: {
    STARTER: {
      name: "Free",
      description: "One video and a handful of images, to see if it fits.",
      features: [
        "1 video or 25 images",
        "720p video, fast model",
        "Image upscaling to 4K",
        "Full asset library and projects",
        "Commercial rights to everything you make",
      ],
    },
    BASIC: {
      name: "Starter",
      description: "For the occasional project, without a monthly commitment.",
      features: [
        "3 videos or 87 images a month",
        "720p video, fast model",
        "Background removal and 4K upscaling",
        "Full asset library and projects",
        "Automatic refund when a provider fails",
        "Commercial rights to everything you make",
      ],
    },
    STUDIO: {
      name: "Creator",
      description: "For one person publishing on a schedule.",
      features: [
        "11 videos or 250 images a month",
        "1080p video up to 12 seconds",
        "Every aspect ratio — 16:9, 9:16, 1:1, 21:9",
        "Both video models, including Motion Pro",
        "Image-to-video and reference images",
        "Background removal and 4K upscaling",
        "Automatic refund when a provider fails",
      ],
    },
    SCALE: {
      name: "Studio",
      description: "For channels shipping every day, and small teams.",
      features: [
        "33 videos or 750 images a month",
        "Everything in Creator",
        "Bulk generation and export",
        "Usage and cost breakdown",
        "Publish to the community gallery",
        "Email support",
      ],
    },
    AGENCY: {
      name: "Agency",
      description: "For studios and agencies producing at volume.",
      features: [
        "222 videos or 5,000 images a month",
        "Everything in Studio",
        "Unused credits roll over for a month",
        "Bulk generation and export",
        "Full usage and cost breakdown per generation",
        "Email support",
      ],
    },
  },

  packs: {
    eyebrow: "Top-ups",
    title: "Or buy credits when you need them",
    description:
      "One-off packs, no subscription. They never expire and they stack on top of a plan's monthly allowance.",
    pack: "Pack",
    price: "Price",
    videos: "Videos",
    images: "Images",
    credits: (count) => `${count} credits`,
    note: "Video counts assume the standard model at five seconds. Longer clips and the higher-quality model cost more — the studio shows the exact price before you generate, never after.",
  },

  comparison: {
    eyebrow: "Compare",
    title: "What each plan includes",
    description: "Every row is something the product does today.",
    feature: "Feature",
    caption:
      "Feature comparison across the Free, Starter, Creator, Studio and Agency plans",
    free: "Free",
    perMonth: "/mo",
    included: "Included",
    notIncluded: "Not included",
    values: { community: "Community", email: "Email", allSix: "All six" },
    rows: [
      { label: "Monthly credits" },
      {
        label: "Videos per month",
        note: "At five seconds on the standard model",
      },
      { label: "Images per month" },
      { label: "Image generation" },
      { label: "Video generation" },
      { label: "Video resolution" },
      { label: "Maximum clip length" },
      {
        label: "Motion Pro — higher-quality model",
        note: "Slower to render, noticeably better output",
      },
      { label: "Image-to-video" },
      { label: "Reference images" },
      {
        label: "Video aspect ratios",
        note: "The extra four come with Motion Pro",
      },
      { label: "Upscale to 4K" },
      { label: "Background removal" },
      { label: "Projects and collections" },
      { label: "Prompt packs from the marketplace" },
      { label: "Publish to the community gallery" },
      { label: "Bulk generation and export" },
      { label: "Usage and cost breakdown" },
      {
        label: "Automatic refund on provider failure",
        note: "Credits return the moment a generation fails",
      },
      { label: "Commercial rights" },
      { label: "Support" },
    ],
  },

  enterprise: {
    eyebrow: "Business and enterprise",
    title: "Need seats, SSO or an invoice?",
    body: [
      "Agency covers the volume — 20,000 credits a month, on a card, no conversation required. What it does not cover is the other half of an enterprise purchase: several people on one balance, single sign-on, procurement, a model we do not offer yet.",
      "Those are being built, and we would rather scope them against a real requirement than guess. Tell us the constraints and we will tell you what it costs and when — or say plainly if we are not the right fit yet.",
    ],
    cta: "Talk to us",
    needsTitle: "Worth a conversation if",
    needs: [
      "More than 20,000 credits a month",
      "Several people working from one balance",
      "Single sign-on for your team",
      "Invoicing rather than a card on file",
      "A data-processing agreement",
      "A specific model, or your own provider keys",
      "Support with a response time attached",
    ],
  },

  faq: [
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
        "Yes. The Free plan includes 100 credits a month at no cost, with no card required — one video or twenty-five images. It is enough to decide whether Atheos fits how you work.",
    },
    {
      question: "Can I use Atheos today?",
      answer:
        "Yes. Sign-up is open and generation starts immediately — no waitlist and no card. Atheos is still in beta, which means features change and some are unfinished, so anything described as coming soon is not built yet rather than nearly ready.",
    },
  ],

  footer: {
    groups: [
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
        // "About" and "Careers" were links to `#`. A beta with no About page
        // should not advertise one, and a careers page for a team of one is a
        // claim rather than a link. Contact is a real mailbox, and Connect is a
        // real page — both are more use to a visitor than a dead anchor.
        title: "Company",
        links: [
          { label: "Connect your tools", href: "/connect" },
          { label: "Contact", href: "mailto:hello@atheos.io" },
        ],
      },
      {
        title: "Legal",
        links: [
          { label: "Privacy", href: "/privacy" },
          { label: "Terms", href: "/terms" },
          { label: "Acceptable use", href: "/acceptable-use" },
        ],
      },
    ],
    note: "Atheos is in private beta. Product details may change before general availability.",
    rights: "All rights reserved.",
  },

  language: { label: "Language" },
};
