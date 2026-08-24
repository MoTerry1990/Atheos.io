import type { ReferenceUse, Sourced } from "@/services/ai/creative-brief";
import {
  IMAGE_BRIEF_VERSION,
  type ImageBrief,
  type ImageRealism,
} from "@/services/ai/image-brief";
import type {
  ImageAspectRatio,
  ImageResolution,
} from "@/services/ai/image-capabilities";

/**
 * Turn a short prompt into an image brief, deterministically.
 *
 * ## The gap this closes
 *
 * `a red dragon on a castle throwing fire from its mouth` is eleven words and a
 * complete creative instruction: a subject with a colour, a place, a physical
 * relationship between them, and an action. The old path forwarded those eleven
 * words to `flux-dev` at 1:1 with two contradictory style blocks bolted on, and
 * the result was a square picture of a dragon *near* a castle.
 *
 * Nothing here is clever. It reads what the sentence actually says — including
 * the preposition, which is the part that carries the composition — and marks
 * everything it had to guess as a guess. The confirmation panel then shows the
 * guesses, which is the only reason guessing is acceptable at all.
 *
 * ## Why deterministic first, and a planner model second
 *
 * A language model would read this prompt better. It also costs money, takes a
 * second, and fails. Extraction that works offline for the common shapes means
 * the planner model is an improvement rather than a dependency — and every rule
 * here is a test rather than a prompt that might drift.
 *
 * ## Spanish and typos are first-class, not a nicety
 *
 * Half the benchmark set is Spanish. A pipeline that quietly falls back to
 * defaults for "haz un video de este carro" has not failed loudly, it has
 * produced a confident wrong answer, which is worse.
 */

// --------------------------------------------------------------------------
// Cues
// --------------------------------------------------------------------------

/**
 * Spatial prepositions, English and Spanish.
 *
 * Ordered longest-first so "on top of" wins before "on". The captured tail is
 * the anchor — `on a castle` yields the relationship "on a castle", which is
 * what has to survive into the compiled prompt.
 */
const SPATIAL =
  /\b(on top of|in front of|on board|perched on|standing on|sitting on|next to|behind|beneath|underneath|inside|above|below|over|upon|atop|on|encima de|sobre|delante de|detr[aá]s de|dentro de|junto a|en)\s+((?:the|a|an|el|la|los|las|un|una)\s+)?([a-z][\w'-]*(?:\s+[a-z][\w'-]*){0,3})/i;

/** Colour words that attach to a subject. */
const COLOURS =
  /\b(red|blue|green|black|white|golden|gold|silver|crimson|scarlet|emerald|purple|orange|yellow|grey|gray|rojo|roja|azul|verde|negro|negra|blanco|blanca|dorado|dorada|plateado|morado|amarillo|naranja|gris)\b/gi;

/** Size and condition adjectives worth preserving. */
const SCALE =
  /\b(huge|giant|enormous|massive|large|big|tiny|small|little|colossal|towering|gigante|enorme|grande|peque[nñ]o|peque[nñ]a|masivo)\b/gi;

/**
 * Aspect-ratio requests, including the spelled-out forms people actually type.
 */
const ASPECT_EXPLICIT = /\b(16:9|9:16|1:1|4:3|3:4|3:2|2:3|21:9|4:5|5:4)\b/;
const WANTS_WIDE =
  /\b(wide|widescreen|landscape|cinematic|panoramic|horizontal|apaisado|panor[aá]mic[oa]|horizontal)\b/i;
const WANTS_TALL =
  /\b(vertical|portrait|story|stories|reel|tiktok|phone|vertical|retrato)\b/i;
const WANTS_SQUARE = /\b(square|cuadrad[oa]|instagram post)\b/i;

const RESOLUTION_EXPLICIT = /\b(1k|2k|4k)\b/i;

/**
 * Cinematic intent.
 *
 * `cinematic` in a prompt is a request for a *shape* as much as a look — nobody
 * asking for a cinematic dragon wants a square. Recording it as an inference on
 * `aspectRatio` rather than silently applying it is the difference between the
 * panel being able to explain itself and not.
 */
const CINEMATIC =
  // `cinematogr[aá]fic[oa]` is a separate stem from `cin[eé]matic[oa]`, not a
  // longer form of it — "cinematográfica" is the word people actually write and
  // it does not contain "cinemático".
  /\b(cinematic|film still|movie|epic|dramatic|cinematogr[aá]fic[oa]s?|cin[eé]matic[oa]s?|pel[ií]cula|[eé]pic[oa]s?|dram[aá]tic[oa]s?)\b/i;

const ILLUSTRATED =
  /\b(illustration|illustrated|drawing|drawn|cartoon|anime|comic|painting|painted|watercolou?r|ilustraci[oó]n|dibujo|caricatura|pintura|acuarela)\b/i;
const STYLISED =
  /\b(stylis(?:ed|ed)|stylized|3d render|render|low.?poly|pixel art|isometric|estilizad[oa]|renderizado)\b/i;
const PHOTOREAL =
  /\b(photo|photorealistic|photoreal|realistic|real life|photograph|fotorrealista|realista|fotograf[ií]a)\b/i;

/** "make it more realistic" and friends — a revision, not a new image. */
const MORE_REALISTIC =
  /\b(more realistic|photorealistic|make it real|m[aá]s realista|m[aá]s real)\b/i;

const NIGHT = /\b(night|midnight|nocturn[ae]|noche|nocturno)\b/i;
const STORMY =
  /\b(storm|stormy|thunder|lightning|tempest|tormenta|tormentos[oa]|rel[aá]mpago)\b/i;
const SUNSET =
  /\b(sunset|dusk|golden hour|sunrise|dawn|atardecer|amanecer|ocaso)\b/i;

/** Fire, smoke, water — light sources and volumetrics worth naming. */
const FIRE = /\b(fire|flame|flames|burning|blaze|fuego|llama|llamas|fuego)\b/i;

const EXCLUDE =
  /\b(?:no|without|sin)\s+([a-z][\w'-]*(?:\s+[a-z][\w'-]*){0,2})/gi;

/** Words that must appear in the picture. */
const TEXT_IN_IMAGE =
  /\b(?:with the (?:word|text)|that says|reading|con el texto|que diga)\s+["“']?([^"”'.,]{1,40})["”']?/i;

// --------------------------------------------------------------------------
// Sourced helpers, local so the cue and its reason stay together
// --------------------------------------------------------------------------

function explicit<T>(value: T, because: string): Sourced<T> {
  return { value, from: "explicit", because };
}
function inferred<T>(
  value: T,
  confidence: number,
  because: string,
): Sourced<T> {
  return { value, from: "inferred", confidence, because };
}
function fallback<T>(value: T, because: string): Sourced<T> {
  return { value, from: "default", because };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.toLowerCase().trim()))].filter(
    Boolean,
  );
}

export interface ImagePlannerInput {
  prompt: string;
  referenceImageCount?: number;
  /** Controls the composer already shows. Explicit beats inferred. */
  controls?: {
    aspectRatio?: ImageAspectRatio;
    resolution?: ImageResolution;
  };
}

/**
 * The subject, and what is being done.
 *
 * Deliberately crude: the first noun phrase before a spatial preposition or a
 * verb-ing. Being wrong here is survivable because the panel shows it and the
 * user can correct it; being *silent* here is not, because then nothing shows.
 */
function extractSubject(prompt: string): { subject: string; action: string } {
  const text = prompt.trim().replace(/^(a|an|the|un|una|el|la)\s+/i, "");

  // "…throwing fire from its mouth" / "…lanzando fuego"
  const actionMatch = text.match(
    /\b((?:throwing|breathing|shooting|spitting|firing|flying|running|driving|standing|walking|jumping|holding|launching|lanzando|escupiendo|volando|corriendo|conduciendo|sosteniendo)\b[^,.]*)/i,
  );
  const action = actionMatch ? actionMatch[1].trim() : "";

  // Everything before the spatial preposition or the action is the subject.
  let subject = text;
  const spatial = text.match(SPATIAL);
  if (spatial && spatial.index !== undefined) {
    subject = text.slice(0, spatial.index);
  }
  if (actionMatch && actionMatch.index !== undefined) {
    subject = subject.slice(0, Math.min(subject.length, actionMatch.index));
  }
  subject = subject.replace(/[,;.]+\s*$/, "").trim();

  return { subject: subject || text.split(/[,.]/)[0].trim(), action };
}

export function planImageFromPrompt(input: ImagePlannerInput): ImageBrief {
  const prompt = input.prompt;
  const lower = prompt.toLowerCase();
  const refCount = input.referenceImageCount ?? 0;

  const { subject, action } = extractSubject(prompt);

  // --- attributes -------------------------------------------------------
  const colours = unique(prompt.match(COLOURS) ?? []);
  const scales = unique(prompt.match(SCALE) ?? []);
  const attributes = [...colours, ...scales];

  // --- spatial ----------------------------------------------------------
  const spatial = prompt.match(SPATIAL);
  const relationship = spatial
    ? `${spatial[1].toLowerCase()} ${(spatial[2] ?? "").trim()} ${spatial[3]}`
        .replace(/\s+/g, " ")
        .trim()
    : "";
  const setting = spatial ? spatial[3].trim() : "";

  // --- realism ----------------------------------------------------------
  let realism: Sourced<ImageRealism>;
  if (ILLUSTRATED.test(lower)) {
    realism = explicit("illustrated", "you asked for an illustrated look");
  } else if (STYLISED.test(lower)) {
    realism = explicit("stylised", "you asked for a stylised look");
  } else if (PHOTOREAL.test(lower) || MORE_REALISTIC.test(lower)) {
    realism = explicit("photorealistic", "you asked for realism");
  } else if (CINEMATIC.test(lower)) {
    realism = inferred(
      "photorealistic",
      0.7,
      "a cinematic scene usually means a photographic look",
    );
  } else {
    realism = fallback(
      "photorealistic",
      "photographic unless you say otherwise",
    );
  }

  // --- aspect ratio -----------------------------------------------------
  let aspectRatio: Sourced<ImageAspectRatio>;
  const explicitAspect = prompt.match(ASPECT_EXPLICIT);
  if (input.controls?.aspectRatio) {
    aspectRatio = explicit(
      input.controls.aspectRatio,
      "you set this in the composer",
    );
  } else if (explicitAspect) {
    aspectRatio = explicit(
      explicitAspect[1] as ImageAspectRatio,
      `you wrote "${explicitAspect[1]}"`,
    );
  } else if (WANTS_TALL.test(lower)) {
    aspectRatio = inferred("9:16", 0.8, "you asked for a vertical image");
  } else if (WANTS_SQUARE.test(lower)) {
    aspectRatio = inferred("1:1", 0.8, "you asked for a square image");
  } else if (WANTS_WIDE.test(lower) || CINEMATIC.test(lower)) {
    aspectRatio = inferred(
      "16:9",
      0.75,
      "a wide frame suits a scene like this — a square would crop the setting away",
    );
  } else if (relationship) {
    /**
     * A subject placed *in* an environment is an establishing shot, and an
     * establishing shot in a square is the benchmark's exact failure: the
     * castle had nowhere to be.
     */
    aspectRatio = inferred(
      "16:9",
      0.6,
      "your subject sits in a place, so the frame needs room for both",
    );
  } else {
    aspectRatio = fallback("1:1", "square unless the scene needs more width");
  }

  // --- resolution -------------------------------------------------------
  let resolution: Sourced<ImageResolution>;
  const explicitRes = prompt.match(RESOLUTION_EXPLICIT);
  if (input.controls?.resolution) {
    resolution = explicit(
      input.controls.resolution,
      "you set this in the composer",
    );
  } else if (explicitRes) {
    resolution = explicit(
      explicitRes[1].toUpperCase() as ImageResolution,
      `you wrote "${explicitRes[1]}"`,
    );
  } else {
    resolution = fallback(
      "2K",
      "2K is the Smart Image default — a 1K file is a draft, not a deliverable",
    );
  }

  // --- light and mood ---------------------------------------------------
  const lightingParts: string[] = [];
  if (FIRE.test(lower)) {
    lightingParts.push(
      "firelight as the key source, warm and directional, visibly falling on the subject and the surroundings",
    );
  }
  if (NIGHT.test(lower)) lightingParts.push("night");
  if (STORMY.test(lower)) lightingParts.push("heavy overcast storm light");
  if (SUNSET.test(lower)) lightingParts.push("low golden sun");

  const lighting = lightingParts.length
    ? inferred(
        lightingParts.join(", "),
        0.7,
        FIRE.test(lower)
          ? "you described fire, so the fire should be lighting the scene"
          : "read from the time of day you described",
      )
    : fallback(
        "natural directional light",
        "unremarkable light unless you say otherwise",
      );

  const mood = STORMY.test(lower)
    ? inferred("dramatic and threatening", 0.6, "a storm sets the mood")
    : CINEMATIC.test(lower)
      ? inferred(
          "cinematic and dramatic",
          0.6,
          "you asked for a cinematic image",
        )
      : fallback("neutral", "no mood was described");

  const colorPalette = colours.length
    ? inferred(
        `${colours.join(" and ")} as the dominant colour`,
        0.8,
        `you named ${colours.join(" and ")}`,
      )
    : fallback("naturalistic colour", "no palette was described");

  // --- composition ------------------------------------------------------
  const wide = aspectRatio.value === "16:9" || aspectRatio.value === "21:9";
  const composition = relationship
    ? inferred(
        `wide establishing composition with the subject ${relationship}`,
        0.7,
        "your prompt places the subject somewhere, which is an establishing shot",
      )
    : fallback("centred subject", "no composition was described");

  const cameraFraming = wide
    ? inferred("wide shot", 0.7, "a wide frame needs a wide shot to fill it")
    : fallback("medium shot", "a safe default framing");

  const cameraAngle = relationship
    ? inferred(
        "slightly low angle",
        0.5,
        "looking up gives the subject scale against its surroundings",
      )
    : fallback("eye level", "no angle was described");

  const lensLook = CINEMATIC.test(lower)
    ? inferred(
        "wide cinema lens, deep focus",
        0.6,
        "you asked for a cinematic look",
      )
    : fallback("natural perspective", "no lens was described");

  // --- depth ------------------------------------------------------------
  const background = setting
    ? inferred(setting, 0.7, `you placed the subject at "${setting}"`)
    : fallback("simple background", "no background was described");

  const middleGround = setting
    ? inferred(
        `${setting}, with details that give it scale`,
        0.5,
        "a place needs something in it to read as big",
      )
    : fallback(
        "empty",
        "nothing was described between the subject and the background",
      );

  const foreground = fallback(
    "clear",
    "nothing was described in the foreground",
  );

  // --- exclusions and text ----------------------------------------------
  const exclusions = unique(
    [...prompt.matchAll(EXCLUDE)].map((m) => m[1]).filter(Boolean),
  );
  const textMatch = prompt.match(TEXT_IN_IMAGE);

  // --- references -------------------------------------------------------
  const use: ReferenceUse = refCount > 0 ? "preserve_exactly" : "style_only";
  const references =
    refCount > 0
      ? explicit(
          { count: refCount, use },
          `you attached ${refCount} reference${refCount === 1 ? "" : "s"}`,
        )
      : fallback({ count: 0, use }, "no references attached");

  const brief: ImageBrief = {
    kind: "image",
    version: IMAGE_BRIEF_VERSION,
    originalPrompt: prompt,

    primarySubject: subject
      ? explicit(subject, "read from your prompt")
      : fallback("the described subject", "no subject could be read"),
    subjectAttributes: attributes.length
      ? explicit(attributes, `you wrote ${attributes.join(", ")}`)
      : fallback([], "no attributes were described"),
    action: action
      ? explicit(action, "read from your prompt")
      : fallback("", "no action was described"),
    setting: setting
      ? explicit(setting, "read from your prompt")
      : fallback("", "no setting was described"),
    spatialRelationships: relationship
      ? explicit([relationship], `you wrote "${relationship}"`)
      : fallback([], "no spatial relationship was described"),

    composition,
    cameraFraming,
    cameraAngle,
    lensLook,
    lighting,
    colorPalette,
    mood,
    realism,

    foreground,
    middleGround,
    background,

    aspectRatio,
    resolution,
    references,
    textRequirements: textMatch
      ? explicit([textMatch[1].trim()], "you asked for text in the image")
      : fallback([], "no text was requested"),
    exclusions: exclusions.length
      ? explicit(exclusions, "you said what you did not want")
      : fallback([], "nothing was excluded"),

    /**
     * What the user must actually agree to.
     *
     * Deliberately short. Requiring confirmation of `foreground` would put a
     * question in front of every generation for a field nobody typed, and a
     * panel that asks about everything gets clicked through without reading —
     * which is the same as not asking.
     */
    required: ["primarySubject", "aspectRatio", "resolution"],
    overallConfidence: 0,
  };

  brief.overallConfidence = imageConfidence(brief);
  return brief;
}

/** How much of the brief the user actually said, weighted toward what matters. */
function imageConfidence(brief: ImageBrief): number {
  const weighted: [keyof ImageBrief, number][] = [
    ["primarySubject", 3],
    ["action", 2],
    ["setting", 2],
    ["spatialRelationships", 3],
    ["aspectRatio", 2],
    ["realism", 1],
    ["lighting", 1],
  ];
  let total = 0;
  let got = 0;
  for (const [field, weight] of weighted) {
    total += weight;
    const entry = brief[field] as unknown as Sourced<unknown>;
    if (
      entry.from === "explicit" ||
      entry.from === "confirmed" ||
      entry.from === "edited"
    ) {
      got += weight;
    } else if (entry.from === "inferred") {
      got += weight * (entry.confidence ?? 0.5);
    }
  }
  return total === 0 ? 0 : Math.round((got / total) * 100) / 100;
}

export interface ImageClarification {
  field: string;
  question: string;
  options: { label: string; value: unknown; recommended?: boolean }[];
}

/**
 * At most three questions, and only ones whose answer changes the picture.
 *
 * Ordered by how much the answer costs to get wrong. Shape is first because it
 * cannot be fixed afterwards without regenerating, and it is the field the
 * benchmark got wrong.
 */
export function imageClarificationsFor(
  brief: ImageBrief,
): ImageClarification[] {
  const out: ImageClarification[] = [];

  if (
    brief.aspectRatio.from === "inferred" ||
    brief.aspectRatio.from === "default"
  ) {
    out.push({
      field: "aspectRatio",
      question: "What shape should this be?",
      options: [
        {
          label: "Wide 16:9",
          value: "16:9",
          recommended: brief.aspectRatio.value === "16:9",
        },
        {
          label: "Square 1:1",
          value: "1:1",
          recommended: brief.aspectRatio.value === "1:1",
        },
        {
          label: "Tall 9:16",
          value: "9:16",
          recommended: brief.aspectRatio.value === "9:16",
        },
      ],
    });
  }

  if (brief.realism.from === "inferred" || brief.realism.from === "default") {
    out.push({
      field: "realism",
      question: "How should it look?",
      options: [
        {
          label: "Photographic",
          value: "photorealistic",
          recommended: brief.realism.value === "photorealistic",
        },
        { label: "Stylised", value: "stylised" },
        { label: "Illustrated", value: "illustrated" },
      ],
    });
  }

  if (brief.resolution.from === "default") {
    out.push({
      field: "resolution",
      question: "How large?",
      options: [
        { label: "2K — recommended", value: "2K", recommended: true },
        { label: "1K — faster and cheaper", value: "1K" },
        { label: "4K — largest", value: "4K" },
      ],
    });
  }

  return out.slice(0, 3);
}
