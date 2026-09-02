import {
  CREATIVE_BRIEF_VERSION,
  explicit,
  fallback,
  inferred,
  type CreativeBrief,
  type CutStyle,
  type Objective,
  type ReferenceUse,
} from "@/services/ai/creative-brief";
import { inferSceneMotion } from "@/services/ai/motion-inference";

/**
 * Turn a short prompt into a brief — deterministically first.
 *
 * ## Why deterministic extraction comes before any model
 *
 * "10-second", "16:9", "no music" are facts, not interpretations. Sending them
 * to a language model to be re-read is slower, costs money, and introduces a
 * chance of getting them wrong — a planner that turns "10 seconds" into 8 has
 * failed at the one part of the job that had a right answer.
 *
 * So the regexes run first and their results are `explicit`. A structured
 * planner call is only worth making for the parts that genuinely need reading:
 * objective, style, what the subject is. That call is designed here and left
 * unwired — see `PLANNER_MODEL`.
 *
 * ## Nothing here calls a provider
 *
 * Every function in this file is pure. Planning that costs money is a separate,
 * budgeted, cached path; deterministic planning is free and always runs.
 */

/**
 * Explicit duration: "10 second", "10 seconds", "10s", "10-second", "7 sec".
 *
 * The plural matters more than the singular. `(?:second|sec|s)\b` looks like it
 * covers "seconds" and does not: after matching "second" the `\b` fails against
 * the trailing "s", and "sec" and "s" fail the same way — so "10 seconds", the
 * commonest phrasing there is, fell through to the default length in silence.
 */
const DURATION = /\b(\d{1,2})\s*[-–]?\s*(?:seconds?|secs?|s)\b/i;
const ASPECT = /\b(16:9|9:16|1:1)\b/;
const RESOLUTION = /\b(1080p?|720p?|full\s*hd|hd)\b/i;
const SHOT_COUNT =
  /\b(?:(\d)|(one|two|three|four|five|six))\s*(?:separate\s+|distinct\s+|different\s+)?shots?\b/i;
const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

const WANTS_SILENT = /\b(no (audio|sound)|silent|muted|sin (audio|sonido))\b/i;
const WANTS_SOUND = /\b(with (audio|sound)|con (audio|sonido)|audio|sound)\b/i;
const NO_MUSIC = /\b(no music|without music|sin m[uú]sica)\b/i;
const WANTS_MUSIC = /\b(with music|music|soundtrack|con m[uú]sica)\b/i;
const NO_DIALOGUE = /\b(no (dialogue|speech|voice|narration))\b/i;

const CONTINUOUS =
  /\b(one continuous|single (take|shot)|no cuts|sin cortes|unbroken)\b/i;
const COMMERCIAL = /\b(commercial|advert|ad\b|comercial|publicitario|spot)\b/i;
const SOCIAL = /\b(social|reel|tiktok|short)\b/i;
const PRODUCT = /\b(product|producto)\b/i;

/**
 * The structured planner, designed and deliberately unwired.
 *
 * A small instruct model with forced JSON output is the right tool for reading
 * objective and style out of a sentence — but it costs money per call and this
 * sprint is not permitted to spend any. The constant records the intended
 * choice so a later sprint wires a decision that was already made, rather than
 * picking one under deadline.
 */
export const PLANNER_MODEL = {
  candidate: "meta/meta-llama-3-8b-instruct",
  reason:
    "Already in the Replicate catalogue, already used by the prompt enhancer, cheap enough to be free at the point of use.",
  estimatedCostPerPlanUsd: 0.0002,
  outputMode: "forced JSON matching the CreativeBrief schema",
  wired: false,
  note: "Deterministic extraction runs today. This call is not made anywhere.",
} as const;

export interface PlannerInput {
  prompt: string;
  referenceImageCount?: number;
  /** From the composer's controls, which are explicit by definition. */
  controls?: {
    durationSeconds?: number;
    aspectRatio?: "16:9" | "9:16" | "1:1";
  };
}

/**
 * Build a brief from the prompt alone. Pure, free, always safe to run.
 *
 * Everything it cannot read from the text becomes `inferred` or `default` with
 * a reason attached, so the confirmation panel can show the user what Atheos
 * assumed rather than presenting assumptions as their instructions.
 */
export function planFromPrompt(input: PlannerInput): CreativeBrief {
  const text = input.prompt;
  const refCount = input.referenceImageCount ?? 0;

  // --- Duration ------------------------------------------------------------
  const durationMatch = text.match(DURATION);
  const duration = input.controls?.durationSeconds
    ? explicit(input.controls.durationSeconds, "set in the composer")
    : durationMatch
      ? explicit(Number(durationMatch[1]), `you wrote "${durationMatch[0]}"`)
      : fallback(8, "no length was given, so this is the common short length");

  // --- Aspect and resolution ----------------------------------------------
  const aspectMatch = text.match(ASPECT);
  const aspect = input.controls?.aspectRatio
    ? explicit(input.controls.aspectRatio, "set in the composer")
    : aspectMatch
      ? explicit(aspectMatch[1] as "16:9", `you wrote "${aspectMatch[1]}"`)
      : fallback(
          "16:9" as const,
          "landscape is the usual shape for this kind of film",
        );

  const resMatch = text.match(RESOLUTION);
  const resolution = resMatch
    ? explicit(
        /720/.test(resMatch[1]) ? ("720p" as const) : ("1080p" as const),
        `you wrote "${resMatch[1]}"`,
      )
    : fallback("1080p" as const, "the highest most models render");

  // --- Objective -----------------------------------------------------------
  const objective: Objective = COMMERCIAL.test(text)
    ? "commercial"
    : SOCIAL.test(text)
      ? "social"
      : PRODUCT.test(text)
        ? "product"
        : "unspecified";
  const objectiveSourced =
    objective === "unspecified"
      ? fallback("unspecified" as Objective, "no purpose was stated")
      : explicit(objective, `you wrote about a ${objective}`);

  // --- Shot structure ------------------------------------------------------
  const shotMatch = text.match(SHOT_COUNT);
  const explicitShots = shotMatch
    ? Number(shotMatch[1]) || WORD_NUMBERS[shotMatch[2]?.toLowerCase() ?? ""]
    : undefined;

  const wantsContinuous = CONTINUOUS.test(text);

  /**
   * Four shots is inferred for a commercial, never assumed silently.
   *
   * A commercial is an edited form; a ten-second one is conventionally three or
   * four shots. But the user did not say it, so it is `inferred` with a reason
   * and appears in the confirmation panel as something to change.
   */
  const shotCount = explicitShots
    ? explicit(explicitShots, `you asked for ${explicitShots} shots`)
    : wantsContinuous
      ? explicit(1, "you asked for one continuous shot")
      : objective === "commercial"
        ? inferred(
            4,
            0.7,
            "commercials are usually edited; four shots suits this length",
          )
        : fallback(1, "one continuous shot unless an edit was asked for");

  const cutStyle: CutStyle = shotCount.value > 1 ? "hard_cut" : "continuous";

  const span = duration.value / Math.max(1, shotCount.value);
  const shots = Array.from({ length: shotCount.value }, (_, i) => ({
    index: i + 1,
    start: Number((i * span).toFixed(2)),
    end:
      i === shotCount.value - 1
        ? duration.value
        : Number(((i + 1) * span).toFixed(2)),
    cameraAngle: "",
    cameraMovement: "",
    subjectAction: "",
  }));

  // --- Audio ---------------------------------------------------------------
  const silent = WANTS_SILENT.test(text);
  const soundAsked = !silent && WANTS_SOUND.test(text);
  const audioStrategy = silent
    ? explicit("SILENT" as const, "you asked for no sound")
    : soundAsked
      ? explicit("NATIVE" as const, "you asked for sound")
      : inferred(
          "NATIVE" as const,
          0.6,
          "video of this kind usually has sound",
        );

  const music = NO_MUSIC.test(text)
    ? explicit(false, "you asked for no music")
    : WANTS_MUSIC.test(text)
      ? explicit(true, "you asked for music")
      : // Never added silently. Stock music under a clip is the fastest way for
        // generated video to announce itself.
        fallback(false, "music is not added unless asked for");

  const dialogue = NO_DIALOGUE.test(text)
    ? explicit(false, "you asked for no dialogue")
    : fallback(false, "speech is not added unless asked for");

  /**
   * What moves. Derived from the same text as everything else, before the
   * brief is assembled, so both fields are present from the first version.
   */
  const motion = inferSceneMotion(text);

  // --- References ----------------------------------------------------------
  const references =
    refCount > 0
      ? inferred(
          { count: refCount, use: "preserve_exactly" as ReferenceUse },
          0.6,
          "you supplied a reference, so the subject is probably meant to match it",
        )
      : fallback(
          { count: 0, use: "style_only" as ReferenceUse },
          "no reference was supplied",
        );

  const brief: CreativeBrief = {
    version: CREATIVE_BRIEF_VERSION,
    // Preserved exactly. Not trimmed, not normalised.
    originalPrompt: input.prompt,
    objective: objectiveSourced,
    primarySubject: fallback("", "not identified without a planner call"),
    subjectIdentity:
      refCount > 0
        ? inferred(
            ["the subject in the supplied reference"],
            0.6,
            "a reference usually means the subject should match",
          )
        : fallback([], "no reference to match"),
    environment: fallback("", "taken from the prompt as written"),
    action: fallback("", "taken from the prompt as written"),
    /**
     * Motion, inferred rather than left blank.
     *
     * `action` is a noun phrase and a noun phrase is satisfied by a still.
     * These two say what actually happens over the take, so the compiler has
     * something to turn into beats. Marked `inferred`, never `explicit` — the
     * user did not ask for spray, and the plan panel shows them what was added
     * and lets them edit it.
     */
    motionIntent: motion.intent,
    /**
     * `explicit` when the user asked for movement themselves, `inferred` when
     * we added it, and **absent entirely** when they asked for a held frame.
     *
     * The third case is the one that matters: an empty string marked
     * `inferred` would still read as "we decided there is no motion", and the
     * compiler would have something to render. Omitting the fields, with
     * `motionIntent: "explicit_static"` alongside, says the user decided.
     */
    ...(motion.intent === "explicit_static"
      ? {}
      : {
          subjectMotion:
            motion.intent === "explicit_dynamic"
              ? explicit(motion.subject, "you asked for movement")
              : inferred(
                  motion.subject,
                  0.6,
                  `added so the clip moves rather than reading as a still (${motion.archetype})`,
                ),
          environmentMotion:
            motion.intent === "explicit_dynamic"
              ? explicit(motion.environment, "you asked for movement")
              : inferred(
                  motion.environment,
                  0.6,
                  "added so the surroundings are not a frozen backdrop",
                ),
        }),
    visualStyle:
      objective === "commercial"
        ? inferred(
            "photorealistic, cinematic",
            0.7,
            "commercials are usually photoreal",
          )
        : fallback("", "no style was stated"),
    realism: fallback("photorealistic", "the usual default"),
    colorAndLighting: fallback(
      "natural daylight",
      "nothing else was described",
    ),
    durationSeconds: duration,
    aspectRatio: aspect,
    resolution,
    shotCount,
    shots:
      shotCount.from === "explicit"
        ? explicit(shots)
        : inferred(shots, 0.7, "timed evenly across the length"),
    cutStyle:
      shotCount.value > 1
        ? inferred(cutStyle, 0.7, "separate shots need cuts between them")
        : fallback(cutStyle, "a single shot has nothing to cut"),
    continuityRules: fallback([], "filled in from the subject once confirmed"),
    audioStrategy,
    environmentalSound: fallback("", "derived from the scene"),
    subjectSound: fallback("", "derived from the subject"),
    music,
    dialogue,
    commercialCopy: fallback([], "no copy was supplied"),
    logoOverlay: fallback(false, "no logo was supplied"),
    negativeConstraints: fallback([], "added per model at compile time"),
    references,
    // The fields a user must have agreed to before money moves.
    required: ["durationSeconds", "shotCount", "audioStrategy", "references"],
    overallConfidence: 0,
  };

  brief.overallConfidence = confidenceOf(brief);
  return brief;
}

/** Mean confidence across the fields that decide price and structure. */
function confidenceOf(brief: CreativeBrief): number {
  const weighted = brief.required.map((field) => {
    const entry = brief[field] as unknown as {
      from: string;
      confidence?: number;
    };
    if (
      entry.from === "explicit" ||
      entry.from === "confirmed" ||
      entry.from === "edited"
    )
      return 1;
    return entry.confidence ?? 0.4;
  });
  return Number(
    (weighted.reduce((a, b) => a + b, 0) / weighted.length).toFixed(2),
  );
}

// ---------------------------------------------------------------------------
// Phase 4 — clarification policy
// ---------------------------------------------------------------------------

export interface Clarification {
  /** Which brief field the answer sets. */
  field: keyof CreativeBrief;
  question: string;
  options: { label: string; value: unknown; recommended?: boolean }[];
}

/**
 * Ask only what changes the outcome, and never more than three at once.
 *
 * The test of a question is whether a different answer produces a different
 * film, a different model or a different price. "What mood?" fails that test
 * and is not asked; "four shots or one continuous take?" changes the structure,
 * the model and the cost, so it is.
 */
export function clarificationsFor(brief: CreativeBrief): Clarification[] {
  const questions: Clarification[] = [];

  if (
    brief.shotCount.from === "inferred" ||
    brief.shotCount.from === "default"
  ) {
    questions.push({
      field: "shotCount",
      question: "How should the camera sequence work?",
      options: [
        {
          label: `${brief.shotCount.value} edited shots`,
          value: brief.shotCount.value,
          recommended: true,
        },
        { label: "One continuous shot", value: 1 },
      ],
    });
  }

  if (
    brief.audioStrategy.from === "inferred" ||
    brief.audioStrategy.from === "default"
  ) {
    questions.push({
      field: "audioStrategy",
      question: "What sound do you want?",
      options: [
        {
          label: "Natural sound from the scene",
          value: "NATIVE",
          recommended: true,
        },
        { label: "Silent", value: "SILENT" },
      ],
    });
  }

  if (
    brief.references.value.count > 0 &&
    (brief.references.from === "inferred" ||
      brief.references.from === "default")
  ) {
    questions.push({
      field: "references",
      question: "Should the subject match your reference exactly?",
      options: [
        {
          label: "Yes, preserve it",
          value: {
            count: brief.references.value.count,
            use: "preserve_exactly",
          },
          recommended: true,
        },
        {
          label: "Use it as inspiration only",
          value: {
            count: brief.references.value.count,
            use: "visual_guidance",
          },
        },
      ],
    });
  }

  // Three is the ceiling. A fourth question is a form, and people abandon forms.
  return questions.slice(0, 3);
}
