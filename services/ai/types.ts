import type { Modality } from "@/lib/generated/prisma/enums";

/**
 * The provider contract.
 *
 * This file is the most important boundary in the codebase. Atheos exists to
 * put many AI vendors behind one interface, so the value of the product is
 * precisely the quality of this seam.
 *
 * The rule, stated once:
 *
 * > Nothing outside `services/ai` may import a vendor SDK, and nothing outside
 * > this directory may branch on which provider is in use. If a component,
 * > route or feature knows it is talking to a specific vendor, the abstraction
 * > has failed and the cost lands on us the day that vendor changes its
 * > pricing, its API, or its willingness to serve us.
 *
 * Sprint 6 extended this with **operations**. Everything else is unchanged from
 * Sprint 0, which is the point — a contract that survives its first real
 * implementation was worth defining up front.
 */

/** Stable identifier for a provider. A string, not an enum: adding a vendor
 *  must never require a database migration. */
export type ProviderId = string;

/**
 * What a request asks the model to *do*.
 *
 * Modelled as an operation on one request type rather than as five separate
 * methods. Vendors disagree wildly about which of these are distinct endpoints
 * — Replicate makes them all "run a model", OpenAI has separate routes for
 * generate and edit — and a five-method interface would force every adapter to
 * stub the ones its vendor folds together.
 *
 * A single request with an operation field also means the queue, the credit
 * ledger and the asset pipeline handle all five identically, which is where
 * most of the leverage is.
 */
export type GenerationOperation =
  | "text-to-image"
  | "image-to-image"
  | "upscale"
  | "remove-background"
  | "variations"
  | "text-to-video"
  | "image-to-video";

/** Operations that require at least one input image. */
export const OPERATIONS_REQUIRING_INPUT: ReadonlySet<GenerationOperation> =
  new Set([
    "image-to-image",
    "upscale",
    "remove-background",
    "variations",
    "image-to-video",
  ]);

/** Operations that produce video rather than a still. */
export const VIDEO_OPERATIONS: ReadonlySet<GenerationOperation> = new Set([
  "text-to-video",
  "image-to-video",
]);

/** Operations that ignore the prompt entirely. */
export const OPERATIONS_WITHOUT_PROMPT: ReadonlySet<GenerationOperation> =
  new Set(["upscale", "remove-background", "variations"]);

export interface ModelCapabilities {
  supportsNegativePrompt: boolean;
  supportsImageInput: boolean;
  supportsSeed: boolean;
  /** Aspect ratios expressed as "16:9". Empty means arbitrary dimensions. */
  aspectRatios: readonly string[];
  maxOutputs: number;
  /**
   * Clip lengths the model accepts, in seconds. Absent for image models.
   *
   * A list rather than a maximum: video models accept specific durations, not
   * a range. Offering a slider from 1 to 10 on a model that only does 5 or 10
   * means most positions are silently rounded, and the user is charged for a
   * clip they did not ask for.
   */
  durations?: readonly number[];
  /** Legacy convenience — the longest supported clip. */
  maxDurationSeconds?: number;
  /**
   * Camera movements the model understands, as prompt-ready phrases.
   *
   * Distinct from the image composer's camera *controls* (shot, angle, lens),
   * which describe a fixed frame. These describe how the frame moves, and only
   * video models have an opinion about them.
   */
  cameraMotions?: readonly string[];
  /**
   * Which operations this model can perform. A model that only upscales
   * declares exactly that, and the studio will not offer it for a prompt.
   */
  operations: readonly GenerationOperation[];
}

/** A single model offered by a provider. */
export interface ProviderModel {
  id: string;
  providerId: ProviderId;
  displayName: string;
  modality: Modality;
  capabilities: ModelCapabilities;
  /** Credits charged per output. Resolved by our pricing layer, not the
   *  vendor, so margin is ours to set. */
  creditCost: number;
}

/** A generation request, in *our* vocabulary. Adapters translate this into
 *  whatever shape a vendor wants; callers never see the vendor's shape. */
export interface GenerationRequest {
  operation: GenerationOperation;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  seed?: number;
  outputs?: number;
  /**
   * Publicly reachable URLs for source material.
   *
   * URLs rather than bytes, deliberately: every provider we have looked at
   * accepts a URL, uploading is a second failure mode, and passing base64
   * through a serverless function is how request-size limits get hit. The
   * pipeline puts user uploads into R2 first and passes those URLs.
   */
  inputImageUrls?: readonly string[];
  /** 0–1. How strongly the input should constrain the result. */
  inputStrength?: number;
  /** Upscale factor. Only meaningful for `upscale`. */
  scale?: number;
  /** Clip length in seconds. Video operations only. */
  durationSeconds?: number;
  /** Frames per second, where the model exposes it. */
  fps?: number;
  /** Camera movement phrase, from the model's declared `cameraMotions`. */
  cameraMotion?: string;
  /** Anything a specific model takes that the common shape does not express.
   *  Deliberately narrow — if a field appears here for three providers it
   *  belongs in the interface above. */
  providerOptions?: Record<string, unknown>;
}

export type JobState =
  "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface GenerationOutput {
  /** Where the vendor is serving the result. Transient — the pipeline copies
   *  it into R2 and never hands a vendor URL to a user, because it expires. */
  sourceUrl: string;
  mimeType: string;
  width?: number;
  height?: number;
  seed?: number;
  /** Clip length, for video outputs. */
  durationMs?: number;
}

/**
 * Normalised failure.
 *
 * Every vendor fails differently and describes it badly. Adapters map their
 * errors onto this so retry policy, credit refunds and user-facing copy are
 * written once rather than per vendor.
 */
export interface ProviderError {
  /** Whether retrying the identical request could succeed. Drives both the
   *  retry policy and whether the user's credits are refunded. */
  retryable: boolean;
  code: ProviderErrorCode;
  /** Safe to show a user. Never contains vendor internals or our API keys. */
  message: string;
  /** The vendor's own error, kept for debugging only. Never rendered. */
  raw?: unknown;
}

export type ProviderErrorCode =
  | "rate_limited"
  | "content_filtered"
  | "invalid_request"
  | "provider_unavailable"
  | "timeout"
  | "insufficient_provider_credit"
  | "unsupported_operation"
  | "unknown";

/** Normalised job status. Vendors report progress in wildly different ways;
 *  everything above this layer sees only this. */
export interface GenerationJob {
  providerJobId: string;
  state: JobState;
  /** 0–1 where the vendor reports it; undefined where it does not. Never fake
   *  a percentage — a progress bar that lies is worse than a spinner. */
  progress?: number;
  outputs?: readonly GenerationOutput[];
  error?: ProviderError;
}

/**
 * What every adapter must implement.
 *
 * Generation is submit-then-poll rather than a single awaited call. That is not
 * over-engineering: image models take seconds, video models take minutes, and a
 * serverless function cannot hold a request open that long. One shape for all
 * operations keeps the pipeline, the UI and the credit ledger from forking.
 */
export interface AIProvider {
  readonly id: ProviderId;
  readonly displayName: string;

  /** True when credentials are present. The registry uses this to decide
   *  whether the provider can be offered at all. */
  isConfigured(): boolean;

  /** Models this provider currently offers. */
  listModels(): readonly ProviderModel[];

  /** Submit work. Returns as soon as the vendor accepts it. */
  submit(request: GenerationRequest): Promise<GenerationJob>;

  /** Poll for progress. Must be safe to call repeatedly and concurrently. */
  poll(providerJobId: string): Promise<GenerationJob>;

  /** Best-effort cancellation. Providers that do not support it should resolve
   *  rather than throw, so callers need no special case. */
  cancel?(providerJobId: string): Promise<void>;
}

/** Helper for adapters: build a normalised error without repeating the shape. */
export function providerError(
  code: ProviderErrorCode,
  message: string,
  options: { retryable?: boolean; raw?: unknown } = {},
): ProviderError {
  return {
    code,
    message,
    // Default to non-retryable. Retrying a request that cannot succeed burns
    // the user's credits twice and hides the real problem.
    retryable: options.retryable ?? false,
    raw: options.raw,
  };
}
