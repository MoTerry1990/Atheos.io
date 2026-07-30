import type { Modality } from "@/lib/generated/prisma/enums";

/**
 * The provider contract.
 *
 * This file is the most important boundary in the codebase. Atheos exists to
 * put many AI vendors behind one interface, so the value of the product is
 * precisely the quality of this seam.
 *
 * **Types only — no implementations.** Adapters arrive in Sprint 2. Defining
 * the contract first means the data model, credit ledger and job pipeline are
 * all built against a stable shape rather than against whichever vendor we
 * happen to integrate first.
 *
 * The rule this enforces, stated once:
 *
 * > Nothing outside `services/ai` may import a vendor SDK, and nothing outside
 * > this directory may branch on which provider is in use. If a component,
 * > route or feature knows it is talking to a specific vendor, the abstraction
 * > has failed and the cost lands on us the day that vendor changes its pricing,
 * > its API, or its willingness to serve us.
 */

/** Stable identifier for a provider. A string, not an enum: adding a vendor
 *  must never require a database migration. */
export type ProviderId = string;

/** A single model offered by a provider. */
export interface ProviderModel {
  id: string;
  providerId: ProviderId;
  displayName: string;
  modality: Modality;

  /** What the model can actually do. Drives which controls the UI renders —
   *  the interface is derived from capability, never hard-coded per vendor. */
  capabilities: ModelCapabilities;

  /** Credits charged per generation. Resolved by our own pricing layer, not
   *  read from the vendor, so margin is ours to set. */
  creditCost: number;
}

export interface ModelCapabilities {
  supportsNegativePrompt: boolean;
  supportsImageInput: boolean;
  supportsSeed: boolean;
  /** Aspect ratios expressed as "16:9". Empty means arbitrary dimensions. */
  aspectRatios: readonly string[];
  maxOutputs: number;
  /** Absent for image models. */
  maxDurationSeconds?: number;
}

/** A generation request, in *our* vocabulary. Adapters translate this into
 *  whatever shape a vendor wants; callers never see the vendor's shape. */
export interface GenerationRequest {
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  seed?: number;
  outputs?: number;
  durationSeconds?: number;
  /** Source material for image-to-image and reference-driven generation. */
  inputAssetUrls?: readonly string[];
  /** Anything the model takes that the common shape does not express. Escape
   *  hatch, deliberately narrow — if a field appears here for three providers
   *  it belongs in the interface above instead. */
  providerOptions?: Record<string, unknown>;
}

export type JobState =
  "queued" | "running" | "succeeded" | "failed" | "canceled";

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

export interface GenerationOutput {
  /** Where the vendor is serving the result. Transient — we copy it into R2
   *  and never hand a vendor URL to a user, because it will expire. */
  sourceUrl: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  seed?: number;
}

/**
 * Normalised failure.
 *
 * Every vendor fails differently and describes it badly. Adapters map their
 * errors onto this so that retry logic, credit refunds and user-facing copy are
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
  | "unknown";

/**
 * What every adapter must implement.
 *
 * Generation is modelled as submit-then-poll rather than a single awaited call.
 * That is not over-engineering: image models take seconds, video models take
 * minutes, and a serverless function cannot hold a request open that long. One
 * shape for all modalities keeps the job pipeline, the UI and the credit ledger
 * from forking per media type.
 */
export interface AIProvider {
  readonly id: ProviderId;
  readonly displayName: string;

  /** Models this provider currently offers. */
  listModels(): Promise<readonly ProviderModel[]>;

  /** Submit work. Returns as soon as the vendor accepts it. */
  submit(request: GenerationRequest): Promise<GenerationJob>;

  /** Poll for progress. Must be safe to call repeatedly and concurrently. */
  poll(providerJobId: string): Promise<GenerationJob>;

  /** Best-effort cancellation. Not every vendor supports it; those that do not
   *  should resolve rather than throw, so callers need no special case. */
  cancel?(providerJobId: string): Promise<void>;
}
