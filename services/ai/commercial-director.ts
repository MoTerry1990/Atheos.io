import {
  DIRECTED_NEGATIVES,
  MULTI_SHOT_EXCLUSIONS,
} from "@/services/ai/directed-prompt";

/**
 * Commercial Director — a brief in, a shot list and a compiled prompt out.
 *
 * ## Measured against the Gemini reference, not against a description of it
 *
 * Both files were probed with ffprobe and cut-detected with ffmpeg's `scdet`
 * on 2026-08-23:
 *
 * | | Atheos baseline | Gemini reference |
 * |---|---|---|
 * | container | 1920x1088, 24fps, 241 frames, 10.0417s | 1280x720, 24fps, 240 frames, 10.000s |
 * | audio | **none — no stream at all** | AAC stereo 48kHz, 10.005s |
 * | cuts | **0** (peak scene score 2.28) | **3** at 2.167s, 4.917s, 7.417s (scores 13.2 / 23.3 / 20.0) |
 * | typography | none | four timed titles in the safe area |
 * | subject | a *different* car — a 1960s roadster | the reference Porsche 911 Cabriolet |
 *
 * The reference is a quarter of the pixels and two per cent of the bitrate, and
 * it is the better commercial by every measure that matters. Resolution was
 * never the gap.
 *
 * ## Why a separate module from `directed-prompt.ts`
 *
 * That one compiles a *cinematic sequence*. A commercial has three things a
 * sequence does not: a product that must survive every cut unchanged, copy that
 * has to be legible and exact, and a closing brand frame. Those belong to the
 * brief, and mixing them into the general compiler would push advertising
 * vocabulary into every ordinary video prompt.
 */

export interface CommercialBrief {
  /** What the user typed. */
  prompt: string;
  /** The thing being sold. Repeated at every cut as the continuity anchor. */
  subject: string;
  /** Why the film exists — informs pacing and the closing frame. */
  objective?: string;
  /** Exact copy. Never paraphrased, never re-cased. */
  slogan?: string;
  /** Where a supplied logo sits. Rendered by Atheos, never by the model. */
  logo?: { url: string; corner: "top-left" | "top-right" | "bottom-right" };
  audio: "native" | "atheos_sound_design" | "silent";
  aspectRatio: "16:9" | "9:16";
  durationSeconds: number;
  /** Reference images, best first. See `referenceStrategy`. */
  referenceImageUrls?: readonly string[];
}

export interface CommercialShot {
  index: number;
  start: number;
  end: number;
  /** Where the camera is. */
  camera: string;
  /** How it moves inside the shot. Never how it gets to the next one. */
  movement: string;
  /** What the subject does. */
  action: string;
}

export interface TypographyCue {
  /** Exact text. Copied through, never regenerated. */
  text: string;
  start: number;
  end: number;
  emphasis: "headline" | "subhead";
  /**
   * Fraction of the frame kept clear of the edge.
   *
   * 5% is the broadcast title-safe convention, and it is the reason a caption
   * does not get cropped off the side of a phone in a 9:16 re-frame.
   */
  safeAreaInset: number;
}

export interface CommercialPlan {
  brief: CommercialBrief;
  shots: CommercialShot[];
  /** N-1 for N shots. Stated so the count cannot drift from the shot list. */
  hardCuts: number;
  typography: TypographyCue[];
  /** Rendered by Atheos after generation, never asked of the model. */
  closingFrame: { headline?: string; subhead?: string; logo: boolean };
  continuity: string[];
}

/**
 * The continuity contract, itemised.
 *
 * Every line is a substitution the baseline actually made. The Atheos output
 * replaced a modern Porsche 911 Cabriolet with a 1960s roadster — different
 * body, different lights, different wheels, different everything — while the
 * prompt said only "the same red convertible". A category noun is not an
 * identity, and this is what it takes to say so.
 */
export const COMMERCIAL_CONTINUITY = [
  "the same vehicle make and model in every shot",
  "the same body proportions and silhouette",
  "the same headlights and taillights",
  "the same wheel design",
  "the same mirrors",
  "the same windshield shape",
  "the same paint colour and finish",
  "the same driver, with the same face and hair",
  "the same clothing",
  "the same road and coastline",
  "the same direction of travel",
  "the same weather and daylight",
] as const;

/** The benchmark structure: four even shots across the piece. */
export const BENCHMARK_SHOTS: readonly Omit<CommercialShot, "start" | "end">[] =
  [
    {
      index: 1,
      camera: "wide rear aerial establishing view, high above and behind",
      movement: "holding steady as the car travels away along the coast road",
      action: "the car drives forward along the cliff road",
    },
    {
      index: 2,
      camera: "close elevated side view, level with the car and near to it",
      movement: "tracking alongside at the car's own speed, in profile",
      action: "the car passes the camera, driver and passenger visible",
    },
    {
      index: 3,
      camera:
        "directly overhead, the lens pointing straight down at the roof, optical axis perpendicular to the road",
      movement: "holding the overhead position as the road slides beneath",
      action: "the car moves through frame seen from above",
    },
    {
      index: 4,
      camera: "wide aerial, high and far back",
      movement: "pulling back and rising so the car becomes small",
      action: "the car continues along the coastline into the distance",
    },
  ];

/** Evaluation copy for the red-car benchmark. Not a brand partnership. */
export const BENCHMARK_COPY = [
  "ESCAPE THE ORDINARY",
  "EXPERIENCE PURE FREEDOM",
  "THE ALL-NEW CABRIOLET",
  "START YOUR JOURNEY",
] as const;

/** Build the plan. Pure: no provider, no cost, no side effects. */
export function planCommercial(
  brief: CommercialBrief,
  shots: readonly Omit<CommercialShot, "start" | "end">[] = BENCHMARK_SHOTS,
): CommercialPlan {
  const span = brief.durationSeconds / shots.length;

  const timed: CommercialShot[] = shots.map((shot, index) => ({
    ...shot,
    index: index + 1,
    start: Number((index * span).toFixed(2)),
    // The last shot absorbs rounding so the plan ends exactly on the duration.
    end:
      index === shots.length - 1
        ? brief.durationSeconds
        : Number(((index + 1) * span).toFixed(2)),
  }));

  /**
   * Copy is placed on shots, not sprinkled across the timeline.
   *
   * A title that begins mid-cut reads as a mistake. Each cue is inset half a
   * second from its shot's boundaries so it lands and clears inside one shot.
   */
  const typography: TypographyCue[] = brief.slogan
    ? [
        {
          text: brief.slogan,
          start: timed[0].start + 0.5,
          end: Math.min(timed[0].end - 0.2, timed[0].start + 2.5),
          emphasis: "headline",
          safeAreaInset: 0.05,
        },
      ]
    : [];

  return {
    brief,
    shots: timed,
    hardCuts: Math.max(0, timed.length - 1),
    typography,
    closingFrame: {
      headline: brief.slogan,
      subhead: brief.objective,
      logo: Boolean(brief.logo),
    },
    continuity: [...COMMERCIAL_CONTINUITY],
  };
}

/**
 * Compile the plan into the provider prompt.
 *
 * The opening sentence is fixed and comes first. The baseline's prompt opened
 * "A single continuous 10-second piece with four camera positions" and the model
 * delivered precisely that — one orbit, zero cuts. The word "continuous" was the
 * only structural commitment in it. This opens with the edit instead.
 */
export function compileCommercialPrompt(plan: CommercialPlan): {
  prompt: string;
  negativePrompt: string;
} {
  const sections: string[] = [];

  sections.push(
    `Create an edited commercial containing exactly ${plan.shots.length} separate ` +
      `shots and exactly ${plan.hardCuts} unmistakable hard cuts. Do not make one ` +
      `continuous orbit or uninterrupted drone movement.`,
  );

  sections.push(`Subject: ${plan.brief.subject}. ${plan.brief.prompt}`);

  const blocks: string[] = [];
  plan.shots.forEach((shot, index) => {
    blocks.push(
      `SHOT ${shot.index} — ${shot.start.toFixed(1)}–${shot.end.toFixed(1)}s\n` +
        `${shot.camera}. ${shot.movement}. ${shot.action}.`,
    );
    if (index < plan.shots.length - 1) blocks.push("HARD CUT.");
  });
  sections.push(blocks.join("\n\n"));

  sections.push(`Identical across every shot: ${plan.continuity.join("; ")}.`);

  sections.push(MULTI_SHOT_EXCLUSIONS.map((rule) => `- ${rule}`).join("\n"));

  /**
   * The model is told to render no text at all.
   *
   * Generated lettering is unreliable at exactly the moment it matters — a
   * misspelt slogan is worse than no slogan, and it cannot be corrected without
   * paying for another generation. Atheos draws the copy afterwards, in a font
   * it controls, at a position it chose. See `services/video/post-production`.
   */
  sections.push(
    "Render no text, no captions, no titles, no logos and no watermarks anywhere in the frame.",
  );

  if (plan.brief.audio === "native") {
    sections.push(
      "Audio: the sound of the scene itself — engine, tyres on the road surface, " +
        "wind and distant surf, following the camera. No speech, no dialogue, " +
        "no narration, no music.",
    );
  }

  return {
    prompt: sections.join("\n\n"),
    negativePrompt: [
      ...DIRECTED_NEGATIVES,
      "on-screen text",
      "captions",
      "lettering",
      "a different car model",
    ].join(", "),
  };
}

// ---------------------------------------------------------------------------
// Phase 4 — reference capability hierarchy
// ---------------------------------------------------------------------------

export type ReferenceStrategy =
  | "multi_reference"
  | "single_reference"
  | "first_frame"
  | "last_frame"
  | "text_only";

export interface ReferenceCapableModel {
  supportsReferenceImages: boolean;
  maxReferenceImages?: number;
  acceptsImageInput: boolean;
  acceptsEndFrame: boolean;
}

/**
 * The strongest identity mechanism a model actually offers.
 *
 * Ordered because they are not equivalent. Multiple references let a model see
 * the subject from several angles and hold it through a cut; a first frame only
 * fixes the opening and lets identity drift after it — which is exactly what the
 * last Veo run did, holding the Porsche for about three seconds before becoming
 * a different car.
 *
 * `text_only` is last and is a warning, not a tier: the baseline used it, and
 * the car changed completely.
 */
export function referenceStrategy(
  model: ReferenceCapableModel,
  referenceCount: number,
): { strategy: ReferenceStrategy; note: string } {
  if (referenceCount === 0) {
    return {
      strategy: "text_only",
      note: "No reference supplied. Subject identity rests on wording alone, which is the weakest option available and the one the baseline used.",
    };
  }

  if (model.supportsReferenceImages && referenceCount > 1) {
    return {
      strategy: "multi_reference",
      note: `Up to ${model.maxReferenceImages ?? 3} reference images guide the subject through every shot.`,
    };
  }

  if (model.supportsReferenceImages) {
    return {
      strategy: "single_reference",
      note: "One reference image guides the subject through every shot.",
    };
  }

  if (model.acceptsImageInput) {
    return {
      strategy: "first_frame",
      note: "This model has no reference input, only a first frame. It fixes the opening; identity can drift after it.",
    };
  }

  if (model.acceptsEndFrame) {
    return {
      strategy: "last_frame",
      note: "Only an end frame is available, which constrains where the shot arrives but not what happens in between.",
    };
  }

  return {
    strategy: "text_only",
    note: "This model accepts no image of any kind. Subject identity cannot be anchored.",
  };
}

/** What the model card may claim about identity, given the strategy. */
export function describeIdentityStrength(strategy: ReferenceStrategy): string {
  switch (strategy) {
    case "multi_reference":
      return "Strong — the subject is shown to the model from several angles";
    case "single_reference":
      return "Good — one reference guides every shot";
    case "first_frame":
      return "Partial — the first frame is fixed, later shots may drift";
    case "last_frame":
      return "Weak — only the final frame is constrained";
    case "text_only":
      // Never "strong". The baseline proved what text-only continuity is worth.
      return "None — described in words only; expect a different subject";
  }
}
