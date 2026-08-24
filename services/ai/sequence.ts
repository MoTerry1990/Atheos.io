import { creditsFor } from "@/services/ai/pricing";
import type { VideoDirectorPlan } from "@/services/ai/video-director";

/**
 * What a multi-shot video actually costs, and whether it can be made at all.
 *
 * ## The finding this module exists to encode
 *
 * Not one video model on Replicate returns a shot list. Every schema read on
 * 2026-08-22 — wan-2.2-t2v-fast, seedance-1-lite, seedance-1-pro, veo-3,
 * veo-3-fast, kling-v2.1, hailuo-02 — takes one prompt and returns one
 * continuous clip. "Route multi-angle requests to a model that natively
 * supports a coherent multi-shot video" has no destination: the option does not
 * exist at any price.
 *
 * So a four-shot sequence is four generations, and the honest consequences are
 * arithmetic rather than opinion:
 *
 *   - four provider calls, billed four times
 *   - each call has a **minimum** length, so a 2s shot still costs a 5s clip
 *   - continuity between shots is not free — it needs frame chaining, which
 *     forces the calls to run one after another
 *
 * ## Why continuity decides which models can do it at all
 *
 * Shot 2 has to contain the same car, the same driver and the same coastline as
 * shot 1. The only mechanism any of these models offers is an image input:
 * seedance's `image` / `last_frame_image` / `reference_images`, kling's
 * `start_image` / `end_image`, hailuo's `first_frame_image` /
 * `last_frame_image`. Feed shot N's final frame in as shot N+1's first frame
 * and the world carries across.
 *
 * **wan-2.2-t2v-fast has no image input of any kind.** Motion 1 therefore
 * cannot produce a coherent sequence at any cost — four calls to it would
 * return four unrelated cars. That is a blocker, not a quality note, and
 * `quoteSequence` refuses rather than pricing something that cannot work.
 */

export type SequenceMode =
  /** One provider call, one clip, no cuts. What every model does natively. */
  | "continuous"
  /**
   * One provider call whose prompt carries the whole timed shot plan.
   *
   * The strategy the first audit missed by looking for a `shot_list` parameter
   * instead of asking what a model can read. One call, one price, one wait, and
   * continuity the model holds internally rather than continuity Atheos tries to
   * stitch across separate generations.
   */
  | "directed"
  /** One call per shot, chained for continuity, assembled by Atheos. */
  | "multi_shot";

/** The model facts a quote depends on. Mirrors `video-capabilities.ts`. */
export interface SequenceModelFacts {
  id: string;
  label: string;
  creditCost: number;
  /** Lengths the model accepts. The smallest is the floor for every shot. */
  durationsSeconds: readonly number[];
  maxDurationSeconds: number;
  /** Provider cost per second of generated output, in micro-USD. */
  perSecondMicroUsd: number;
  /** Resolution the provider actually returns. Not what the UI offers. */
  nativeResolution: string;
  /** Frames per second in the delivered file. */
  deliveredFrameRate: number;
  /** Whether the model produces sound with the picture. */
  nativeAudio: boolean;
  /** Any image input — the prerequisite for cross-shot continuity. */
  acceptsImageInput: boolean;
  /** A dedicated last/end frame input. Chaining is exact with it. */
  acceptsEndFrame: boolean;
  /** Measured submit-to-delivered seconds for one clip. */
  measuredLatencySeconds: number;
  /**
   * Whether the model can hold a multi-beat plan inside one generation.
   *
   * Not a provider field — no vendor exposes one. It is a judgement about the
   * model's temporal coherence, and it is the difference between one call and
   * four. Set true only for models documented for cross-shot consistency.
   */
  followsDirectedBeats: boolean;
  /** Lengths the model will render. A request is snapped to one of these. */
  allowedDurations?: readonly number[];
  supportsNegativePrompt: boolean;
  /** 1-3 images for subject consistency, where the model has the input. */
  supportsReferenceImages: boolean;
  /** Continue an existing clip. Distinct from chaining by last frame. */
  supportsVideoExtension: boolean;
  /** How the model is reached. Decides whether a new adapter is needed. */
  reachableVia: "replicate" | "google-direct" | "unavailable";
  /** Where `perSecondMicroUsd` came from. Never left to the reader to assume. */
  costBasis: string;
}

export interface SequenceQuote {
  mode: SequenceMode;
  modelId: string;
  modelLabel: string;

  /** How many times the provider is called and billed. */
  providerCalls: number;
  /** What each call is asked to generate, in seconds. */
  clipDurationsSeconds: number[];
  /** Seconds actually generated and paid for — the sum of the clips. */
  generatedSeconds: number;
  /** Seconds the user receives after trimming and joining. */
  assembledDurationSeconds: number;

  nativeResolution: string;
  /** What Atheos exports. Never larger than native without saying upscaled. */
  exportResolution: string;
  frameRate: number;

  audio: "native" | "atheos_soundscape" | "none";

  providerCostMicroUsd: number;
  creditCharge: number;
  estimatedSeconds: number;

  /**
   * The camera beats written into the prompt, for `directed`.
   *
   * Instructed, never achieved — the model may merge two of them or invent a
   * fifth. Kept separate from anything about the result so the UI cannot read a
   * request as an outcome and print "4 shots" over a clip nobody has checked.
   */
  beats: { start: number; end: number; label: string }[];
  /** What this cannot promise. Always populated for multi-shot. */
  continuityLimitations: string[];
  /** Non-empty means the sequence cannot be generated. */
  blockers: string[];
}

/**
 * A shot cannot be shorter than the model's shortest clip.
 *
 * The plan asks for a 2s top-down beat; seedance's floor is 5s. The call still
 * costs 5s, and the extra is trimmed away. Charging for the plan's 2s would
 * mean Atheos absorbing the difference on every sequence, and quoting 2s would
 * be quoting a price that does not exist.
 */
function billableClipSeconds(
  requested: number,
  facts: SequenceModelFacts,
): number {
  /**
   * A model with a fixed ladder renders one of its own lengths or nothing.
   *
   * Veo accepts 4, 6 or 8 seconds and no other value, so a 5-second request
   * becomes 6 — longer rather than shorter, because a 4-second render loses a
   * fifth of the piece while 6 gives the beats room. The quote says so; quietly
   * delivering a different length from the one that was priced is the failure
   * this avoids.
   */
  if (facts.allowedDurations?.length) {
    const allowed = facts.allowedDurations;
    if (allowed.includes(requested)) return requested;
    const longer = allowed.filter((option) => option > requested);
    return longer.length > 0 ? Math.min(...longer) : Math.max(...allowed);
  }

  const floor = Math.min(...facts.durationsSeconds);
  return Math.min(facts.maxDurationSeconds, Math.max(floor, requested));
}

/** How long the provider is asked to run, per shot. */
export function clipLengthsFor(
  plan: VideoDirectorPlan,
  facts: SequenceModelFacts,
  mode: SequenceMode,
): number[] {
  if (mode === "continuous" || mode === "directed") {
    return [billableClipSeconds(plan.durationSeconds, facts)];
  }
  return plan.shots.map((shot) =>
    billableClipSeconds(shot.end - shot.start, facts),
  );
}

/**
 * Price and validate a sequence before a single provider call is made.
 *
 * Everything the user must see before spending is computed here, from the same
 * `creditsFor` the server charges with — the composer and the charge disagreeing
 * is the most damaging bug a credits product can have, so there is one
 * calculation rather than two.
 */
export function quoteSequence(input: {
  plan: VideoDirectorPlan;
  facts: SequenceModelFacts;
  mode: SequenceMode;
  /** Whether the user supplied a reference image to anchor the whole piece. */
  hasReferenceImage?: boolean;
  /** Requested export resolution, if the UI offers a choice. */
  requestedResolution?: string;
  wantsAudio?: boolean;
}): SequenceQuote {
  const { plan, facts, mode } = input;

  const clips = clipLengthsFor(plan, facts, mode);
  const generatedSeconds = clips.reduce((total, clip) => total + clip, 0);

  const blockers: string[] = [];
  const continuityLimitations: string[] = [];

  if (mode === "directed") {
    /**
     * One call whose prompt carries the whole timed plan. The limitation is
     * real and different in kind from the chained path's: the model is
     * *instructed* with every beat, and whether it delivered them is a question
     * for the output rather than the request.
     */
    if (!facts.followsDirectedBeats) {
      blockers.push(
        `${facts.label} is not documented for holding several camera positions ` +
          `inside one clip, so a directed sequence would come back as one muddled ` +
          `shot rather than ${plan.shots.length}.`,
      );
    } else if (plan.shots.length > 1) {
      continuityLimitations.push(
        `The ${plan.shots.length} camera beats are written into the prompt as timed ` +
          "instructions. The model follows them well or less well — this is best " +
          "effort until the output has been checked.",
      );
      continuityLimitations.push(
        "Continuity is held by the model inside one generation rather than stitched between clips, which is why it holds better here than in the chained path.",
      );
    }
  }

  if (mode === "multi_shot") {
    if (plan.shots.length < 2) {
      blockers.push(
        "This prompt plans a single continuous shot, so there is no sequence to assemble.",
      );
    }

    /**
     * The blocker that matters. Four calls to a text-only model return four
     * unrelated cars, and no amount of prompt text fixes it — the model has
     * nowhere to receive the previous shot.
     */
    if (!facts.acceptsImageInput) {
      blockers.push(
        `${facts.label} accepts no image input, so shots cannot carry the same ` +
          `car, driver or coastline between them. A sequence on this model would ` +
          `be four unrelated clips.`,
      );
    } else {
      continuityLimitations.push(
        facts.acceptsEndFrame
          ? "Each shot starts from the previous shot's final frame, so the calls run one after another rather than at once."
          : "Shots are anchored to a shared reference image rather than chained frame to frame, so small drift between shots is expected.",
      );

      if (!input.hasReferenceImage) {
        continuityLimitations.push(
          "No reference image was supplied, so the first shot defines the look and everything after inherits whatever it produced.",
        );
      }

      continuityLimitations.push(
        "Lighting and colour are matched by instruction, not by a shared grade — Atheos validates them after generation and refuses to assemble a sequence that drifts.",
      );
    }
  }

  /**
   * Resolution is what the provider returns, not what a dropdown offers.
   *
   * Motion 1's adapter sends `resolution: "720p"` on every call regardless of
   * the Size control, so a 1080px selection changes the label and nothing else.
   * Claiming it would be exactly the fake-1080p problem this work exists to
   * prevent.
   */
  const requested = input.requestedResolution;
  const exportResolution =
    requested && requested !== facts.nativeResolution
      ? `${requested} (upscaled from ${facts.nativeResolution})`
      : facts.nativeResolution;

  const audio: SequenceQuote["audio"] = facts.nativeAudio
    ? "native"
    : input.wantsAudio
      ? "atheos_soundscape"
      : "none";

  const creditCharge = clips.reduce(
    (total, clip) =>
      total +
      creditsFor(
        {
          creditCost: facts.creditCost,
          capabilities: { durations: facts.durationsSeconds },
        },
        1,
        clip,
      ),
    0,
  );

  /**
   * Chained shots are sequential; unchained ones are not.
   *
   * Reported rather than averaged away: four seedance calls at roughly twelve
   * minutes each is three quarters of an hour, and a user who is told "about
   * twelve minutes" because that is one clip has been misled about the only
   * number they can feel.
   */
  const sequential = mode === "multi_shot" && facts.acceptsEndFrame;
  const estimatedSeconds = sequential
    ? facts.measuredLatencySeconds * clips.length
    : facts.measuredLatencySeconds;

  /**
   * Beats rescaled onto the length the provider will actually render.
   *
   * A 5-second plan on Veo renders as 6, and beats that stop at 5.0s would
   * leave a second the prompt says nothing about.
   */
  const beats =
    mode === "directed" && blockers.length === 0
      ? plan.shots.map((shot, index) => {
          const scale = clips[0] / plan.durationSeconds;
          return {
            start: Number((shot.start * scale).toFixed(1)),
            end:
              index === plan.shots.length - 1
                ? clips[0]
                : Number((shot.end * scale).toFixed(1)),
            label: shot.angle,
          };
        })
      : [];

  return {
    mode,
    modelId: facts.id,
    modelLabel: facts.label,
    providerCalls: clips.length,
    clipDurationsSeconds: clips,
    generatedSeconds,
    // The plan's length, not the generated length: the surplus is trimmed.
    // Directed and continuous deliver exactly what was rendered; only the
    // chained path trims a longer generation down to the plan's length.
    assembledDurationSeconds:
      mode === "multi_shot" ? plan.durationSeconds : clips[0],
    nativeResolution: facts.nativeResolution,
    exportResolution,
    frameRate: facts.deliveredFrameRate,
    audio,
    providerCostMicroUsd: Math.round(
      generatedSeconds * facts.perSecondMicroUsd,
    ),
    creditCharge,
    estimatedSeconds,
    beats,
    continuityLimitations,
    blockers,
  };
}

/**
 * The credit price a model must carry to clear the documented margin floor.
 *
 * Not a guess and not a round number somebody liked. `model-costs.ts` fixes one
 * credit at **$0.005** and requires video revenue to be at least **3x** worst-case
 * provider cost — 3x rather than the catalogue's usual 2.5x because video cost is
 * measured from a single invoice and scales with a duration the customer picks.
 *
 * `creditCost` is the price at a model's *shortest* clip, since `creditsFor`
 * multiplies from there. Deriving it means a corrected provider rate moves the
 * price automatically instead of leaving a stale number behind.
 */
export function creditsAtMargin(input: {
  perSecondMicroUsd: number;
  seconds: number;
  /** Credit value in micro-USD. $0.005 per `model-costs.ts`. */
  creditValueMicroUsd?: number;
  /** Revenue as a multiple of cost. 3 for video. */
  marginMultiple?: number;
}): number {
  const creditValue = input.creditValueMicroUsd ?? 5_000;
  const multiple = input.marginMultiple ?? 3;
  const costMicroUsd = input.perSecondMicroUsd * input.seconds;
  // Ceiling: rounding down would ship a price under the floor it exists to hold.
  return Math.ceil((costMicroUsd * multiple) / creditValue);
}

/** `1080000` → `$1.08`. Two decimals, because that is how money reads. */
export function formatUsd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

/**
 * The generate button's label.
 *
 * "Generate · 90 credits" over a four-shot plan is the specific lie this
 * replaces: 90 credits bought the establishing shot and nothing else. The
 * label now names the deliverable and its full price together, so the two
 * cannot be read apart.
 */
export function generateLabel(quote: SequenceQuote): string {
  if (quote.blockers.length > 0) return "Not available on this model";

  if (quote.mode === "continuous") {
    return `Generate · ${quote.creditCharge.toLocaleString("en-US")} credits`;
  }

  if (quote.mode === "directed") {
    /**
     * "Directed camera movement", never "4 shots".
     *
     * The first directed benchmark was instructed with four beats and returned
     * one continuous orbit with zero cuts. A button that promised a four-shot
     * sequence would have been selling an edit the generation did not make, so
     * the label names the instruction and `describeDelivered` names the result
     * once a file exists to check.
     */
    return (
      `Generate directed camera movement · ` +
      `${quote.creditCharge.toLocaleString("en-US")} credits`
    );
  }

  return (
    `Generate ${quote.providerCalls}-shot sequence · ` +
    `${quote.creditCharge.toLocaleString("en-US")} credits`
  );
}

// ---------------------------------------------------------------------------
// Failure, retries and delivery
// ---------------------------------------------------------------------------

export interface ShotOutcome {
  index: number;
  status: "succeeded" | "failed";
  /** Provider seconds actually consumed, whether it succeeded or not. */
  billedSeconds: number;
}

export interface SequenceSettlement {
  /** Whether the finished piece may be handed to the user. */
  deliver: boolean;
  /** Credits kept. Never more than the shots that actually arrived. */
  chargeCredits: number;
  /** Credits returned to the user. */
  refundCredits: number;
  reason: string;
}

/**
 * What to charge when only some of the shots arrived.
 *
 * A sequence is one deliverable. Three shots out of four is not 75% of a video
 * — it is a video with a hole in it, and handing it over while charging for
 * four would be charging full price for a broken thing. So an incomplete
 * sequence is not delivered and not charged, and the successful shots stay in
 * the user's history as individual clips they already have.
 */
export function settleSequence(input: {
  quote: SequenceQuote;
  outcomes: readonly ShotOutcome[];
}): SequenceSettlement {
  const { quote, outcomes } = input;
  const succeeded = outcomes.filter((o) => o.status === "succeeded");

  if (
    succeeded.length === outcomes.length &&
    outcomes.length === quote.providerCalls
  ) {
    return {
      deliver: true,
      chargeCredits: quote.creditCharge,
      refundCredits: 0,
      reason: "every shot arrived",
    };
  }

  /**
   * Per-shot credit, derived from the quote rather than re-priced.
   *
   * Recomputing here is how the charge and the quote drift apart; dividing the
   * quoted total by the shot count keeps them defined as the same number.
   */
  const perShot = Math.floor(
    quote.creditCharge / Math.max(1, quote.providerCalls),
  );
  const charge = perShot * succeeded.length;

  return {
    deliver: false,
    chargeCredits: charge,
    refundCredits: quote.creditCharge - charge,
    reason:
      succeeded.length === 0
        ? "no shot was produced"
        : `only ${succeeded.length} of ${quote.providerCalls} shots were produced — ` +
          "the sequence is not delivered, and the shots that arrived are kept as individual clips",
  };
}

/** Measurements taken from a generated clip before it is joined to the others. */
export interface ShotMeasurement {
  index: number;
  width: number;
  height: number;
  frameRate: number;
  durationSeconds: number;
  /** Mean luma, 0-255. Compared between shots, never judged on its own. */
  meanLuma: number;
  /** Mean hue of the frame, degrees. Wraps at 360. */
  meanHueDegrees: number;
}

export interface ContinuityReport {
  ok: boolean;
  problems: string[];
}

/**
 * Check the shots against each other before assembling them.
 *
 * ## Why this runs before assembly and not after
 *
 * Once four clips are concatenated the seams are the only thing a viewer sees,
 * and a mismatch is far harder to diagnose in the joined file than in the parts.
 * More to the point: assembling and delivering a sequence whose shots disagree
 * is delivering a broken video and charging for it. Refusing before the join is
 * what makes `settleSequence`'s "not delivered, not charged" branch reachable.
 *
 * The thresholds are deliberately loose. Generated shots of the same scene are
 * never pixel-identical, and a check strict enough to demand that would reject
 * everything; these catch the failures a viewer actually notices — a shot that
 * is visibly a different time of day, or a different colour of world.
 */
export function validateSequenceContinuity(
  shots: readonly ShotMeasurement[],
): ContinuityReport {
  const problems: string[] = [];

  if (shots.length < 2) {
    return { ok: true, problems: [] };
  }

  const [first] = shots;

  for (const shot of shots.slice(1)) {
    // Frame size and rate must match exactly: concatenating mismatched streams
    // either fails outright or silently rescales one of them.
    if (shot.width !== first.width || shot.height !== first.height) {
      problems.push(
        `shot ${shot.index} is ${shot.width}x${shot.height}, shot ${first.index} is ${first.width}x${first.height}`,
      );
    }
    if (shot.frameRate !== first.frameRate) {
      problems.push(
        `shot ${shot.index} is ${shot.frameRate}fps, shot ${first.index} is ${first.frameRate}fps`,
      );
    }

    // Roughly a third of a stop. Below this reads as the same daylight.
    if (Math.abs(shot.meanLuma - first.meanLuma) > 40) {
      problems.push(
        `shot ${shot.index} is a different brightness from shot ${first.index} — the light does not match`,
      );
    }

    // Hue is circular: 350° and 10° are twenty degrees apart, not three hundred.
    const hueGap = Math.abs(shot.meanHueDegrees - first.meanHueDegrees);
    if (Math.min(hueGap, 360 - hueGap) > 45) {
      problems.push(
        `shot ${shot.index} is a different colour from shot ${first.index} — the grade does not match`,
      );
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Does the assembled file last what the user was told it would?
 *
 * A tolerance of one frame at 24fps. The trim points are computed in seconds
 * and land on frame boundaries, so a small remainder is expected; anything
 * larger means the assembly dropped or duplicated something.
 */
export function assembledDurationMatches(
  quote: SequenceQuote,
  measuredSeconds: number,
): { ok: boolean; problem?: string } {
  const drift = Math.abs(measuredSeconds - quote.assembledDurationSeconds);
  if (drift <= 1 / 24) return { ok: true };

  return {
    ok: false,
    problem:
      `the assembled video is ${measuredSeconds.toFixed(3)}s but was quoted as ` +
      `${quote.assembledDurationSeconds}s`,
  };
}

export interface RetryBudget {
  allowed: boolean;
  reason: string;
  /** Micro-USD this retry would add on top of what has been spent. */
  additionalCostMicroUsd: number;
}

/**
 * Whether a failed shot may be retried.
 *
 * Retries on a per-call provider are a way to spend an unbounded amount of
 * money on a request the user approved once. Two limits, both hard: a count,
 * and a ceiling on total provider spend relative to the quote.
 */
export function retryBudgetFor(input: {
  quote: SequenceQuote;
  attemptsSoFar: number;
  spentMicroUsd: number;
  /** Retries per shot, not per sequence. */
  maxAttemptsPerShot?: number;
  /** How far over the quote the provider spend may go. 1.5 = 50% headroom. */
  overspendCeiling?: number;
}): RetryBudget {
  const maxAttempts = input.maxAttemptsPerShot ?? 2;
  const ceiling = input.overspendCeiling ?? 1.5;

  const perCallMicroUsd = Math.round(
    input.quote.providerCostMicroUsd / Math.max(1, input.quote.providerCalls),
  );

  if (input.attemptsSoFar >= maxAttempts) {
    return {
      allowed: false,
      reason: `already attempted ${input.attemptsSoFar} times (limit ${maxAttempts})`,
      additionalCostMicroUsd: 0,
    };
  }

  const projected = input.spentMicroUsd + perCallMicroUsd;
  const cap = Math.round(input.quote.providerCostMicroUsd * ceiling);

  if (projected > cap) {
    return {
      allowed: false,
      reason:
        `a retry would take provider spend to ${formatUsd(projected)}, past the ` +
        `${formatUsd(cap)} ceiling for a ${formatUsd(input.quote.providerCostMicroUsd)} quote`,
      additionalCostMicroUsd: 0,
    };
  }

  return {
    allowed: true,
    reason: `attempt ${input.attemptsSoFar + 1} of ${maxAttempts}`,
    additionalCostMicroUsd: perCallMicroUsd,
  };
}
