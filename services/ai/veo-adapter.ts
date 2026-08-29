import {
  compileDirectedPrompt,
  type DirectedPrompt,
} from "@/services/ai/directed-prompt";
import type { SequenceModelFacts } from "@/services/ai/sequence";
import type { AudioDirectorPlan } from "@/services/ai/audio-director";
import type { VideoDirectorPlan } from "@/services/ai/video-director";

/**
 * Building a Veo 3.1 request, and refusing to build an invalid one.
 *
 * ## Pure, so it can be tested without spending anything
 *
 * This produces the request body; something else sends it. That split is the
 * only way to have real coverage of a paid endpoint: every constraint below is
 * checked against a mocked contract rather than discovered when a provider
 * rejects a job that has already reserved credits — which is exactly how Motion
 * 1 shipped for three sprints sending `image` and `negative_prompt` to a schema
 * that had neither.
 *
 * ## The constraints are the model's own
 *
 * Read from the Replicate schemas on 2026-08-22:
 *
 *   - `duration` is an enum of **4, 6 or 8**. No other value renders.
 *   - `reference_images` exists **only on veo-3.1**, takes 1–3 images, and
 *     works **only at 16:9 and 8 seconds**. `last_frame` is ignored when it is
 *     used, so sending both is asking for one to be silently dropped.
 *   - `negative_prompt` exists on veo-3.1 and veo-3.1-fast, **not on lite**.
 *   - `generate_audio` exists on veo-3.1 and veo-3.1-fast and defaults true.
 *     **Lite has no such field**: its audio cannot be turned off.
 */

export interface VeoInput {
  prompt: string;
  duration: number;
  resolution: "720p" | "1080p";
  aspect_ratio: "16:9" | "9:16";
  negative_prompt?: string;
  generate_audio?: boolean;
  image?: string;
  last_frame?: string;
  reference_images?: string[];
  seed?: number;
}

export interface VeoRequest {
  input: VeoInput;
  /** The compiled prompt, kept for snapshotting and for the job record. */
  directed: DirectedPrompt;
  /** Constraints that changed the request. Shown, never silently applied. */
  adjustments: string[];
  /** Reasons the request cannot be sent at all. */
  refusals: string[];
}

export function buildVeoRequest(input: {
  facts: SequenceModelFacts;
  plan: VideoDirectorPlan;
  audio?: AudioDirectorPlan;
  requestedDurationSeconds: number;
  resolution?: "720p" | "1080p";
  aspectRatio?: "16:9" | "9:16";
  referenceImageUrls?: readonly string[];
  startImageUrl?: string;
  lastFrameUrl?: string;
  seed?: number;
}): VeoRequest {
  const { facts } = input;
  const adjustments: string[] = [];
  const refusals: string[] = [];

  const allowed = facts.allowedDurations ?? [8];
  let duration = input.requestedDurationSeconds;
  if (!allowed.includes(duration)) {
    const longer = allowed.filter((option) => option > duration);
    const next = longer.length > 0 ? Math.min(...longer) : Math.max(...allowed);
    adjustments.push(
      `${facts.label} renders ${allowed.join(", ")} seconds only, so ${duration}s becomes ${next}s.`,
    );
    duration = next;
  }

  let resolution = input.resolution ?? "1080p";
  const aspectRatio = input.aspectRatio ?? "16:9";

  /**
   * Lite renders 1080p only at 8 seconds.
   *
   * Its schema says so in the `duration` description. Sending 1080p with a
   * 4-second duration is a request the model will reject after the credits are
   * reserved, so it is resolved here — downward, because dropping to 720p costs
   * the user nothing while silently doubling their clip length changes what
   * they asked for.
   */
  if (
    facts.id === "cinematic-lite" &&
    resolution === "1080p" &&
    duration !== 8
  ) {
    adjustments.push(
      "Cinematic Lite renders 1080p only at 8 seconds, so this clip is 720p.",
    );
    resolution = "720p";
  }

  const references = input.referenceImageUrls ?? [];
  let sendReferences: string[] = [];

  if (references.length > 0) {
    if (!facts.supportsReferenceImages) {
      adjustments.push(
        `${facts.label} has no reference-image input, so your reference guides nothing here. Cinematic supports it.`,
      );
    } else if (references.length > 3) {
      refusals.push("Reference images are limited to three.");
    } else if (aspectRatio !== "16:9" || duration !== 8) {
      /**
       * A refusal rather than a silent correction.
       *
       * Forcing 16:9 and 8s to make references work would change both the shape
       * and the length of the video someone asked for, and charge more for the
       * privilege. The user picks which constraint to drop.
       */
      refusals.push(
        "Reference images work only at 16:9 and 8 seconds. Change the aspect ratio and duration, or remove the reference.",
      );
    } else {
      sendReferences = [...references];
    }
  }

  // `last_frame` is ignored when references are sent, so it is dropped rather
  // than sent to be discarded.
  const lastFrame = sendReferences.length > 0 ? undefined : input.lastFrameUrl;
  if (input.lastFrameUrl && sendReferences.length > 0) {
    adjustments.push(
      "Veo ignores an end frame when reference images are supplied, so the end frame is not sent.",
    );
  }

  const directed = compileDirectedPrompt({
    plan: input.plan,
    durationSeconds: duration,
    audio: input.audio,
    supportsNegativePrompt: facts.supportsNegativePrompt,
  });

  const veo: VeoInput = {
    prompt: directed.prompt,
    duration,
    resolution,
    aspect_ratio: aspectRatio,
  };

  // Each field is added only where the schema has it. An input a model does not
  // declare is not ignored by Replicate — it is a rejected job.
  if (facts.supportsNegativePrompt && directed.negativePrompt) {
    veo.negative_prompt = directed.negativePrompt;
  }
  if (facts.id !== "cinematic-lite") {
    veo.generate_audio = directed.includesAudioDirection;
  } else if (!directed.includesAudioDirection) {
    adjustments.push(
      "Cinematic Lite always generates audio — it has no switch to turn it off, so this clip will have sound.",
    );
  }
  if (input.startImageUrl) veo.image = input.startImageUrl;
  if (lastFrame) veo.last_frame = lastFrame;
  if (sendReferences.length > 0) veo.reference_images = sendReferences;
  if (input.seed !== undefined) veo.seed = input.seed;

  return { input: veo, directed, adjustments, refusals };
}

// ---------------------------------------------------------------------------
// Output validation
// ---------------------------------------------------------------------------

export interface DeliveredVideo {
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  width: number;
  height: number;
  durationSeconds: number;
}

export interface DeliveryCheck {
  ok: boolean;
  problems: string[];
}

/**
 * Check a finished file against what was promised, before it is delivered.
 *
 * The claim that matters most is audio: a tier sold on "native audio" that
 * returns a silent file has mis-sold itself, and nothing upstream would notice
 * — the video plays. So the promise and the file are compared explicitly rather
 * than trusted.
 */
export function validateDeliveredVideo(input: {
  measured: DeliveredVideo;
  expectedDurationSeconds: number;
  expectedResolution: "720p" | "1080p";
  expectedAspectRatio: "16:9" | "9:16";
  audioPromised: boolean;
}): DeliveryCheck {
  const { measured } = input;
  const problems: string[] = [];

  if (!measured.hasVideoStream) {
    return { ok: false, problems: ["the file has no video stream"] };
  }

  if (input.audioPromised && !measured.hasAudioStream) {
    problems.push("native audio was promised and the file has no audio stream");
  }

  const expectedHeight = input.expectedResolution === "1080p" ? 1080 : 720;
  // The short edge carries the resolution label in both orientations.
  const shortEdge = Math.min(measured.width, measured.height);
  if (shortEdge !== expectedHeight) {
    problems.push(
      `${measured.width}x${measured.height} is not the ${input.expectedResolution} that was quoted`,
    );
  }

  const [wRatio, hRatio] = input.expectedAspectRatio.split(":").map(Number);
  const expectedRatio = wRatio / hRatio;
  const actualRatio = measured.width / measured.height;
  // 2% covers rounding to even pixel dimensions, not a different shape.
  if (Math.abs(actualRatio - expectedRatio) / expectedRatio > 0.02) {
    problems.push(`the file is not ${input.expectedAspectRatio}`);
  }

  // One frame at 24fps.
  if (
    Math.abs(measured.durationSeconds - input.expectedDurationSeconds) >
    1 / 24
  ) {
    problems.push(
      `the file is ${measured.durationSeconds.toFixed(2)}s, not the ${input.expectedDurationSeconds}s that was quoted`,
    );
  }

  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Post-generation shot detection
// ---------------------------------------------------------------------------

export interface ShotBoundaryReport {
  /** Hard cuts found in the delivered file. */
  cutsDetected: number;
  /** Distinct shots implied by those cuts. */
  shotsDetected: number;
  /** Whether the delivery matches what the prompt demanded. */
  matchesPlan: boolean;
  /** Timestamps of the detected cuts, seconds. */
  cutTimestamps: number[];
  note: string;
}

/**
 * Did the model actually cut, or did it fly one continuous move?
 *
 * ## Why this exists
 *
 * The first directed benchmark was reported as "four beats delivered". Scene
 * detection on the file found **zero cuts at any threshold** — it was one
 * unbroken drone orbit that passed through four viewpoints. Four camera
 * positions visited during one move is not four shots, and the difference is
 * the whole product claim.
 *
 * The reviewer caught that; the code did not. So the count now comes from the
 * file, and the UI is not allowed to say "N-shot sequence" until this has run.
 *
 * `cutTimestamps` comes from a scene-change pass over the delivered video
 * (ffmpeg `select='gt(scene,T)'`); this function only judges them, so it stays
 * pure and testable without a media file.
 */
export function detectShotBoundaries(input: {
  cutTimestamps: readonly number[];
  expectedShots: number;
  durationSeconds: number;
}): ShotBoundaryReport {
  // A "cut" at 0 or at the very end is the file boundary, not an edit.
  const edge = 0.1;
  const cuts = input.cutTimestamps
    .filter((t) => t > edge && t < input.durationSeconds - edge)
    .sort((a, b) => a - b);

  const shotsDetected = cuts.length + 1;
  const matchesPlan = shotsDetected === input.expectedShots;

  return {
    cutsDetected: cuts.length,
    shotsDetected,
    matchesPlan,
    cutTimestamps: cuts,
    note: matchesPlan
      ? `${shotsDetected} distinct shots, cut at ${cuts.map((t) => `${t.toFixed(1)}s`).join(", ")}`
      : cuts.length === 0
        ? "no cuts found — this is one continuous camera move, not an edited sequence"
        : `${shotsDetected} shots found, ${input.expectedShots} were requested`,
  };
}

/**
 * What the UI may call a delivered video.
 *
 * Until `detectShotBoundaries` has confirmed the cuts, the honest name for a
 * multi-beat generation is **directed camera movement** — that is what the last
 * one turned out to be. "N-shot sequence" is a claim about an edit, and it is
 * only available once the edit has been found in the file.
 */
export function describeDelivered(input: {
  beatsInstructed: number;
  validation?: ShotBoundaryReport;
}): string {
  if (input.beatsInstructed <= 1) return "Continuous clip";

  if (!input.validation) return "Directed camera movement (shots not verified)";

  if (input.validation.matchesPlan) {
    return `${input.validation.shotsDetected}-shot sequence`;
  }

  return input.validation.cutsDetected === 0
    ? "Directed camera movement — one continuous take, no cuts"
    : `Directed camera movement — ${input.validation.shotsDetected} shots found, ${input.beatsInstructed} requested`;
}
