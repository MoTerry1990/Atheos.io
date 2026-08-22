import {
  readCameraIntent,
  readMotionIntent,
  UNIVERSAL_NEGATIVE_MOTION,
} from "@/services/ai/prompt-intelligence";

/**
 * Directing a video instead of describing one.
 *
 * ## What the benchmark actually showed
 *
 * The reference clip was measured, not taken on trust: 1280×720, 24fps, 240
 * frames, 10.005s, H.264 with stereo AAC at 48kHz. Its four shots were
 * confirmed by reading frames at their midpoints — rear aerial tracking, side
 * tracking, near-vertical top-down, wide coastal pullback — with the ocean on
 * the same side throughout and the same two occupants in every shot.
 *
 * None of that came from resolution. It is 720p, the same as what Motion 1
 * already produces. What separates it is **direction**: a shot list, a
 * continuity contract and an audio bed, decided before any pixel was generated.
 *
 * That is the gap this module addresses, and it is worth being precise about
 * which part of the gap it can close. A plan makes the request unambiguous. It
 * cannot make a model obey an instruction it has no input for, and Atheos's two
 * video models accept no camera parameter and produce no audio at all. Planning
 * is necessary here and nowhere near sufficient — see `compileShots`.
 */

export type ShotStructure =
  /** One unbroken camera move. The default, and usually what people mean. */
  | "continuous"
  /** Several angles of one subject, cut together. */
  | "multi_angle"
  /** Let the director decide from the words. */
  | "auto";

export interface PlannedShot {
  /** Seconds from the start of the piece. */
  start: number;
  end: number;
  camera: string;
  angle: string;
  movement: string;
  framing: string;
}

/**
 * The facts that must hold across every shot.
 *
 * Written as a contract rather than prose because each entry is checked
 * individually by the validator. "Same red convertible in every shot" is a
 * testable claim; "keep it consistent" is not.
 */
export interface ContinuityContract {
  subject: string;
  subjectIdentity: string;
  location: string;
  timeOfDay: string;
  colorPalette: string;
  /** Spatial relationships that must not flip — the ocean's side, most often. */
  spatialAnchors: readonly string[];
  /** Everything that must never happen, across all shots. */
  prohibited: readonly string[];
}

/**
 * One grade for the whole piece.
 *
 * A per-shot palette is how a sequence ends up with a warm first shot and a
 * cool third, which reads as four clips rather than one film. The reference's
 * strength is partly that its blue is the same blue for ten seconds.
 */
export interface ColorPlan {
  palette: string;
  lighting: string;
  /** Where the sun is. Shadows disagreeing between shots is the tell. */
  sunDirection: string;
  contrast: string;
  /** Grades explicitly refused, because they are the common failure. */
  avoid: readonly string[];
}

export interface VideoDirectorPlan {
  durationSeconds: number;
  aspectRatio: string;
  visualStyle: string;
  structure: Exclude<ShotStructure, "auto">;
  continuity: ContinuityContract;
  color: ColorPlan;
  shots: readonly PlannedShot[];
}

/**
 * The continuity failures that ruin a vehicle sequence.
 *
 * Named individually so the validator can report which one happened rather than
 * "continuity failed". Every one of these was in the benchmark's failure list,
 * and several were observed in real output during Sprint 6C.
 */
export const VEHICLE_CONTINUITY_PROHIBITIONS = [
  "car changing design",
  "car changing colour",
  "convertible roof opening or closing",
  "driver disappearing",
  "driver changing identity",
  "extra occupants appearing",
  "steering wheel changing sides",
  "wheels deforming",
  "road bending unnaturally",
  "ocean changing sides",
  "sudden weather change",
  "interior camera appearing",
  "camera teleporting",
  "random scene replacement",
] as const;

/**
 * Phrases that mean "show me more than one angle".
 *
 * Spanish first for the same reason as the camera cues: the person writing
 * these prompts writes them in Spanish, and a director that only understands
 * "cinematic sequence" would give them a single locked shot every time.
 *
 * The bar is deliberately high. Adding cuts to a video nobody asked to be cut
 * is worse than leaving a continuous shot alone: a cut the user did not request
 * reads as the model losing track of the scene, which is exactly the artefact
 * they complain about.
 */
const MULTI_SHOT_CUES =
  /\b(de todos los [aá]ngulos|todos los [aá]ngulos|varios [aá]ngulos|diferentes [aá]ngulos|distintas tomas|comercial|publicidad|publicitari[oa]|anuncio|spot publicitario|cinematogr[aá]fic[oa]|secuencia|montaje|from all angles|multiple angles|different (drone )?views|commercial|advertisement|cinematic sequence|montage)\b/i;

/** Phrases that explicitly ask for one unbroken take. */
const CONTINUOUS_CUES =
  /\b(una sola toma|toma continua|sin cortes|plano secuencia|single shot|one continuous|continuous shot|no cuts|unbroken)\b/i;

/**
 * Decide whether the user asked for cuts.
 *
 * Explicit continuous wins over explicit multi-angle: somebody who wrote "sin
 * cortes" and also said "cinematográfico" wants a cinematic *continuous* shot,
 * and the specific instruction beats the stylistic one.
 */
export function readShotStructure(
  prompt: string,
  requested: ShotStructure = "auto",
): Exclude<ShotStructure, "auto"> {
  if (requested !== "auto") return requested;
  if (CONTINUOUS_CUES.test(prompt)) return "continuous";
  if (MULTI_SHOT_CUES.test(prompt)) return "multi_angle";
  return "continuous";
}

/**
 * The four-shot vehicle sequence, proportioned to the requested duration.
 *
 * The shape comes from the benchmark: establish from behind, come alongside,
 * go overhead, then pull back so the landscape closes the piece. It reads as
 * deliberate because the last shot answers the first — the same place, seen
 * whole.
 *
 * Proportions rather than fixed seconds, so a 6s piece is the same film at a
 * different length instead of the first two shots and an abrupt stop.
 */
const VEHICLE_SEQUENCE: readonly {
  share: number;
  camera: string;
  angle: string;
  movement: string;
  framing: string;
}[] = [
  {
    share: 0.3,
    camera: "high aerial drone",
    angle: "oblique rear three-quarter",
    movement: "smooth forward tracking behind the subject",
    framing: "wide shot, entire vehicle visible",
  },
  {
    share: 0.2,
    camera: "aerial side-tracking drone",
    angle: "elevated side three-quarter",
    movement: "smooth parallel tracking",
    framing: "medium-wide automotive shot",
  },
  {
    share: 0.2,
    camera: "drone",
    angle: "near-vertical top-down",
    movement: "stable overhead tracking",
    framing: "entire vehicle and road visible",
  },
  {
    share: 0.3,
    camera: "high aerial drone",
    angle: "wide oblique establishing view",
    movement: "gradual pullback while tracking",
    framing: "subject small within the landscape",
  },
];

function buildShots(
  structure: Exclude<ShotStructure, "auto">,
  durationSeconds: number,
  camera: {
    platform: string;
    height: string;
    angle: string;
    motion: string;
    shotSize: string;
  },
): PlannedShot[] {
  if (structure === "continuous") {
    // One shot spanning the whole piece, using the camera the user asked for.
    return [
      {
        start: 0,
        end: durationSeconds,
        camera: camera.platform || "drone",
        angle: camera.angle || "oblique",
        movement: camera.motion || "smooth tracking",
        framing: camera.shotSize || "wide shot",
      },
    ];
  }

  const shots: PlannedShot[] = [];
  let cursor = 0;
  VEHICLE_SEQUENCE.forEach((beat, index) => {
    const last = index === VEHICLE_SEQUENCE.length - 1;
    // The final shot absorbs the rounding, so the plan always ends exactly on
    // the requested duration rather than a frame short.
    const end = last
      ? durationSeconds
      : Number((cursor + durationSeconds * beat.share).toFixed(2));
    shots.push({
      start: Number(cursor.toFixed(2)),
      end,
      camera: beat.camera,
      angle: beat.angle,
      movement: beat.movement,
      framing: beat.framing,
    });
    cursor = end;
  });
  return shots;
}

export function buildDirectorPlan(input: {
  prompt: string;
  durationSeconds: number;
  aspectRatio?: string;
  structure?: ShotStructure;
  /**
   * The three continuity anchors, optional because the studio does not know
   * them.
   *
   * The UI has a prompt and a duration, not a parsed subject — and guessing one
   * badly is worse than not naming it, because the continuity contract would
   * then instruct the model to hold something that is not in the scene. The
   * defaults say "whatever is in this prompt, keep it the same", which is the
   * true requirement, and a caller that does know more can say so.
   */
  subject?: string;
  subjectIdentity?: string;
  location?: string;
  timeOfDay?: string;
  colorPalette?: string;
  visualStyle?: string;
}): VideoDirectorPlan {
  const cameraRead = readCameraIntent(input.prompt);
  const motionRead = readMotionIntent(input.prompt);
  const structure = readShotStructure(input.prompt, input.structure ?? "auto");

  const camera = {
    platform: cameraRead.camera.platform || "drone",
    height: cameraRead.camera.height || "elevated",
    angle: cameraRead.camera.angle || "oblique",
    motion: cameraRead.camera.motion || "smooth tracking",
    shotSize: cameraRead.camera.shotSize || "wide shot",
  };

  return {
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio ?? "16:9",
    visualStyle:
      input.visualStyle ?? "photorealistic cinematic, natural daylight",
    structure,
    continuity: {
      subject: input.subject ?? "the subject described in the prompt",
      subjectIdentity:
        input.subjectIdentity ??
        "the same subject, unchanged in every shot — no substitution",
      location: input.location ?? "the same location throughout",
      timeOfDay: input.timeOfDay ?? "bright sunny midday",
      colorPalette: input.colorPalette ?? "vivid natural colour",
      // Whatever the motion reader found about the world staying put — the
      // ocean's side, the road's relationship to it.
      spatialAnchors: motionRead.constraints,
      prohibited: [
        ...VEHICLE_CONTINUITY_PROHIBITIONS,
        ...UNIVERSAL_NEGATIVE_MOTION,
        ...cameraRead.forbids,
      ],
    },
    color: {
      palette: input.colorPalette ?? "vivid natural colour",
      lighting: "direct natural sunlight with defined shadows",
      sunDirection: "consistent across every shot",
      contrast: "high perceived dynamic range without blown highlights",
      avoid: [
        "grey or muddy atmosphere",
        "heavy teal and orange grading",
        "neon saturation",
        "blown sky highlights",
        "crushed shadows",
        "colour changes between shots",
        "flickering exposure",
        "plastic surfaces",
        "waxy skin",
        "artificial oversharpening",
      ],
    },
    shots: buildShots(structure, input.durationSeconds, camera),
  };
}

/** The one-line summary shown before generating. */
export function describePlan(plan: VideoDirectorPlan, audio: string): string {
  const beats = plan.shots
    .map((shot) => shot.angle.replace(/\s+view$/, ""))
    .join(" → ");
  return `${plan.durationSeconds} seconds · ${plan.shots.length} shot${
    plan.shots.length === 1 ? "" : "s"
  }\n${beats}\n${audio}`;
}

export interface ShotCompilation {
  /** Clips the provider would actually be asked for. */
  clips: { shot: PlannedShot; prompt: string }[];
  /** Plan requirements this provider cannot honour. */
  unsupported: string[];
  /** True when the plan had to be collapsed to fit the provider. */
  collapsed: boolean;
}

/**
 * Turn a plan into what a given provider can actually be asked for.
 *
 * ## The honest part
 *
 * Neither model Atheos ships can produce a multi-shot sequence in one request.
 * They take a prompt and return one continuous clip; there is no shot list, no
 * cut, no camera track. A four-shot plan can therefore be delivered only by
 * generating four clips and assembling them — which multiplies the cost and is
 * a decision with a price attached, not something to do silently.
 *
 * So a multi-shot plan against a single-clip provider is **collapsed**, and the
 * collapse is reported rather than hidden. The caller decides whether to spend
 * four times as much or accept one shot.
 */
/**
 * What a provider can actually accept.
 *
 * Named rather than inlined because the UI needs to hold one of these too — the
 * shot-plan preview has to know the same limits the compiler does, or it will
 * promise a sequence the generation cannot produce.
 */
export interface ProviderShotSupport {
  supportsMultiShot: boolean;
  supportsNegativePrompt: boolean;
  supportsNativeAudio: boolean;
  maxDurationSeconds: number;
}

export function compileShots(
  plan: VideoDirectorPlan,
  provider: ProviderShotSupport,
  renderShot: (shot: PlannedShot, plan: VideoDirectorPlan) => string,
): ShotCompilation {
  const unsupported: string[] = [];

  if (!provider.supportsNegativePrompt) {
    unsupported.push(
      "no negative-prompt input: the continuity prohibitions are not sent to the provider",
    );
  }
  if (!provider.supportsNativeAudio) {
    unsupported.push(
      "no native audio: the audio plan must be produced separately and mixed",
    );
  }

  const wantsMultiShot = plan.shots.length > 1;

  if (wantsMultiShot && !provider.supportsMultiShot) {
    unsupported.push(
      `this provider returns one continuous clip, so the ${plan.shots.length}-shot plan cannot be generated in a single request`,
    );
    // Collapse to the establishing shot over the full duration. It is the shot
    // that carries the location, and it is the one a viewer forgives least when
    // it is missing.
    const [first] = plan.shots;
    const collapsed: PlannedShot = {
      ...first,
      start: 0,
      end: Math.min(plan.durationSeconds, provider.maxDurationSeconds),
    };
    return {
      clips: [{ shot: collapsed, prompt: renderShot(collapsed, plan) }],
      unsupported,
      collapsed: true,
    };
  }

  return {
    clips: plan.shots.map((shot) => ({ shot, prompt: renderShot(shot, plan) })),
    unsupported,
    collapsed: false,
  };
}
