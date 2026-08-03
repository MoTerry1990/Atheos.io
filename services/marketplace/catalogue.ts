import type { MarketplaceItem } from "@/services/marketplace/types";

/**
 * The marketplace catalogue.
 *
 * ## Code, not a database table
 *
 * Same shape as the AI model registry. Items ship with the repository, get
 * reviewed like any other change, and exist on a fresh database with no seed
 * step. Only favourites and installs are per-user, and those are rows keyed by
 * slug.
 *
 * ## Everything here is first-party, and nothing pretends otherwise
 *
 * No invented publishers, no download counts, no ratings. The honesty rule this
 * project has held since Sprint 2 applies hardest here, because a marketplace's
 * numbers are the first thing a user trusts. An empty-looking catalogue that is
 * true beats a busy one that is not.
 *
 * ## The content is real, not lorem ipsum
 *
 * Every prompt and style fragment here is written to actually work. A catalogue
 * of plausible-looking filler would make the browse page look finished and the
 * product useless the moment somebody installed something — which is the exact
 * failure mode a marketplace is supposed to avoid.
 *
 * Sprint 5's `STYLE_PRESETS` and `PROMPT_TEMPLATES` remain built into the
 * studio. This does not replace them; it is the place additional ones come
 * from, and the packs below deliberately go somewhere the built-ins do not.
 */

export const CATALOGUE: readonly MarketplaceItem[] = [
  // ---------------------------------------------------------------- templates
  {
    slug: "product-hero-white",
    kind: "TEMPLATE",
    title: "Product hero, seamless white",
    summary: "Catalogue-style product shot with controlled reflections.",
    description:
      "The setup most e-commerce imagery wants: one object, a seamless backdrop, and light soft enough that the material reads without blowing out. Start here and change only the subject.",
    category: "Product",
    tags: ["product", "ecommerce", "studio", "packshot"],
    hue: 303,
    official: true,
    usable: true,
    payload: {
      kind: "TEMPLATE",
      template: {
        prompt:
          "a single {subject} centred on a seamless white backdrop, studio product photography, controlled specular reflections, soft gradient falloff behind",
        negativePrompt: "clutter, busy background, harsh shadows, watermark",
        aspectRatio: "1:1",
        styleFragments: [
          "studio product photography, seamless backdrop, controlled reflections",
        ],
        camera: {
          shot: "Close-up",
          angle: "Eye level",
          lens: "85mm",
          lighting: "Softbox",
        },
      },
    },
  },
  {
    slug: "editorial-portrait-window",
    kind: "TEMPLATE",
    title: "Editorial portrait, window light",
    summary: "One subject, one window, neutral colour science.",
    description:
      "A portrait setup that stays believable. Window light gives directional falloff without the plastic look of an even key, and the neutral grade means the result composites into a layout rather than fighting it.",
    category: "Photography",
    tags: ["portrait", "editorial", "natural light"],
    hue: 25,
    official: true,
    usable: true,
    payload: {
      kind: "TEMPLATE",
      template: {
        prompt:
          "portrait of {subject} beside a large window, soft directional daylight, natural skin texture, neutral colour grade, plain interior wall behind",
        negativePrompt:
          "oversaturated, plastic skin, heavy vignette, text, watermark",
        aspectRatio: "4:3",
        styleFragments: [
          "editorial photography, soft key light, neutral colour science",
        ],
        camera: {
          shot: "Medium shot",
          angle: "Eye level",
          lens: "50mm",
          lighting: "Window light",
        },
      },
    },
  },
  {
    slug: "establishing-shot-drone",
    kind: "TEMPLATE",
    title: "Establishing shot, slow aerial",
    summary: "A ten-second opening clip that gives a scene its geography.",
    description:
      "The shot almost every piece of film opens with, and the one that is easiest to get wrong: too much motion and it reads as a stock clip, too little and it reads as a still. A slow aerial over a fixed subject is the version that works.",
    category: "Film",
    tags: ["video", "establishing", "aerial", "opening"],
    hue: 200,
    official: true,
    usable: true,
    payload: {
      kind: "TEMPLATE",
      template: {
        prompt:
          "wide establishing shot of {location} at first light, low mist across the ground, long shadows, unhurried",
        negativePrompt: "fast motion, shaky, text overlay",
        aspectRatio: "16:9",
        styleFragments: [
          "cinematic lighting, anamorphic, shallow depth of field, film grain",
        ],
        durationSeconds: 10,
        cameraMotion: "aerial drone shot",
      },
    },
  },

  // ------------------------------------------------------------- prompt packs
  {
    slug: "brand-launch-prompts",
    kind: "PROMPT_PACK",
    title: "Brand launch",
    summary: "Twelve prompts covering a product announcement, end to end.",
    description:
      "Everything a launch needs images for, written so the set holds together: the same lighting language and the same restraint across a hero, a detail, a lifestyle frame and the social crops. Use them in order and the results look like one campaign rather than four.",
    category: "Brand",
    tags: ["launch", "campaign", "marketing", "consistency"],
    hue: 268,
    official: true,
    usable: true,
    payload: {
      kind: "PROMPT_PACK",
      prompts: [
        {
          id: "hero",
          title: "Hero",
          prompt:
            "{product} lit from a single soft source, deep neutral background, generous negative space to the left for a headline",
          negativePrompt: "busy background, competing highlights",
        },
        {
          id: "detail",
          title: "Material detail",
          prompt:
            "extreme close-up of the surface of {product}, raking light revealing texture, shallow depth of field",
        },
        {
          id: "in-use",
          title: "In use",
          prompt:
            "{product} in use on a worn wooden desk, morning light, unstyled and lived-in",
        },
        {
          id: "context",
          title: "Context",
          prompt:
            "{product} small in frame within a wider interior, environment doing the explaining",
        },
        {
          id: "exploded",
          title: "Exploded view",
          prompt:
            "exploded view of {product}, components separated along one axis, even studio light, technical clarity",
        },
        {
          id: "packaging",
          title: "Packaging",
          prompt:
            "{product} packaging standing closed on a seamless backdrop, soft top light, honest material rendering",
        },
        {
          id: "duo",
          title: "Range",
          prompt:
            "two variants of {product} side by side, identical lighting, equal spacing, catalogue framing",
        },
        {
          id: "hands",
          title: "In hand",
          prompt:
            "a pair of hands holding {product}, cropped at the wrists, soft daylight, neutral background",
        },
        {
          id: "story-vertical",
          title: "Vertical crop",
          prompt:
            "{product} composed for a vertical frame, subject in the lower third, clean space above for type",
        },
        {
          id: "night",
          title: "Night",
          prompt:
            "{product} under a single warm practical light in a dark room, everything else falling to black",
        },
        {
          id: "flatlay",
          title: "Flat lay",
          prompt:
            "overhead flat lay of {product} with three related objects, even light, generous margins",
        },
        {
          id: "abstract",
          title: "Abstract",
          prompt:
            "abstract crop of {product} filling the frame, form unrecognisable, colour and geometry only",
        },
      ],
    },
  },
  {
    slug: "environment-concepts",
    kind: "PROMPT_PACK",
    title: "Environment concepts",
    summary: "Eight starting points for places rather than things.",
    description:
      "Prompts for concept work, where the point is to establish a place quickly and iterate. Each one names a light condition and a scale cue, which are the two things that decide whether an environment reads at all.",
    category: "Concept art",
    tags: ["environment", "concept", "world building"],
    hue: 162,
    official: true,
    usable: true,
    payload: {
      kind: "PROMPT_PACK",
      prompts: [
        {
          id: "coastal",
          title: "Coastal settlement",
          prompt:
            "a small settlement built into a cliff face above cold water, overcast flat light, a single figure for scale",
        },
        {
          id: "interior-vault",
          title: "Interior, vast",
          prompt:
            "the interior of a vast stone hall, light entering through one high opening, dust in the beam, scale read from the doorway",
        },
        {
          id: "industrial",
          title: "Industrial exterior",
          prompt:
            "a working industrial yard at dusk, sodium lighting, wet ground reflecting, machinery mid-task",
        },
        {
          id: "overgrown",
          title: "Overgrown",
          prompt:
            "an abandoned structure being taken back by plants, diffuse green light through the canopy, roots breaking the floor",
        },
        {
          id: "desert-road",
          title: "Desert route",
          prompt:
            "a single road crossing an empty plain, heat haze, distant range compressed by a long lens",
        },
        {
          id: "underground",
          title: "Underground",
          prompt:
            "a tunnel junction lit only by fixtures on the wall, receding into darkness in both directions",
        },
        {
          id: "market",
          title: "Dense market",
          prompt:
            "a covered market at midday, light falling through gaps in the roof, layered depth from foreground stalls",
        },
        {
          id: "high-altitude",
          title: "High altitude",
          prompt:
            "a structure at high altitude above the cloud layer, thin cold light, horizon curvature just visible",
        },
      ],
    },
  },
  {
    slug: "social-formats",
    kind: "PROMPT_PACK",
    title: "Social formats",
    summary: "Six prompts written for vertical crops and small screens.",
    description:
      "Composition for a phone is a different problem: the subject has to survive being seen at thumbnail size, and the top and bottom of the frame are usually covered by interface. These leave room for both.",
    category: "Social",
    tags: ["social", "vertical", "9:16", "mobile"],
    hue: 328,
    official: true,
    usable: true,
    payload: {
      kind: "PROMPT_PACK",
      prompts: [
        {
          id: "single-subject",
          title: "Single subject, centred",
          prompt:
            "{subject} centred in a vertical frame, strong silhouette, uncluttered background, readable at thumbnail size",
        },
        {
          id: "text-safe",
          title: "Caption safe",
          prompt:
            "{subject} in the middle third of a vertical frame, clean empty space top and bottom for interface and captions",
        },
        {
          id: "high-contrast",
          title: "High contrast",
          prompt:
            "{subject} lit for maximum separation from the background, deep shadows, no mid-tone clutter",
        },
        {
          id: "colour-block",
          title: "Colour block",
          prompt:
            "{subject} against a single flat saturated colour, no gradient, no texture",
        },
        {
          id: "motion-still",
          title: "Implied motion",
          prompt:
            "{subject} caught mid-movement, one limb blurred, everything else sharp",
        },
        {
          id: "detail-crop",
          title: "Detail crop",
          prompt:
            "an extremely tight crop of {subject}, filling the vertical frame edge to edge",
        },
      ],
    },
  },

  // -------------------------------------------------------------- style packs
  {
    slug: "film-stocks",
    kind: "STYLE_PACK",
    title: "Film stocks",
    summary: "Six looks based on how specific film behaves.",
    description:
      "Named after the behaviour rather than the brand: how the stock handles highlights, what it does to skin, where it loses detail. Written that way because a model responds to the description, not to the name on the box.",
    category: "Photography",
    tags: ["film", "analog", "grade", "texture"],
    hue: 45,
    official: true,
    usable: true,
    payload: {
      kind: "STYLE_PACK",
      styles: [
        {
          id: "warm-negative",
          name: "Warm negative",
          fragment:
            "colour negative film, warm highlights, soft shoulder, forgiving overexposure, fine grain",
          hue: 30,
        },
        {
          id: "cool-reversal",
          name: "Cool reversal",
          fragment:
            "slide film, cool shadows, high saturation, hard highlight clipping, very fine grain",
          hue: 205,
        },
        {
          id: "push-processed",
          name: "Push processed",
          fragment:
            "pushed two stops, heavy grain, crushed shadows, reduced colour separation",
          hue: 280,
        },
        {
          id: "monochrome-fast",
          name: "Fast monochrome",
          fragment:
            "fast black and white film, pronounced grain, wide tonal range, soft highlight rolloff",
          hue: 0,
        },
        {
          id: "instant",
          name: "Instant",
          fragment:
            "instant film, low contrast, muted colour, soft focus edges, slight cyan cast in shadow",
          hue: 175,
        },
        {
          id: "expired",
          name: "Expired",
          fragment:
            "expired film stock, shifted colour balance toward magenta, unpredictable fogging, lifted blacks",
          hue: 320,
        },
      ],
    },
  },
  {
    slug: "print-illustration",
    kind: "STYLE_PACK",
    title: "Print illustration",
    summary: "Five looks drawn from how ink actually lands on paper.",
    description:
      "Screen print, risograph, letterpress and litho each fail in a characteristic way — misregistration, ink starvation, plate texture — and those failures are what make them read as printed rather than as filtered.",
    category: "Illustration",
    tags: ["print", "risograph", "screen print", "texture"],
    hue: 190,
    official: true,
    usable: true,
    payload: {
      kind: "STYLE_PACK",
      styles: [
        {
          id: "risograph",
          name: "Risograph",
          fragment:
            "risograph print, two spot colours overprinting, visible misregistration, coarse paper texture",
          hue: 328,
        },
        {
          id: "screen-print",
          name: "Screen print",
          fragment:
            "screen print, flat opaque inks, slight ink starvation at edges, limited palette",
          hue: 262,
        },
        {
          id: "letterpress",
          name: "Letterpress",
          fragment:
            "letterpress, deep impression into cotton paper, single ink colour, soft debossed edges",
          hue: 40,
        },
        {
          id: "offset-halftone",
          name: "Offset halftone",
          fragment:
            "offset litho, visible CMYK halftone rosette, slight dot gain, newsprint absorbency",
          hue: 210,
        },
        {
          id: "cyanotype",
          name: "Cyanotype",
          fragment:
            "cyanotype, prussian blue monochrome, uneven hand-coated edges, high contrast",
          hue: 220,
        },
      ],
    },
  },
  {
    slug: "lighting-setups",
    kind: "STYLE_PACK",
    title: "Lighting setups",
    summary: "Seven named setups, described the way a gaffer would.",
    description:
      "Key position, fill ratio and what the shadow does. Prompts that name a mood get a mood; prompts that name a setup get the setup, and the mood follows from it.",
    category: "Film",
    tags: ["lighting", "cinematography", "setup"],
    hue: 262,
    official: true,
    usable: true,
    payload: {
      kind: "STYLE_PACK",
      styles: [
        {
          id: "rembrandt",
          name: "Rembrandt",
          fragment:
            "single key at 45 degrees and above, triangle of light on the shadow-side cheek, minimal fill",
          hue: 35,
        },
        {
          id: "butterfly",
          name: "Butterfly",
          fragment:
            "key directly above and in front, symmetrical shadow beneath the nose, soft fill from below",
          hue: 55,
        },
        {
          id: "rim-only",
          name: "Rim only",
          fragment:
            "backlight only, subject rendered as a bright outline against darkness, no frontal fill",
          hue: 280,
        },
        {
          id: "practical",
          name: "Practicals",
          fragment:
            "lit entirely by lamps visible in frame, warm falloff, deep unlit corners",
          hue: 25,
        },
        {
          id: "overcast",
          name: "Overcast",
          fragment:
            "flat overcast daylight, no direction, shadows only in contact areas",
          hue: 200,
        },
        {
          id: "hard-single",
          name: "Hard single",
          fragment:
            "one bare hard source, sharp-edged shadows, high contrast, no bounce",
          hue: 15,
        },
        {
          id: "mixed-temperature",
          name: "Mixed temperature",
          fragment:
            "tungsten key against daylight ambient, warm subject in a cool field",
          hue: 190,
        },
      ],
    },
  },

  // --------------------------------------------------------------- characters
  {
    slug: "character-courier",
    kind: "CHARACTER",
    title: "The courier",
    summary: "A recurring figure for near-future sequences.",
    description:
      "Written to stay recognisable across frames without over-specifying a face — which is what actually breaks consistency, because every model renders a described face differently each time. The anchors here are silhouette, clothing and posture, all of which survive re-generation.",
    category: "Concept art",
    tags: ["character", "consistency", "near future"],
    hue: 150,
    official: true,
    usable: true,
    payload: {
      kind: "CHARACTER",
      character: {
        anchor:
          "a lean courier in a weathered olive shell jacket with reflective seams, cropped dark hair, a canvas satchel worn across the body, always slightly in motion",
        traits: [
          "olive shell jacket with reflective seams",
          "canvas satchel worn cross-body",
          "cropped dark hair",
          "mid-stride posture",
          "worn practical footwear",
        ],
        seed: 184_302_991,
      },
    },
  },
  {
    slug: "character-archivist",
    kind: "CHARACTER",
    title: "The archivist",
    summary: "A quiet figure for interiors and stillness.",
    description:
      "The counterpart to the courier: someone who belongs to a room rather than a street. Useful when a scene needs a human presence that does not pull focus.",
    category: "Concept art",
    tags: ["character", "consistency", "interior"],
    hue: 220,
    official: true,
    usable: true,
    payload: {
      kind: "CHARACTER",
      character: {
        anchor:
          "an older archivist in a heavy grey cardigan and wire-framed glasses, hair pinned back, hands usually occupied with paper, standing still within a larger space",
        traits: [
          "heavy grey cardigan",
          "wire-framed glasses",
          "hair pinned back",
          "hands occupied with paper",
          "still, occupying little of the frame",
        ],
        seed: 77_419_265,
      },
    },
  },

  // -------------------------------------------------------------- voice packs
  {
    slug: "voice-narration",
    kind: "VOICE_PACK",
    title: "Documentary narration",
    summary: "Four narration voices. Audio generation is not built yet.",
    description:
      "Descriptions of four narration deliveries, written for the audio pipeline that lands in a later sprint. They are catalogued now so the shape of the marketplace is complete, and they are marked unusable rather than hidden — a listing you can find and cannot use is more honest than one that quietly does not exist.",
    category: "Film",
    tags: ["voice", "narration", "documentary"],
    hue: 45,
    official: true,
    usable: false,
    unusableReason:
      "Audio generation has not been built yet. Installing this saves it for when it has.",
    payload: {
      kind: "VOICE_PACK",
      voices: [
        {
          id: "measured",
          name: "Measured",
          description:
            "Unhurried, low register, long pauses. For sequences where the picture is doing the work.",
        },
        {
          id: "warm-close",
          name: "Warm and close",
          description:
            "Intimate proximity, soft consonants, conversational pacing.",
        },
        {
          id: "reportage",
          name: "Reportage",
          description:
            "Neutral, brisk, front-of-mouth. For factual voiceover that stays out of the way.",
        },
        {
          id: "reflective",
          name: "Reflective",
          description:
            "Slower, slightly breathy, falling intonation. For retrospective narration.",
        },
      ],
    },
  },
  {
    slug: "voice-character",
    kind: "VOICE_PACK",
    title: "Character voices",
    summary: "Five character deliveries. Audio generation is not built yet.",
    description:
      "Deliveries for dialogue rather than narration — the difference being that these carry intent, and narration carries information. Catalogued ahead of the audio pipeline and marked unusable until it exists.",
    category: "Film",
    tags: ["voice", "character", "dialogue"],
    hue: 328,
    official: true,
    usable: false,
    unusableReason:
      "Audio generation has not been built yet. Installing this saves it for when it has.",
    payload: {
      kind: "VOICE_PACK",
      voices: [
        {
          id: "dry",
          name: "Dry",
          description: "Flat affect, minimal emphasis, faintly amused.",
        },
        {
          id: "urgent",
          name: "Urgent",
          description: "Clipped, forward, breath audible between phrases.",
        },
        {
          id: "weathered",
          name: "Weathered",
          description: "Gravelled low register, unhurried, worn down.",
        },
        {
          id: "bright",
          name: "Bright",
          description: "Higher placement, quick, upward intonation.",
        },
        {
          id: "guarded",
          name: "Guarded",
          description: "Quiet, held back, saying less than it knows.",
        },
      ],
    },
  },
] as const;

export function itemFor(slug: string): MarketplaceItem | undefined {
  return CATALOGUE.find((item) => item.slug === slug);
}
