import {
  VIDEO_CAPABILITIES,
  type VideoModelCapability,
} from "@/services/ai/video-capabilities";

/**
 * Video quality modes, honest resolution labelling, and output assessment.
 *
 * ## The labelling rule, which is the point of this file
 *
 * A video may be described as 1080p **only if the provider generated it at
 * 1080p**. Anything reached by upscaling is labelled as upscaled, with the
 * native resolution named alongside it. Sprint 4.4 already had to retract a
 * "4K" claim on an encoded 1080p asset; the rule exists because the temptation
 * recurs every time a marketing number is one string away.
 *
 * Concretely, from the verified capability matrix:
 *
 *   Motion 1  (wan-2.2-t2v-fast)   native 480p / 720p   — never 1080p
 *   Motion Pro (seedance-1-lite)   native up to 1080p
 *
 * So a Pro-mode request on Motion 1 is a **720p native, 1080p upscaled** output
 * and must say so. `describeOutput` is the only function permitted to produce
 * that sentence.
 */

export type QualityMode = "draft" | "quality" | "pro";

export interface QualityModeSpec {
  mode: QualityMode;
  label: string;
  description: string;
  /** Preferred native resolution. Downgraded when the model cannot reach it. */
  targetResolution: string;
  /** Seconds. Clamped to the model's own ceiling. */
  targetDuration: number;
  /** Whether post-generation enhancement is permitted in this mode. */
  allowsEnhancement: boolean;
}

export const QUALITY_MODES: Record<QualityMode, QualityModeSpec> = {
  draft: {
    mode: "draft",
    label: "Draft",
    description:
      "A quick look at the motion. Lowest resolution and shortest duration, so an idea can be rejected cheaply.",
    targetResolution: "480p",
    targetDuration: 5,
    // Enhancing a draft spends money making a preview pretty, which is the
    // opposite of what a preview is for.
    allowsEnhancement: false,
  },
  quality: {
    mode: "quality",
    label: "Quality",
    description:
      "The default. Native 720p where the model supports it, balanced against cost.",
    targetResolution: "720p",
    targetDuration: 5,
    allowsEnhancement: false,
  },
  pro: {
    mode: "pro",
    label: "Pro",
    description:
      "The highest resolution the chosen model generates natively, with optional temporal upscaling above that.",
    targetResolution: "1080p",
    targetDuration: 10,
    allowsEnhancement: true,
  },
};

const RANK: Record<string, number> = { "480p": 1, "720p": 2, "1080p": 3 };

export interface OutputDescription {
  /** What the provider actually generates. Never aspirational. */
  nativeResolution: string;
  /** What the user receives, which may be upscaled. */
  exportResolution: string;
  /** True when export exceeds native — the label must say so. */
  upscaled: boolean;
  /** The sentence to show. The only approved phrasing. */
  label: string;
  durationSeconds: number;
  frameRate: number;
}

/**
 * Describe what a mode will actually produce on a given model.
 *
 * Takes the model rather than assuming one, because the same mode means
 * different things on different models and pretending otherwise is how a 720p
 * clip gets sold as 1080p.
 */
export function describeOutput(
  model: VideoModelCapability,
  mode: QualityMode,
  requestedSeconds?: number,
): OutputDescription {
  const spec = QUALITY_MODES[mode];

  // The best the model can actually do, capped by what the mode asks for.
  const wanted = RANK[spec.targetResolution] ?? 2;
  const reachable = model.resolutions
    .map((r) => ({ r, rank: RANK[r.toLowerCase()] ?? 0 }))
    .filter((x) => x.rank <= wanted)
    .sort((a, b) => b.rank - a.rank)[0];

  const nativeResolution =
    reachable?.r ??
    // Model offers nothing at or below the target: take its lowest.
    model.resolutions
      .map((r) => ({ r, rank: RANK[r.toLowerCase()] ?? 0 }))
      .sort((a, b) => a.rank - b.rank)[0]?.r ??
    "unknown";

  const upscaled =
    spec.allowsEnhancement &&
    (RANK[nativeResolution.toLowerCase()] ?? 0) < wanted;

  const exportResolution = upscaled ? spec.targetResolution : nativeResolution;

  const cap =
    model.durationsSeconds.length > 0
      ? Math.max(...model.durationsSeconds)
      : spec.targetDuration;
  const durationSeconds = Math.min(
    requestedSeconds ?? spec.targetDuration,
    cap,
  );

  return {
    nativeResolution,
    exportResolution,
    upscaled,
    durationSeconds,
    frameRate: 24,
    label: upscaled
      ? `${exportResolution} upscaled from native ${nativeResolution}`
      : `native ${nativeResolution}`,
  };
}

/**
 * Structured assessment of a finished clip.
 *
 * Scores are 0–1 and every one of them is a **measurement to be implemented**,
 * not a value this module invents. `mandatoryConstraintsPassed` is the gate: a
 * clip that fails a mandatory constraint is a failure regardless of how high
 * the other numbers are, because "beautiful but the camera went inside the car"
 * is not a partial success.
 */
export interface VideoAssessment {
  promptAdherence: number;
  cameraCompliance: number;
  motionAccuracy: number;
  subjectConsistency: number;
  temporalStability: number;
  colorConsistency: number;
  /** Higher is worse. Compression, warping, morphing. */
  artifactRisk: number;
  mandatoryConstraintsPassed: boolean;
  /** Which named constraints failed, if any. */
  failedConstraints: readonly string[];
}

/** What a benchmark demands before it will call a result a pass. */
export interface QualityThresholds {
  promptAdherence: number;
  cameraCompliance: number;
  motionAccuracy: number;
  subjectConsistency: number;
  temporalStability: number;
  colorConsistency: number;
  maxArtifactRisk: number;
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  promptAdherence: 0.85,
  // The highest bar in the set. Camera is the instruction users state most
  // explicitly and the one models discard most readily, so it is scored
  // hardest — an aerial request that lands at ground level has failed
  // completely, whatever else it got right.
  cameraCompliance: 0.9,
  motionAccuracy: 0.85,
  subjectConsistency: 0.9,
  temporalStability: 0.85,
  colorConsistency: 0.85,
  maxArtifactRisk: 0.15,
};

export interface AssessmentVerdict {
  passed: boolean;
  failures: string[];
}

/**
 * Judge an assessment against thresholds.
 *
 * Mandatory constraints are checked first and short-circuit: no combination of
 * scores rescues a clip that broke one.
 */
export function judgeAssessment(
  assessment: VideoAssessment,
  thresholds: QualityThresholds = DEFAULT_THRESHOLDS,
): AssessmentVerdict {
  if (!assessment.mandatoryConstraintsPassed) {
    return {
      passed: false,
      failures: [
        "mandatory constraints failed",
        ...assessment.failedConstraints,
      ],
    };
  }

  const failures: string[] = [];
  const check = (name: string, value: number, floor: number) => {
    if (value < floor) failures.push(`${name} ${value.toFixed(2)} < ${floor}`);
  };

  check(
    "promptAdherence",
    assessment.promptAdherence,
    thresholds.promptAdherence,
  );
  check(
    "cameraCompliance",
    assessment.cameraCompliance,
    thresholds.cameraCompliance,
  );
  check("motionAccuracy", assessment.motionAccuracy, thresholds.motionAccuracy);
  check(
    "subjectConsistency",
    assessment.subjectConsistency,
    thresholds.subjectConsistency,
  );
  check(
    "temporalStability",
    assessment.temporalStability,
    thresholds.temporalStability,
  );
  check(
    "colorConsistency",
    assessment.colorConsistency,
    thresholds.colorConsistency,
  );

  if (assessment.artifactRisk > thresholds.maxArtifactRisk) {
    failures.push(
      `artifactRisk ${assessment.artifactRisk.toFixed(2)} > ${thresholds.maxArtifactRisk}`,
    );
  }

  return { passed: failures.length === 0, failures };
}

/** Modes offered for a model, with what each will really produce. */
export function qualityOptionsFor(
  modelId: string,
): { mode: QualityMode; output: OutputDescription }[] {
  const model = VIDEO_CAPABILITIES.find((m) => m.id === modelId);
  if (!model) return [];
  return (["draft", "quality", "pro"] as const).map((mode) => ({
    mode,
    output: describeOutput(model, mode),
  }));
}
