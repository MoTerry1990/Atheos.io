/**
 * What a short prompt is actually asking for.
 *
 * ## The gap this fills
 *
 * `intent-planner.ts` reads duration, aspect ratio, resolution, shot count and
 * style keywords. It does **not** read the scene: `primarySubject` came back
 * empty with the reason "not identified without a planner call", and so did
 * `environment` and `action`. Every composition decision downstream was
 * therefore made against a blank brief, which is why "a red dragon on a castle
 * breathing fire" produced a generic close-up instead of a castle with a dragon
 * on it.
 *
 * ## Deterministic, not a model call
 *
 * No LLM. A short prompt of the form *subject → preposition → place* is
 * regular enough to parse, and a deterministic parser has three properties a
 * model call does not: it costs nothing, it cannot hallucinate a subject the
 * user did not mention, and it returns the same answer twice — which matters
 * because the brief is hashed into a signed plan token.
 *
 * The cost is coverage. This understands common English scene prompts and says
 * so honestly when it does not: every field carries its own confidence, and a
 * low one is what makes the studio ask rather than assume.
 *
 * ## Why the environment is treated as essential
 *
 * "A dragon on a castle" names a place, and a place in a prompt is a request to
 * see it. The failure being corrected is the opposite reading — subject fills
 * the frame, location becomes a blurred backdrop — which is what a bare
 * text-to-image model does by default and what makes output look like stock
 * art rather than a scene.
 */

export type ShotScale =
  "extreme_close" | "close" | "medium" | "wide" | "extreme_wide";

export type CameraHeight = "low" | "eye" | "elevated" | "aerial";

export type FramingPreference = "show_world" | "balanced" | "focus_subject";

export interface SceneIntent {
  subject: string;
  action: string;
  environment: string;
  /**
   * The preposition the user actually wrote — "on", "in", "beside".
   *
   * Kept because a compiled sentence has to say "in a forest", not "on a
   * forest". Guessing one preposition for every place is how a wolf ends up
   * standing on top of a wood.
   */
  environmentPreposition: string;
  /** True when the prompt names a place worth showing. */
  environmentIsEssential: boolean;
  shotScale: ShotScale;
  /** Fraction of frame the subject should occupy, 0–1. */
  subjectOccupancy: number;
  cameraHeight: CameraHeight;
  /** Millimetres, as a family rather than a precise lens. */
  lensMm: number;
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5";
  aspectReason: string;
  foreground: string;
  midground: string;
  background: string;
  /** 0–1. Low means the studio should ask rather than assume. */
  confidence: number;
  /**
   * True when the subject was genuinely *separated* from the rest of the
   * prompt — a place or an action split it out.
   *
   * False means `subject` holds the whole prompt because nothing parsed, which
   * is a copy rather than an extraction. The planner refuses to promote that
   * into the brief: a derived field carrying raw prompt text is a route for
   * injected instructions to appear under "Atheos understood", where the
   * interface lends them authority they have not earned.
   */
  subjectExtracted: boolean;
  /** Which parts were read from the user's words rather than inferred. */
  explicit: {
    shotScale: boolean;
    aspectRatio: boolean;
    environment: boolean;
  };
}

// ---------------------------------------------------------------------------
// Lexicons
// ---------------------------------------------------------------------------

/**
 * Places worth showing.
 *
 * Deliberately a list rather than a part-of-speech tagger. A tagger would find
 * *nouns*, and most nouns are not locations — "a dragon breathing fire" would
 * make "fire" an environment. What matters here is not grammar but whether the
 * word denotes somewhere a camera could stand.
 */
const PLACES = [
  // Built
  "castle",
  "city",
  "town",
  "village",
  "street",
  "alley",
  "rooftop",
  "bridge",
  "cathedral",
  "temple",
  "palace",
  "fortress",
  "tower",
  "ruins",
  "harbour",
  "harbor",
  "port",
  "station",
  "airport",
  "warehouse",
  "factory",
  "stadium",
  "market",
  "plaza",
  "square",
  "highway",
  "road",
  "railway",
  "tunnel",
  // Interior
  "living room",
  "kitchen",
  "bedroom",
  "office",
  "studio",
  "gallery",
  "museum",
  "library",
  "cafe",
  "restaurant",
  "bar",
  "hall",
  "lobby",
  "workshop",
  // Natural
  "forest",
  "woods",
  "jungle",
  "desert",
  "mountain",
  "mountains",
  "valley",
  "canyon",
  "cliff",
  "cliffs",
  "beach",
  "coast",
  "coastline",
  "ocean",
  "sea",
  "lake",
  "river",
  "waterfall",
  "field",
  "meadow",
  "prairie",
  "swamp",
  "cave",
  "glacier",
  "tundra",
  "island",
  "volcano",
  "reef",
  "sky",
  "space",
  // Weather-as-place
  "storm",
  "snow",
  "fog",
  "mist",
];

/**
 * Does this text name that place, as a whole word?
 *
 * Substring matching is not good enough: "portrait" contains "port", so a
 * bare `includes` turned every portrait prompt into a harbour scene and then
 * chose 16:9 for it. Multi-word places need the boundary at each end of the
 * phrase rather than around each word.
 */
function namesPlace(text: string, place: string): boolean {
  const spaced = place.replace(/ /g, "\\s+");
  return new RegExp(`\\b${spaced}\\b`, "i").test(text);
}

/**
 * Verbs a subject actually does.
 *
 * A whitelist rather than `\w+ing`, because that pattern matches adjectives and
 * compound nouns — "a premium **streaming** device" became the action
 * "streaming device" and left the subject as "a premium". English does not
 * distinguish these by shape, so the only deterministic separator is knowing
 * which words are verbs here.
 */
const ACTION_VERBS = [
  "breathing",
  "flying",
  "walking",
  "running",
  "driving",
  "riding",
  "standing",
  "sitting",
  "jumping",
  "swimming",
  "dancing",
  "climbing",
  "falling",
  "floating",
  "burning",
  "glowing",
  "roaring",
  "hunting",
  "resting",
  "sleeping",
  "watching",
  "looking",
  "holding",
  "carrying",
  "pushing",
  "pulling",
  "throwing",
  "catching",
  "playing",
  "singing",
  "reading",
  "writing",
  "cooking",
  "drinking",
  "eating",
  "smiling",
  "laughing",
  "crying",
  "waiting",
  "moving",
  "turning",
  "rising",
  "sinking",
  "crashing",
  "exploding",
  "racing",
  "chasing",
  "landing",
  "taking off",
  "emerging",
  "approaching",
  "leaving",
  "arriving",
  "pressing",
  "reaching",
  "pointing",
];

/** The first action verb in the text, with its short object phrase. */
function findAction(text: string): { phrase: string; index: number } | null {
  let best: { phrase: string; index: number } | null = null;

  /** Determiners and particles an action may carry before its object. */
  const carry =
    "(?:a|an|the|its|his|her|their|into|onto|over|through|across|down|up)?";

  for (const verb of ACTION_VERBS) {
    const match = text.match(
      new RegExp(`\\b(${verb}\\b(?:\\s+${carry}\\s*[\\w-]+){0,2})`, "i"),
    );
    if (match && match.index !== undefined) {
      if (!best || match.index < best.index) {
        best = { phrase: match[1].trim(), index: match.index };
      }
    }
  }

  return best;
}

/** Prepositions that put a subject somewhere. */
const PLACE_PREPOSITIONS = [
  "on top of",
  "in front of",
  "in the middle of",
  "at the edge of",
  "beside",
  "besides",
  "inside",
  "outside",
  "within",
  "above",
  "below",
  "across",
  "through",
  "against",
  "around",
  "behind",
  "between",
  "beneath",
  "under",
  "over",
  "near",
  "beyond",
  "along",
  "amid",
  "among",
  "atop",
  "on",
  "in",
  "at",
  "by",
];

/** Words that mean the user has chosen the framing themselves. */
const SCALE_WORDS: { pattern: RegExp; scale: ShotScale; occupancy: number }[] =
  [
    {
      pattern: /\b(extreme close[- ]?up|macro)\b/i,
      scale: "extreme_close",
      occupancy: 0.85,
    },
    {
      pattern: /\b(close[- ]?up|closeup|portrait of|head ?shot)\b/i,
      scale: "close",
      occupancy: 0.6,
    },
    {
      pattern: /\b(product (shot|detail)|detail shot)\b/i,
      scale: "close",
      occupancy: 0.65,
    },
    {
      pattern: /\b(medium shot|waist up|half[- ]body)\b/i,
      scale: "medium",
      occupancy: 0.45,
    },
    {
      pattern: /\b(wide|establishing|landscape|panoram(a|ic)|vista|scenery)\b/i,
      scale: "wide",
      occupancy: 0.25,
    },
    {
      pattern: /\b(extreme wide|aerial|drone|bird'?s[- ]eye|satellite)\b/i,
      scale: "extreme_wide",
      occupancy: 0.12,
    },
  ];

/** Explicit ratio requests. */
const ASPECT_WORDS: { pattern: RegExp; ratio: SceneIntent["aspectRatio"] }[] = [
  { pattern: /\b(16[:\s]?9|widescreen|cinematic ratio)\b/i, ratio: "16:9" },
  {
    pattern:
      /\b(9[:\s]?16|vertical|portrait mode|tiktok|reels?|stories|shorts)\b/i,
    ratio: "9:16",
  },
  { pattern: /\b(4[:\s]?5|instagram post)\b/i, ratio: "4:5" },
  { pattern: /\b(1[:\s]?1|square)\b/i, ratio: "1:1" },
];

/** Subjects that are people, which changes the sensible portrait ratio. */
const PEOPLE = [
  "man",
  "woman",
  "person",
  "girl",
  "boy",
  "child",
  "model",
  "portrait",
  "face",
  "figure",
  "dancer",
  "athlete",
  "chef",
  "musician",
  "worker",
];

/** Things photographed alone, where a square crop is reasonable. */
const PRODUCTS = [
  "product",
  "bottle",
  "watch",
  "phone",
  "shoe",
  "sneaker",
  "perfume",
  "cosmetic",
  "packaging",
  "box",
  "device",
  "gadget",
  "logo",
  "icon",
  "jewellery",
  "jewelry",
  "ring",
  "handbag",
  "camera",
  "headphones",
];

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Read a prompt into a composition.
 *
 * Never throws and never returns an empty subject when the prompt has words in
 * it: an unparsed prompt falls back to using the whole text as the subject with
 * low confidence, because the honest failure is "I am not sure what this is"
 * rather than "there is no subject here".
 */
export function readSceneIntent(prompt: string): SceneIntent {
  const text = prompt.trim();
  const lower = text.toLowerCase();

  const environment = findEnvironment(lower, text);
  const { subject, action } = splitSubjectAndAction(text, environment.phrase);

  const scale = decideScale(lower, environment.found);
  const aspect = decideAspect(lower, subject, environment.found, scale.scale);
  /**
   * Depth planes are built from the *extracted* subject only.
   *
   * When nothing parsed, `subject` holds the whole prompt — and putting that
   * into a derived field is how injected instructions reach a structured part
   * of the brief, where the interface presents them as something Atheos
   * understood rather than as the user's raw text.
   */
  const extracted = Boolean(
    subject && (environment.found || action) && subject !== text,
  );
  const depth = describeDepth(
    extracted ? subject : "",
    environment.phrase,
    environment.found,
  );

  /**
   * Confidence is deliberately conservative.
   *
   * A parsed subject *and* a recognised place is the case this handles well.
   * Everything else is a partial read, and saying so is what makes the studio
   * ask a question rather than commit to a guess.
   */
  const confidence =
    (subject ? 0.4 : 0) +
    (environment.found ? 0.35 : 0) +
    (action ? 0.15 : 0) +
    (scale.explicit || aspect.explicit ? 0.1 : 0.05);

  return {
    subject,
    action,
    environmentPreposition: environment.preposition,
    subjectExtracted: extracted,
    environment: environment.phrase,
    environmentIsEssential: environment.found,
    shotScale: scale.scale,
    subjectOccupancy: scale.occupancy,
    cameraHeight: decideCameraHeight(lower, scale.scale, environment.found),
    lensMm: decideLens(scale.scale, environment.found),
    aspectRatio: aspect.ratio,
    aspectReason: aspect.reason,
    foreground: depth.foreground,
    midground: depth.midground,
    background: depth.background,
    confidence: Math.min(1, Number(confidence.toFixed(2))),
    explicit: {
      shotScale: scale.explicit,
      aspectRatio: aspect.explicit,
      environment: environment.found,
    },
  };
}

/** The place named in the prompt, if it names one. */
function findEnvironment(
  lower: string,
  original: string,
): {
  phrase: string;
  found: boolean;
  prepositionIndex: number;
  preposition: string;
} {
  // Longest first, so "living room" beats "room" and "on top of" beats "on".
  const places = [...PLACES].sort((a, b) => b.length - a.length);

  for (const preposition of PLACE_PREPOSITIONS) {
    const at = lower.indexOf(` ${preposition} `);
    if (at === -1) continue;

    const after = lower.slice(at + preposition.length + 2);
    const place = places.find((p) => namesPlace(after, p));
    if (!place) continue;

    /**
     * Take the phrase as the user wrote it, from the preposition to the end of
     * the clause. "a castle" reads better in a compiled prompt than "castle",
     * and keeping their article and adjectives means "a large city" survives.
     */
    const start = at + preposition.length + 2;
    let clause = original.slice(start).split(/,|\.|;| while | as /i)[0];

    /**
     * Stop before an action.
     *
     * "on a castle breathing fire" would otherwise make the environment "a
     * castle breathing fire" — swallowing the action, leaving nothing for the
     * action field, and describing a castle that breathes.
     */
    const trailing = findAction(clause);
    if (trailing && trailing.index > 0) {
      clause = clause.slice(0, trailing.index);
    }

    return {
      phrase: clause.trim().replace(/\s+/g, " "),
      found: true,
      prepositionIndex: at,
      preposition,
    };
  }

  // A place named without a preposition — "castle at sunset", "forest scene".
  const bare = places.find((p) => namesPlace(lower, p));
  if (bare) {
    return {
      phrase: bare,
      found: true,
      prepositionIndex: -1,
      preposition: "in",
    };
  }

  return { phrase: "", found: false, prepositionIndex: -1, preposition: "in" };
}

/**
 * Split what the prompt is about from what it is doing.
 *
 * The subject is whatever precedes the place. The action is a trailing
 * participle — "breathing fire", "driving", "walking" — which English puts
 * either before the preposition or after the place, so both are checked.
 */
function splitSubjectAndAction(
  original: string,
  environmentPhrase: string,
): { subject: string; action: string } {
  let head = original;

  if (environmentPhrase) {
    // Cut at the preposition that introduced the place.
    for (const preposition of PLACE_PREPOSITIONS) {
      const at = head.toLowerCase().indexOf(` ${preposition} `);
      if (at !== -1) {
        head = head.slice(0, at);
        break;
      }
    }
  }

  // An action before the place: "a car driving beside the ocean".
  const leading = findAction(head);

  let subject = head;
  let action = "";

  if (leading && leading.index > 0) {
    subject = head.slice(0, leading.index).trim();
    action = leading.phrase;
  }

  // Or after it: "a dragon on a castle breathing fire".
  if (!action && environmentPhrase) {
    const at = original.toLowerCase().indexOf(environmentPhrase.toLowerCase());
    if (at !== -1) {
      const trailing = findAction(
        original.slice(at + environmentPhrase.length),
      );
      if (trailing) action = trailing.phrase;
    }
  }

  /**
   * Remove the framing words from the subject.
   *
   * "Close-up portrait of a wolf" has already been read as a *scale*; leaving
   * the words in the subject makes the compiler write "Close-up of Close-up
   * portrait of a wolf". The instruction and the thing being framed are
   * different fields and must not both carry it.
   */
  subject = subject
    .replace(
      /^\s*(an?\s+)?(extreme\s+)?(close[- ]?up|closeup|macro|wide|establishing|aerial|drone|medium)\s+(shot|view|portrait|detail)?\s*(of\s+)?/i,
      "",
    )
    .replace(/^\s*(portrait|photo|image|picture|shot|view)\s+of\s+/i, "")
    .replace(/\.$/, "")
    .replace(/\s+/g, " ")
    .trim();

  return { subject, action };
}

/** How close the camera should be. */
function decideScale(
  lower: string,
  hasEnvironment: boolean,
): { scale: ShotScale; occupancy: number; explicit: boolean } {
  for (const entry of SCALE_WORDS) {
    if (entry.pattern.test(lower)) {
      // The user said it. Their word is final — this is the override the
      // environmental default must never beat.
      return { scale: entry.scale, occupancy: entry.occupancy, explicit: true };
    }
  }

  /**
   * The default that fixes the reported failure.
   *
   * A named place means the place is part of the request, so the frame has to
   * contain it: a wide composition with the subject around a quarter of the
   * frame. Without a place there is nothing to establish and a medium shot is
   * the safer neutral.
   */
  return hasEnvironment
    ? { scale: "wide", occupancy: 0.27, explicit: false }
    : { scale: "medium", occupancy: 0.5, explicit: false };
}

/** Which shape the frame should be, and why. */
function decideAspect(
  lower: string,
  subject: string,
  hasEnvironment: boolean,
  scale: ShotScale,
): { ratio: SceneIntent["aspectRatio"]; reason: string; explicit: boolean } {
  for (const entry of ASPECT_WORDS) {
    if (entry.pattern.test(lower)) {
      return {
        ratio: entry.ratio,
        reason: "you asked for this shape",
        explicit: true,
      };
    }
  }

  const subjectLower = subject.toLowerCase();
  const isPerson = PEOPLE.some((p) => subjectLower.includes(p));
  const isProduct = PRODUCTS.some((p) => subjectLower.includes(p));

  if (hasEnvironment) {
    return {
      ratio: "16:9",
      reason: "this describes a wide environmental scene",
      explicit: false,
    };
  }

  if (isPerson && (scale === "close" || scale === "extreme_close")) {
    return {
      ratio: "4:5",
      reason: "a portrait of a person reads better slightly tall",
      explicit: false,
    };
  }

  if (isProduct) {
    return {
      ratio: "1:1",
      reason: "an isolated product sits naturally in a square",
      explicit: false,
    };
  }

  return {
    ratio: "16:9",
    reason: "cinematic framing is the safer default",
    explicit: false,
  };
}

/** Where the camera stands. */
function decideCameraHeight(
  lower: string,
  scale: ShotScale,
  hasEnvironment: boolean,
): CameraHeight {
  if (/\b(aerial|drone|bird'?s[- ]eye|from above|overhead)\b/i.test(lower)) {
    return "aerial";
  }
  if (/\b(low angle|from below|worm'?s[- ]eye|ground level)\b/i.test(lower)) {
    return "low";
  }
  if (scale === "extreme_wide") return "aerial";

  /**
   * Slightly elevated for a wide environmental shot.
   *
   * Eye level on a landscape flattens it — the midground stacks against the
   * background and the depth the scene was chosen for disappears. A little
   * height separates the planes.
   */
  return hasEnvironment && scale === "wide" ? "elevated" : "eye";
}

/**
 * A lens family, not a precise focal length.
 *
 * Wide scenes want a lens that keeps the whole location in frame without the
 * bowed horizon of an ultra-wide; close work wants enough compression that
 * faces and products are not distorted. These are the two mistakes a naive
 * "cinematic" prompt makes in either direction.
 */
function decideLens(scale: ShotScale, hasEnvironment: boolean): number {
  switch (scale) {
    case "extreme_wide":
      return 18;
    case "wide":
      return hasEnvironment ? 28 : 35;
    case "medium":
      return 50;
    case "close":
      return 85;
    case "extreme_close":
      return 100;
  }
}

/**
 * Three planes, so the image has depth rather than a subject on a backdrop.
 *
 * Generic on purpose. Inventing specific foreground objects the user never
 * mentioned is how a prompt acquires a rowboat nobody asked for; naming the
 * *role* of each plane gives the model depth to build without adding content.
 */
function describeDepth(
  subject: string,
  environment: string,
  hasEnvironment: boolean,
): { foreground: string; midground: string; background: string } {
  if (!hasEnvironment) {
    return {
      foreground: "",
      midground: subject,
      background: "a simple uncluttered backdrop",
    };
  }

  return {
    foreground: "natural detail near the camera to establish depth",
    midground: subject ? `${subject}, clearly placed in the scene` : "",
    background: environment
      ? `${environment}, complete and unclipped`
      : "the wider location",
  };
}
