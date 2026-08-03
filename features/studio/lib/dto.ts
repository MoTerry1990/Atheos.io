import type { ProviderModel } from "@/services/ai/types";
import type { StudioJob, StudioModel } from "@/features/studio/types";

/**
 * The boundary between database rows and what the client receives.
 *
 * Two jobs:
 *
 * 1. **Serialisation.** `Date` and `Decimal` do not survive JSON. Converting
 *    here means no component ever has to wonder what shape a timestamp is.
 *
 * 2. **Not over-sharing.** A Prisma `Generation` carries `providerJobId`,
 *    `parameters` and internal ids. None of that belongs in a browser: the
 *    provider job id is an identifier in a third party's system, and shipping
 *    it invites someone to try it there.
 *
 * The client type (`StudioJob`) is unchanged from Sprint 5. That is the point —
 * the studio was built against a contract, so replacing a local timer with a
 * real pipeline changed no component.
 */

/** Rows as the API returns them, before serialisation. */
interface GenerationRow {
  id: string;
  status: string;
  operation: string;
  model: string;
  prompt: string;
  negativePrompt: string | null;
  parameters: unknown;
  creditsCost: number;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
  assets?: {
    id: string;
    storageKey: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  }[];
}

const STATUS_MAP: Record<string, StudioJob["status"]> = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELED: "canceled",
};

export interface GenerationDTO {
  id: string;
  status: StudioJob["status"];
  operation: string;
  modelId: string;
  prompt: string;
  negativePrompt: string | null;
  creditCost: number;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
  /** Serialised request parameters, for "reuse settings". */
  parameters: Record<string, unknown> | null;
  outputs: {
    id: string;
    /** Object key, not a URL — the CDN hostname is an operational detail. */
    storageKey: string;
    /** Drives whether the preview mounts an image or a video element. It is
     *  the only reliable signal — a storage key's extension is ours to choose
     *  and a video model can return several container formats. */
    mimeType: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  }[];
}

export function toGenerationDTO(row: GenerationRow): GenerationDTO {
  return {
    id: row.id,
    status: STATUS_MAP[row.status] ?? "queued",
    operation: row.operation,
    modelId: row.model,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    creditCost: row.creditsCost,
    error: row.error,
    createdAt: row.createdAt.getTime(),
    completedAt: row.completedAt?.getTime() ?? null,
    parameters:
      row.parameters && typeof row.parameters === "object"
        ? (row.parameters as Record<string, unknown>)
        : null,
    outputs: (row.assets ?? []).map((asset) => ({
      id: asset.id,
      storageKey: asset.storageKey,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
    })),
    // Deliberately absent: providerJobId, userId, internal parameters.
  };
}

/**
 * Provider model → studio model.
 *
 * The studio needs display copy the provider contract has no business carrying
 * — a description, a rough duration, a badge. Those are product decisions, so
 * they are derived here rather than added to `ProviderModel` and forced on
 * every future adapter.
 */
export function toStudioModel(model: ProviderModel): StudioModel {
  const isUpscaler = model.capabilities.operations.includes("upscale");
  const isRemover = model.capabilities.operations.includes("remove-background");
  const isVideo = model.modality === "VIDEO";

  const durations = model.capabilities.durations ?? [];

  return {
    id: model.id,
    providerId: model.providerId,
    providerName: model.providerId,
    displayName: model.displayName,
    description: isUpscaler
      ? "Increases resolution while preserving detail. Takes an image, not a prompt."
      : isRemover
        ? "Cuts the subject out and returns a transparent background."
        : isVideo
          ? `${durations.join("s or ")}s clips${model.capabilities.supportsImageInput ? ", from a prompt or a still" : ""}`
          : `${model.capabilities.maxOutputs} output${model.capabilities.maxOutputs > 1 ? "s" : ""} per run · ${model.capabilities.supportsSeed ? "reproducible with a seed" : "no seed"}`,
    modality: model.modality,
    capabilities: model.capabilities,
    creditCost: model.creditCost,
    // A rough expectation so the interface can set one before committing
    // credits. Not a promise, and labelled as approximate everywhere it shows.
    //
    // Video is branched on modality rather than on price. The old rule — "over
    // 10 credits means slow" — put a 90-credit video model at 40 seconds, which
    // is off by minutes and would have every clip look overdue before it began.
    typicalSeconds: isVideo
      ? 150
      : isRemover
        ? 6
        : isUpscaler
          ? 12
          : model.creditCost > 10
            ? 40
            : 14,
  };
}
