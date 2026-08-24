import { AUDIO_CAPABILITIES } from "@/services/ai/audio-strategy";
import type { CreativeBrief } from "@/services/ai/creative-brief";

/**
 * Which models can actually make this brief, and which merely accept it.
 *
 * ## The behaviour this replaces
 *
 * Motion 1 has taken a four-shot commercial request, shown a warning, and
 * generated a 7.57-second silent single take at 720p. Every one of those
 * mismatches was known before submission: its schema has no audio, no image
 * input, a 121-frame ceiling and a 720p cap. A warning next to a Generate
 * button that still works is not a refusal.
 *
 * So incompatibility is a **verdict**, not a note. `incompatible` briefs are
 * rejected on the server, not merely discouraged in the client — a forged
 * request arrives at the same check.
 */

export type Compatibility = "compatible" | "partial" | "incompatible";

export interface ModelCapability {
  id: string;
  label: string;
  maxDurationSeconds: number;
  /** Lengths the model will actually render. */
  allowedDurations?: readonly number[];
  maxResolution: "720p" | "1080p";
  acceptsReferenceImages: boolean;
  acceptsImageInput: boolean;
  /** Whether the model can hold several deliberate shots in one generation. */
  canDirectMultipleShots: boolean;
  /** Whether it can produce *hard cuts*, which is not the same thing. */
  canProduceHardCuts: boolean;
  creditsPerGeneration: number;
  estimatedSeconds: number;
}

/**
 * The catalogue, from verified schemas.
 *
 * `canProduceHardCuts` is false everywhere, and that is a measurement rather
 * than a caution: three separate runs on two models, given increasingly
 * explicit cut instructions, returned zero detected cuts. Until a model is
 * observed cutting, no tier may claim it.
 */
export const MODEL_CAPABILITIES: ModelCapability[] = [
  {
    id: "replicate/video-gen",
    label: "Motion 1",
    maxDurationSeconds: 7.5,
    allowedDurations: [5, 7.5],
    maxResolution: "720p",
    acceptsReferenceImages: false,
    acceptsImageInput: false,
    canDirectMultipleShots: false,
    canProduceHardCuts: false,
    creditsPerGeneration: 90,
    estimatedSeconds: 300,
  },
  {
    id: "replicate/video-pro",
    label: "Motion Pro",
    maxDurationSeconds: 12,
    allowedDurations: [5, 10, 12],
    maxResolution: "1080p",
    acceptsReferenceImages: true,
    acceptsImageInput: true,
    canDirectMultipleShots: false,
    canProduceHardCuts: false,
    creditsPerGeneration: 180,
    estimatedSeconds: 700,
  },
  {
    id: "replicate/veo-3.1-fast",
    label: "Cinematic Fast",
    maxDurationSeconds: 8,
    allowedDurations: [4, 6, 8],
    maxResolution: "1080p",
    acceptsReferenceImages: false,
    acceptsImageInput: true,
    canDirectMultipleShots: true,
    canProduceHardCuts: false,
    creditsPerGeneration: 576,
    estimatedSeconds: 130,
  },
  {
    id: "replicate/veo-3.1",
    label: "Cinematic",
    maxDurationSeconds: 8,
    allowedDurations: [4, 6, 8],
    maxResolution: "1080p",
    acceptsReferenceImages: true,
    acceptsImageInput: true,
    canDirectMultipleShots: true,
    canProduceHardCuts: false,
    creditsPerGeneration: 1920,
    estimatedSeconds: 110,
  },
  {
    id: "replicate/seedance-2.5",
    label: "Cinematic Long",
    maxDurationSeconds: 30,
    maxResolution: "720p",
    acceptsReferenceImages: true,
    acceptsImageInput: true,
    canDirectMultipleShots: true,
    canProduceHardCuts: false,
    // $0.2312/s at 720p; 10s is $2.31, and 3x margin at $0.005/credit.
    creditsPerGeneration: 1_387,
    estimatedSeconds: 200,
  },
];

export interface RoutingVerdict {
  model: ModelCapability;
  compatibility: Compatibility;
  /** Every requirement this model cannot meet. Plain sentences. */
  conflicts: string[];
  /** Requirements it meets only approximately. */
  caveats: string[];
  credits: number;
  estimatedSeconds: number;
}

/** Judge one model against one brief. */
export function assessModel(
  brief: CreativeBrief,
  model: ModelCapability,
): RoutingVerdict {
  const conflicts: string[] = [];
  const caveats: string[] = [];

  const wanted = brief.durationSeconds.value;
  if (wanted > model.maxDurationSeconds) {
    conflicts.push(
      `${model.label} renders at most ${model.maxDurationSeconds} seconds; you asked for ${wanted}`,
    );
  } else if (
    model.allowedDurations &&
    !model.allowedDurations.includes(wanted)
  ) {
    caveats.push(
      `${model.label} renders ${model.allowedDurations.join(", ")} seconds only, so ${wanted}s becomes the nearest available`,
    );
  }

  if (brief.resolution.value === "1080p" && model.maxResolution === "720p") {
    conflicts.push(`${model.label} renders 720p only; you asked for 1080p`);
  }

  const audio = brief.audioStrategy.value;
  const capability = AUDIO_CAPABILITIES[model.id];
  if (
    audio === "NATIVE" &&
    capability &&
    !capability.strategies.includes("NATIVE")
  ) {
    // Not a caveat. Sound was asked for and this model has no audio at all.
    conflicts.push(
      `${model.label} produces no audio; sound would have to be added afterwards as Atheos sound design`,
    );
  }

  if (brief.shotCount.value > 1) {
    if (!model.canDirectMultipleShots) {
      conflicts.push(
        `${model.label} makes one continuous shot and cannot follow a ${brief.shotCount.value}-shot plan`,
      );
    } else if (!model.canProduceHardCuts) {
      /**
       * The honest middle. Veo takes the beats and visits them, but every run
       * measured so far came back with zero cuts — so this is a caveat on a
       * capable model, not a claim that it edits.
       */
      caveats.push(
        `${model.label} follows the shot plan but has not been observed producing hard cuts; expect one continuous take through the positions`,
      );
    }
  }

  if (
    brief.references.value.use === "preserve_exactly" &&
    brief.references.value.count > 0
  ) {
    if (!model.acceptsReferenceImages) {
      if (model.acceptsImageInput) {
        caveats.push(
          `${model.label} takes a first frame but no reference images, so the subject can drift after the opening`,
        );
      } else {
        conflicts.push(
          `${model.label} accepts no image at all, so your reference cannot guide it`,
        );
      }
    }
  }

  return {
    model,
    compatibility:
      conflicts.length > 0
        ? "incompatible"
        : caveats.length > 0
          ? "partial"
          : "compatible",
    conflicts,
    caveats,
    credits: model.creditsPerGeneration,
    estimatedSeconds: model.estimatedSeconds,
  };
}

export interface Recommendation {
  verdicts: RoutingVerdict[];
  /** Best fit. Never applied automatically. Absent when nothing fits. */
  recommended?: RoutingVerdict;
  /** Cheapest usable option, with its compromises stated. */
  cheaperAlternative?: RoutingVerdict;
  /**
   * The nearest miss, when **no** model can make the brief.
   *
   * Discovered by the tests: a 10-second 1080p four-shot commercial is
   * impossible in the current catalogue — Veo caps at 8 seconds and Cinematic
   * Long renders 720p only. Returning nothing at all would leave the composer
   * with a dead end and no explanation, so the closest option comes back with
   * exactly what would have to give.
   */
  closestCompromise?: RoutingVerdict;
  /** What the user would need to change for anything to become possible. */
  blockingRequirements: string[];
}

/**
 * Rank every enabled model against the brief.
 *
 * The recommendation is returned, never applied. Silently upgrading somebody to
 * a model that costs three times more is a decision about their money, and it
 * is theirs.
 */
export function recommendModels(
  brief: CreativeBrief,
  models: readonly ModelCapability[] = MODEL_CAPABILITIES,
): Recommendation {
  const verdicts = models.map((m) => assessModel(brief, m));

  const usable = verdicts
    .filter((v) => v.compatibility !== "incompatible")
    .sort((a, b) => {
      // Fewest compromises first, then cheapest.
      if (a.compatibility !== b.compatibility) {
        return a.compatibility === "compatible" ? -1 : 1;
      }
      return a.credits - b.credits;
    });

  const recommended = usable[0];

  if (recommended) {
    const cheaperAlternative = usable
      .filter((v) => v !== recommended)
      .sort((a, b) => a.credits - b.credits)[0];
    return {
      verdicts,
      recommended,
      cheaperAlternative,
      blockingRequirements: [],
    };
  }

  // Nothing fits. Offer the nearest miss and say what is in the way, rather
  // than returning an empty recommendation the composer cannot act on.
  const closestCompromise = [...verdicts].sort((a, b) => {
    if (a.conflicts.length !== b.conflicts.length) {
      return a.conflicts.length - b.conflicts.length;
    }
    return a.credits - b.credits;
  })[0];

  // De-duplicated across models: the same limit hit by several tiers is one
  // thing the user has to change, not five.
  const blockingRequirements = [
    ...new Set(verdicts.flatMap((v) => v.conflicts)),
  ];

  return { verdicts, closestCompromise, blockingRequirements };
}

/**
 * The server's own check, run again at submission.
 *
 * The client is not trusted with this. A request naming an incompatible model
 * is refused here whether it came from the composer or from curl.
 */
export function rejectIfIncompatible(
  brief: CreativeBrief,
  modelId: string,
): { ok: boolean; reason?: string } {
  const model = MODEL_CAPABILITIES.find((m) => m.id === modelId);
  if (!model) return { ok: false, reason: `unknown model ${modelId}` };

  const verdict = assessModel(brief, model);
  if (verdict.compatibility === "incompatible") {
    return { ok: false, reason: verdict.conflicts.join("; ") };
  }
  return { ok: true };
}
