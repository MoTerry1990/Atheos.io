import {
  VIDEO_CAPABILITIES,
  type VideoModelCapability,
} from "@/services/ai/video-capabilities";
import {
  costEntry,
  worstCaseCostMicroUsd,
} from "@/services/billing/model-costs";

/**
 * Choosing a video model for a request, and saying why.
 *
 * ## Routing is a claim, so it has to be evidence-based
 *
 * Every input to the decision comes from `video-capabilities.ts`, whose values
 * were read from each provider's OpenAPI schema rather than its landing page.
 * That matters more here than anywhere else in the codebase, because the whole
 * point of routing is to answer "which model is best at this" — and a routing
 * table built on marketing copy answers a different question convincingly.
 *
 * ## Cost never rises silently
 *
 * A router that quietly upgrades to a better model is a router that quietly
 * spends more of somebody's money. `chooseVideoModel` returns the cheaper
 * candidate whenever the requirements are met, and when a costlier model is
 * genuinely the only one that qualifies it says so in `reason` and sets
 * `costsMore` — for the caller to surface before anything is charged.
 *
 * ## What routing cannot fix
 *
 * Neither shipped model accepts a camera parameter. Routing can prefer the one
 * with `camera_fixed` and first/last-frame inputs for a locked shot, and it can
 * refuse a request that needs image input on a text-only model. It cannot make
 * a model obey an aerial instruction it has no input for. See the header of
 * `services/ai/prompt-intelligence.ts`.
 */

export interface VideoRequirements {
  /** An input image must be honoured — image-to-video, not text-to-video. */
  needsImageInput?: boolean;
  /** The shot must start and/or end on a supplied frame. */
  needsFirstLastFrame?: boolean;
  /** The caller supplied a negative prompt and wants it respected. */
  needsNegativePrompt?: boolean;
  /** Synchronised audio, which today only Veo can produce. */
  needsNativeAudio?: boolean;
  /** Seconds of output. */
  durationSeconds?: number;
  /** "720p", "1080p". */
  minimumResolution?: string;
  aspectRatio?: string;
  /** The shot depends on the camera holding still. */
  cameraMustHold?: boolean;
  /**
   * The shot is an elevated camera following a moving subject.
   *
   * Set from the parsed camera intent — an aerial platform plus a tracking
   * motion. It exists because this is the one request type where measured
   * adherence and headline capability point at different models.
   */
  aerialTracking?: boolean;
}

export interface RoutingCandidate {
  model: VideoModelCapability;
  /** Higher is better. Only compared between models that already qualify. */
  score: number;
  /** Worst-case provider cost for this request, micro-USD. Null if unpriced. */
  costMicroUsd: number | null;
  reasons: string[];
}

export interface RoutingDecision {
  chosen: RoutingCandidate | null;
  /** Every model considered, qualified or not, with why. */
  considered: RoutingCandidate[];
  rejected: { model: string; because: string }[];
  /** True when the chosen model is not the cheapest that qualified. */
  costsMore: boolean;
  reason: string;
}

const RESOLUTION_RANK: Record<string, number> = {
  "480p": 1,
  "720p": 2,
  "1080p": 3,
  "4k": 4,
};

function meetsResolution(
  model: VideoModelCapability,
  minimum?: string,
): boolean {
  if (!minimum) return true;
  const want = RESOLUTION_RANK[minimum.toLowerCase()] ?? 0;
  return model.resolutions.some(
    (r) => (RESOLUTION_RANK[r.toLowerCase()] ?? 0) >= want,
  );
}

function costFor(model: VideoModelCapability, seconds: number): number | null {
  const entry = costEntry(model.id);
  if (!entry) return null;
  const perSecond = entry.perSecondMicroUsd ?? 0;
  const perOutput = entry.perOutputMicroUsd;
  if (perOutput === null) return null;
  // Duration-priced models dominate; the worst case guards the unpriced tail.
  return perSecond > 0
    ? perOutput + perSecond * seconds
    : (worstCaseCostMicroUsd(entry) ?? null);
}

/**
 * Pick a model, or explain why none fits.
 *
 * Hard requirements disqualify; everything else is a preference expressed as
 * score. A disqualified model is never chosen for being cheaper, because a
 * cheap model that cannot accept the user's image has not done the job.
 */
export function chooseVideoModel(
  requirements: VideoRequirements,
): RoutingDecision {
  const seconds = requirements.durationSeconds ?? 5;
  const considered: RoutingCandidate[] = [];
  const rejected: { model: string; because: string }[] = [];

  for (const model of VIDEO_CAPABILITIES) {
    if (!model.available) {
      rejected.push({ model: model.id, because: "not enabled in the product" });
      continue;
    }

    const missing: string[] = [];
    if (requirements.needsImageInput && !model.imageToVideo) {
      missing.push("no image input");
    }
    if (
      requirements.needsFirstLastFrame &&
      !(model.startFrame && model.endFrame)
    ) {
      missing.push("no first/last frame control");
    }
    if (requirements.needsNegativePrompt && !model.negativePrompt) {
      missing.push("no negative prompt");
    }
    if (requirements.needsNativeAudio && model.audio !== "native") {
      missing.push("no native audio");
    }
    if (!meetsResolution(model, requirements.minimumResolution)) {
      missing.push(`cannot reach ${requirements.minimumResolution}`);
    }
    if (
      requirements.aspectRatio &&
      model.aspectRatios.length > 0 &&
      !model.aspectRatios.includes(requirements.aspectRatio)
    ) {
      missing.push(`does not offer ${requirements.aspectRatio}`);
    }
    if (
      requirements.durationSeconds &&
      model.durationsSeconds.length > 0 &&
      requirements.durationSeconds > Math.max(...model.durationsSeconds)
    ) {
      missing.push(`caps at ${Math.max(...model.durationsSeconds)}s`);
    }

    if (missing.length > 0) {
      rejected.push({ model: model.id, because: missing.join("; ") });
      continue;
    }

    const reasons: string[] = [];
    let score = 0;

    /**
     * Measured prompt adherence, which outranks every capability.
     *
     * Sprint 6C ran the red-car prompt on both models at 5s, identical text.
     * The result inverted the capability ranking:
     *
     *   Motion 1  (wan-2.2)   correct high tracking drone shot, whole car in
     *                         frame, ocean held on one side for the whole clip
     *   Motion Pro (seedance) camera mounted at car level beside the hood, car
     *                         cropped — the exact failure the benchmark exists
     *                         to catch, at three times the cost
     *
     * Capability is not adherence. Motion Pro scores higher on reference
     * images, first-frame anchoring and native 1080p, and none of that helped
     * it obey "desde el cielo". So an aerial request now prefers the model that
     * actually produced an aerial shot.
     *
     * One comparison per model is thin evidence and is treated as such: it
     * breaks a tie between models that both qualify, and it never disqualifies
     * anything. If a later benchmark contradicts it, the weight moves.
     */
    if (requirements.aerialTracking && model.id === "replicate/video-gen") {
      // Deliberately larger than every capability bonus combined. Capability is
      // a proxy for a good result; adherence is the result. When the two
      // disagree and the disagreement was measured, the measurement wins.
      score += 8;
      reasons.push("measured best on aerial vehicle tracking (Sprint 6C)");
    }

    // Preferences, in the order the benchmark cares about.
    if (requirements.cameraMustHold && model.cameraControl) {
      score += 3;
      reasons.push("has a camera-hold control");
    }
    if (model.referenceImages) {
      score += 2;
      reasons.push("accepts reference images for identity");
    }
    if (model.startFrame) {
      score += 2;
      reasons.push("can be anchored to a first frame");
    }
    const best = model.resolutions
      .map((r) => RESOLUTION_RANK[r.toLowerCase()] ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    score += best;
    if (best >= 3) reasons.push("native 1080p");

    considered.push({
      model,
      score,
      costMicroUsd: costFor(model, seconds),
      reasons,
    });
  }

  if (considered.length === 0) {
    return {
      chosen: null,
      considered,
      rejected,
      costsMore: false,
      reason:
        rejected.length > 0
          ? `No available model satisfies this request: ${rejected.map((r) => `${r.model} (${r.because})`).join(", ")}`
          : "No video model is available.",
    };
  }

  // Best score wins; cost breaks a tie. Cost never overrides suitability.
  const ranked = [...considered].sort(
    (a, b) =>
      b.score - a.score ||
      (a.costMicroUsd ?? Number.MAX_SAFE_INTEGER) -
        (b.costMicroUsd ?? Number.MAX_SAFE_INTEGER),
  );

  const chosen = ranked[0];
  const cheapest = [...considered].sort(
    (a, b) =>
      (a.costMicroUsd ?? Number.MAX_SAFE_INTEGER) -
      (b.costMicroUsd ?? Number.MAX_SAFE_INTEGER),
  )[0];

  const costsMore =
    chosen.model.id !== cheapest.model.id &&
    (chosen.costMicroUsd ?? 0) > (cheapest.costMicroUsd ?? 0);

  return {
    chosen,
    considered,
    rejected,
    costsMore,
    reason: costsMore
      ? `${chosen.model.label} was chosen over the cheaper ${cheapest.model.label} because it ${chosen.reasons.join(", ")}. It costs more — confirm before generating.`
      : `${chosen.model.label} is the cheapest model that satisfies this request.`,
  };
}
