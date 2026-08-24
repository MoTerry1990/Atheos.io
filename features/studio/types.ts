import type { ModelCapabilities, ProviderId } from "@/services/ai/types";
import type { Modality } from "@/lib/generated/prisma/enums";
import type { SequenceMode } from "@/services/ai/sequence";

/**
 * Studio types.
 *
 * These describe what the **interface** manipulates. They deliberately sit one
 * layer above `services/ai/types.ts`, which describes what a *provider*
 * accepts — the studio holds things a provider never sees (which preset chip is
 * selected, whether the seed is locked) and omits things only the pipeline
 * needs (job handles, storage keys).
 *
 * The translation between the two happens in Sprint 6, in one place. Letting
 * the UI populate a provider request directly would put vendor concepts into
 * component props and break the seam the whole product is built on.
 */

/** A model the studio can offer. Mirrors `ProviderModel` plus display data. */
export interface StudioModel {
  id: string;
  providerId: ProviderId;
  providerName: string;
  displayName: string;
  description: string;
  modality: Modality;
  capabilities: ModelCapabilities;
  creditCost: number;
  /** Rough expectation, shown before committing credits. */
  typicalSeconds: number;
  badge?: "fastest" | "highest-quality" | "new";
}

export interface ReferenceImage {
  id: string;
  name: string;
  /** Object URL for preview. Revoked when removed — see the store. */
  url: string;
  sizeBytes: number;
  /** 0–1. How strongly the reference should influence the result. */
  strength: number;
  /**
   * Where the *provider* can fetch this image.
   *
   * Distinct from `url`, which is an object URL and means nothing outside this
   * tab. Populated once the upload to our storage completes; until then the
   * reference exists but cannot be submitted, which is what `status` is for.
   */
  remoteUrl?: string;
  status: "uploading" | "ready" | "failed";
  /** Why the upload failed, ready to show. Null while it has not. */
  error?: string;
}

/** Camera language, appended to the prompt at submit time. */
export interface CameraSettings {
  shot: string | null;
  angle: string | null;
  lens: string | null;
  lighting: string | null;
}

/**
 * Everything the composer controls.
 *
 * Flat on purpose. Nested params make the store's partial updates awkward and
 * turn every setter into a spread-of-a-spread.
 */
export interface StudioParams {
  modelId: string;
  prompt: string;
  negativePrompt: string;
  /** Preset ids, not resolved text — resolution happens at submit. */
  presetIds: string[];
  camera: CameraSettings;
  aspectRatio: string;
  /** Longest edge in pixels. The other edge follows the aspect ratio. */
  resolution: number;
  /**
   * 0–1, shown as "Creativity". Maps to guidance scale, inverted: providers
   * express this as "how strictly to follow the prompt", which is the opposite
   * of how people think about it.
   */
  creativity: number;
  seed: number | null;
  /** When true the seed survives a generation, for controlled iteration. */
  seedLocked: boolean;
  outputs: number;
  references: ReferenceImage[];
  /** Clip length in seconds. Ignored by image models. */
  durationSeconds: number;
  /**
   * How the camera moves, from the model's declared vocabulary.
   *
   * Null means "no instruction" rather than "hold still" — the model has its
   * own idea of how a shot should move, and overriding it with "static camera"
   * by default would quietly make every clip worse.
   */
  cameraMotion: string | null;
  /**
   * One continuous clip, or a shot sequence.
   *
   * A param rather than local component state because it changes the price: a
   * four-shot sequence is four provider calls and four times the credits. The
   * generate button and the plan panel reading two different copies of this is
   * exactly how "Generate · 90 credits" ended up over a four-shot plan that 90
   * credits could not buy.
   */
  sequenceMode: SequenceMode;
}

export type JobStatus =
  "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface JobOutput {
  id: string;
  /**
   * Public URL for the stored asset, resolved from its object key in
   * `lib/job-mapper`. Empty only while storage is unconfigured.
   */
  url?: string;
  /**
   * What was actually stored.
   *
   * The preview branches on this rather than on the job's modality: a video
   * model can return a poster frame, and the mock returns an SVG for a clip.
   * Mounting a `<video>` over a file that is not one gives a black box with a
   * broken control bar, so the file's own type is the only safe signal.
   */
  mimeType: string;
  /** Clip length for video outputs, null for stills. */
  durationMs: number | null;
  /** Fallback tint, shown while the image loads or if the CDN is unreachable. */
  hue: number;
  seed: number;
  width: number;
  height: number;
}

export interface StudioJob {
  id: string;
  status: JobStatus;
  /** Snapshot of the params used. Editing the composer must not rewrite history. */
  params: StudioParams;
  modelName: string;
  creditCost: number;
  /** 0–1 where known, null where the provider would not report it. */
  progress: number | null;
  outputs: JobOutput[];
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface PromptTemplate {
  id: string;
  name: string;
  category: string;
  prompt: string;
  negativePrompt?: string;
  presetIds?: string[];
}

export interface StylePreset {
  id: string;
  name: string;
  /** Appended to the prompt. Kept visible so nothing is added behind the user's back. */
  fragment: string;
  hue: number;
}
