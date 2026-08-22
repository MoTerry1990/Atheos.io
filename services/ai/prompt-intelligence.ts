/**
 * Structured prompts, for images and for video.
 *
 * ## Why a structure rather than a longer string
 *
 * `services/ai/enhance.ts` already turns "a cat on a roof" into a paragraph. It
 * is genuinely useful and it is not enough, because a paragraph has no parts:
 * nothing can check that the camera the user asked for survived, nothing can
 * re-render the same intent for a different model, and nothing can tell an
 * aerial request from a ground-level one after the fact.
 *
 * A structure can be validated, scored, diffed against the output, and rendered
 * differently per provider. The string is what the model sees; the structure is
 * what we can reason about.
 *
 * ## Both media types, one core
 *
 * Subject, environment, lighting, palette and composition mean the same thing
 * whether the result moves. Video adds camera platform, motion and — the part
 * that has no image equivalent — constraints that must hold *across frames*.
 * Splitting them into two unrelated schemas would duplicate the half that is
 * shared and let the two halves drift.
 *
 * ## What this cannot do, stated plainly
 *
 * None of the video models Atheos ships accepts a camera parameter. Sprint 5D
 * read both OpenAPI schemas: `wan-2.2-t2v-fast` takes prompt, seed, frames, fps,
 * resolution and aspect ratio; `seedance-1-lite` adds images and a `camera_fixed`
 * boolean. There is no "aerial" input on either.
 *
 * So camera control here is **prompt engineering, not an API contract**. This
 * module orders and phrases the words to give the model its best chance, and
 * `services/ai/video-quality.ts` scores whether it worked. Anything stronger
 * would be a claim the providers do not support.
 */

export type MediaType = "image" | "video";

/** Shared by both media types: what is in frame, and how it looks. */
export interface SceneIntent {
  /** The thing the shot is about. "a red convertible on a coastal road". */
  subject: string;
  /** Where it is. Kept separate so it can be held constant across frames. */
  environment: string;
  lighting: string;
  colorPalette: string;
  composition: string;
  /** Photographic or illustrative treatment. */
  style: string;
  /** Things that must not appear. Rendered into `negative_prompt` when the
   *  model has one, and into the prompt text when it does not. */
  negative: readonly string[];
}

/**
 * How the camera is placed and what it does.
 *
 * Every field is a phrase rather than a number because these become caption
 * text. Video models are trained on captions, not on a control API — see the
 * note in `services/ai/motion.ts`.
 */
export interface CameraIntent {
  /** "drone", "handheld", "tripod", "vehicle mount". */
  platform: string;
  /** "high aerial", "eye level", "low angle". */
  height: string;
  /** "oblique top-down", "three-quarter", "straight on". */
  angle: string;
  /** "smooth parallel tracking shot", "static camera". */
  motion: string;
  /** "extreme wide shot", "medium shot", "close-up". */
  shotSize: string;
}

/** Constraints that only mean something across time. */
export interface TemporalIntent {
  subjectMotion: string;
  motionDirection: string;
  motionStrength: "subtle" | "moderate" | "strong";
  durationSeconds: number;
  frameRateTarget: number;
  /** Facts that must hold in **every** frame. */
  constraints: readonly string[];
  /** Motion and camera behaviour that must never happen. */
  negativeMotion: readonly string[];
}

export interface ImagePrompt extends SceneIntent {
  mediaType: "image";
  camera: CameraIntent;
}

export interface VideoPrompt extends SceneIntent {
  mediaType: "video";
  camera: CameraIntent;
  temporal: TemporalIntent;
}

export type StructuredPrompt = ImagePrompt | VideoPrompt;

/**
 * Camera behaviour a request can never be reinterpreted into.
 *
 * These are the specific wrong answers an aerial request tends to produce: a
 * model that has seen a great many car videos will happily give you a bumper
 * cam, because that is what most car footage is. Naming them lets them be
 * pushed into the negative prompt and asserted against in the benchmark.
 */
export const AERIAL_VIOLATIONS = [
  "rear-mounted vehicle camera",
  "camera attached to the car",
  "interior camera",
  "driver close-up",
  "ground-level tracking",
  "camera entering the vehicle",
] as const;

/**
 * Motion failures that ruin a shot regardless of what it is of.
 *
 * Applied to every video request rather than asked for, because no user thinks
 * to request "no flickering" and every one of them wants it.
 */
export const UNIVERSAL_NEGATIVE_MOTION = [
  "scene cuts",
  "sudden close-up",
  "camera shake",
  "speed warping",
  "flickering",
  "frame-to-frame color shifts",
  "morphing shapes",
] as const;

/** One phrase cue and what it means, in either language. */
interface CameraCue {
  /** Matched case-insensitively against the raw prompt. */
  patterns: RegExp;
  apply: (camera: CameraIntent) => CameraIntent;
  /** Constraints this cue implies, added to the temporal set. */
  constraints?: readonly string[];
  /** Behaviour this cue forbids. */
  forbids?: readonly string[];
}

/**
 * The cues, in priority order.
 *
 * ## Spanish first, deliberately
 *
 * Atheos ships a Spanish marketing site and the founder writes prompts in
 * Peruvian Spanish. A camera system that only understands "aerial drone shot"
 * silently downgrades every Spanish request to whatever the model felt like —
 * which is the failure this whole addendum is about.
 *
 * The patterns are written to match how people actually type: no accents
 * required, `carro` as well as `coche` and `auto`.
 */
const CAMERA_CUES: readonly CameraCue[] = [
  {
    // "desde el cielo", "vista aérea", "from the sky", "aerial", "drone"
    patterns:
      /\b(desde el cielo|vista a[eé]rea|a[eé]rea|a[eé]reo|dron|drone|aerial|from (the )?sky|bird'?s[- ]eye|top[- ]down)\b/i,
    apply: (camera) => ({
      ...camera,
      platform: "drone",
      height: "high aerial",
      // Oblique rather than straight down: a perfectly vertical view has no
      // horizon, and "que se vea el cielo" cannot be satisfied without one.
      angle: "oblique top-down",
      shotSize: camera.shotSize === "" ? "extreme wide shot" : camera.shotSize,
    }),
    constraints: ["camera remains aerial throughout"],
    forbids: AERIAL_VIOLATIONS,
  },
  {
    // "siguiendo el carro", "following the car", "tracking"
    patterns:
      /\b(siguiendo|persiguiendo|following|tracking|chase|sigue (al|el))\b/i,
    apply: (camera) => ({
      ...camera,
      motion: "smooth parallel tracking shot",
    }),
    constraints: ["camera tracks the subject continuously"],
    forbids: ["scene cuts", "camera losing the subject"],
  },
  {
    // "que se vea el cielo" — the sky must be visible, so not straight down.
    patterns:
      /\b(que se vea el cielo|con cielo|sky visible|showing the sky)\b/i,
    apply: (camera) => ({
      ...camera,
      angle: "oblique aerial angle with the horizon and sky in frame",
    }),
    constraints: ["horizon and sky visible in every frame"],
    forbids: ["perfectly vertical top-down view"],
  },
  {
    // "primer plano", "close up"
    patterns: /\b(primer plano|close[- ]?up|closeup)\b/i,
    apply: (camera) => ({ ...camera, shotSize: "close-up" }),
  },
  {
    patterns: /\b(plano general|wide shot|amplio|panor[aá]mic[ao])\b/i,
    apply: (camera) => ({ ...camera, shotSize: "extreme wide shot" }),
  },
  {
    patterns: /\b(c[aá]mara fija|static camera|fixed camera|sin movimiento)\b/i,
    apply: (camera) => ({ ...camera, motion: "static camera" }),
    constraints: ["camera does not move"],
  },
];

/** Subject-motion cues, which are about the thing rather than the lens. */
const MOTION_CUES: readonly {
  patterns: RegExp;
  direction: string;
  constraints?: readonly string[];
}[] = [
  {
    // "corriendo por la carretera", "driving along the road"
    patterns:
      /\b(corriendo|manejando|conduciendo|avanzando|driving|moving|racing|speeding)\b/i,
    direction: "forward along the road",
    constraints: ["subject moves forward continuously"],
  },
  {
    // "mar al costado" — the spatial relationship must survive the whole shot.
    patterns:
      /\b(mar al costado|al lado del mar|beside the (ocean|sea)|coastal)\b/i,
    direction: "forward along the coastal road",
    constraints: [
      "ocean remains on the same side of the road in every frame",
      "road and coastline keep their spatial relationship",
    ],
  },
];

const EMPTY_CAMERA: CameraIntent = {
  platform: "",
  height: "",
  angle: "",
  motion: "",
  shotSize: "",
};

export interface CameraReading {
  camera: CameraIntent;
  constraints: readonly string[];
  forbids: readonly string[];
  /** True when the text actually asked for a camera, rather than defaulting. */
  explicit: boolean;
}

/**
 * Read the camera the user asked for out of their own words.
 *
 * Returns what was *stated*, not a complete camera — an unstated field is left
 * empty so a caller can tell "they asked for eye level" from "they did not say".
 * Defaults are applied afterwards, and only to the gaps, because overwriting an
 * explicit instruction with a default is the exact failure this exists to stop.
 */
export function readCameraIntent(prompt: string): CameraReading {
  let camera = EMPTY_CAMERA;
  const constraints: string[] = [];
  const forbids: string[] = [];
  let explicit = false;

  for (const cue of CAMERA_CUES) {
    if (!cue.patterns.test(prompt)) continue;
    explicit = true;
    camera = cue.apply(camera);
    if (cue.constraints) constraints.push(...cue.constraints);
    if (cue.forbids) forbids.push(...cue.forbids);
  }

  return { camera, constraints, forbids, explicit };
}

/** Read what the subject is doing, and what must stay put while it does it. */
export function readMotionIntent(prompt: string): {
  direction: string;
  constraints: readonly string[];
} {
  const constraints: string[] = [];
  let direction = "";

  for (const cue of MOTION_CUES) {
    if (!cue.patterns.test(prompt)) continue;
    // Later cues are more specific — "coastal" beats "driving".
    direction = cue.direction;
    if (cue.constraints) constraints.push(...cue.constraints);
  }

  return { direction, constraints };
}

/**
 * Fill the gaps a reading left, without touching what it found.
 *
 * The precedence rule of the whole module: **explicit beats inferred, always.**
 * A user who said "desde el cielo" gets an aerial camera even if every default
 * and every model bias points at eye level.
 */
export function withCameraDefaults(
  read: CameraIntent,
  defaults: Partial<CameraIntent> = {},
): CameraIntent {
  const fallback: CameraIntent = {
    platform: "tripod",
    height: "eye level",
    angle: "straight on",
    motion: "static camera",
    shotSize: "medium shot",
    ...defaults,
  };

  return {
    platform: read.platform || fallback.platform,
    height: read.height || fallback.height,
    angle: read.angle || fallback.angle,
    motion: read.motion || fallback.motion,
    shotSize: read.shotSize || fallback.shotSize,
  };
}

/**
 * Render a structured prompt into the string a model actually receives.
 *
 * ## Camera first
 *
 * Order is not cosmetic. Diffusion models weight the front of a caption more
 * heavily, and a camera instruction buried after three clauses of scenery is a
 * camera instruction the model will trade away. The thing most likely to be
 * ignored goes first.
 *
 * Temporal constraints follow the scene, because they only make sense once the
 * scene exists. Negatives are returned separately: a model with a
 * `negative_prompt` input should receive them there, and only a model without
 * one gets them appended — see `services/ai/providers/replicate.ts`, where
 * wan-2.2 has no negative input at all.
 */
export function renderPrompt(prompt: StructuredPrompt): {
  text: string;
  negative: string;
} {
  const camera = [
    prompt.camera.shotSize,
    prompt.camera.angle,
    prompt.camera.platform ? `${prompt.camera.platform} shot` : "",
    prompt.camera.height,
    prompt.camera.motion,
  ].filter(Boolean);

  const scene = [
    prompt.subject,
    prompt.environment,
    prompt.lighting,
    prompt.colorPalette,
    prompt.composition,
    prompt.style,
  ].filter(Boolean);

  const parts = [camera.join(", "), scene.join(", ")];

  if (prompt.mediaType === "video") {
    const temporal = [
      prompt.temporal.subjectMotion,
      prompt.temporal.motionDirection,
      ...prompt.temporal.constraints,
    ].filter(Boolean);
    parts.push(temporal.join(", "));
  }

  const negatives =
    prompt.mediaType === "video"
      ? [...prompt.negative, ...prompt.temporal.negativeMotion]
      : [...prompt.negative];

  return {
    text: parts.filter(Boolean).join(". "),
    // De-duplicated: the same phrase arriving from a cue and from the universal
    // set would otherwise be weighted twice for no reason.
    negative: [...new Set(negatives)].join(", "),
  };
}

/**
 * Build a video prompt from raw user text plus explicit UI choices.
 *
 * UI choices win over parsed cues, and parsed cues win over defaults. A control
 * the user actually moved is the strongest signal available.
 */
export function buildVideoPrompt(input: {
  prompt: string;
  scene: Omit<SceneIntent, "negative"> & { negative?: readonly string[] };
  durationSeconds: number;
  frameRateTarget: number;
  motionStrength?: TemporalIntent["motionStrength"];
  /** From explicit studio controls, which outrank anything parsed. */
  cameraOverride?: Partial<CameraIntent>;
  extraConstraints?: readonly string[];
}): VideoPrompt {
  const cameraRead = readCameraIntent(input.prompt);
  const motionRead = readMotionIntent(input.prompt);

  const camera = withCameraDefaults({
    ...cameraRead.camera,
    ...stripEmpty(input.cameraOverride ?? {}),
  });

  return {
    mediaType: "video",
    subject: input.scene.subject,
    environment: input.scene.environment,
    lighting: input.scene.lighting,
    colorPalette: input.scene.colorPalette,
    composition: input.scene.composition,
    style: input.scene.style,
    negative: input.scene.negative ?? [],
    camera,
    temporal: {
      subjectMotion: input.scene.subject,
      motionDirection: motionRead.direction,
      motionStrength: input.motionStrength ?? "moderate",
      durationSeconds: input.durationSeconds,
      frameRateTarget: input.frameRateTarget,
      constraints: [
        ...cameraRead.constraints,
        ...motionRead.constraints,
        ...(input.extraConstraints ?? []),
      ],
      negativeMotion: [
        ...new Set([...UNIVERSAL_NEGATIVE_MOTION, ...cameraRead.forbids]),
      ],
    },
  };
}

/** Drop keys whose value is empty, so a blank control cannot erase a cue. */
function stripEmpty<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== "" && v !== undefined),
  ) as Partial<T>;
}
