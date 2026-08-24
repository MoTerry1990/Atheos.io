import { ApiError, request } from "@/lib/http";
import type { CreativeBrief } from "@/services/ai/creative-brief";
import type { ImageBrief } from "@/services/ai/image-brief";

/**
 * The studio's client for `/api/creative/plan`.
 *
 * ## The brief travels whole and unmodified
 *
 * The signed token carries `stableHash(brief)`, so the object that comes back
 * from planning is the object that must go back up at submission — byte for
 * byte after JSON, not a reconstruction. Nothing in the studio may edit it:
 * changing a value means asking the server to plan again, which issues a new
 * token for the brief that actually resulted.
 *
 * That is the whole point. The old path let the browser assemble what it liked
 * and the server believed it.
 */

export type PlanClarification = {
  field: string;
  question: string;
  options: { label: string; value: unknown; recommended?: boolean }[];
};

export type PlanAlternative = {
  modelId: string;
  label: string;
  compatibility: "compatible" | "partial" | "incompatible";
  conflicts: string[];
  caveats: string[];
  credits: number;
  estimatedSeconds: number;
  maxDurationSeconds: number;
  maxResolution: string;
};

export interface CreativePlanResponse {
  /**
   * The whole brief, of whichever kind was planned.
   *
   * A union rather than two response types: the confirmation panel renders both
   * and a second response shape would be a second panel to keep honest. The
   * `kind` discriminant is what tells them apart, and it is inside the hash the
   * token signs, so an image plan cannot be submitted as a video one.
   */
  brief: CreativeBrief | ImageBrief;
  assumptions: { field: string; value: unknown; because: string }[];
  clarifications: PlanClarification[];
  conflicts: string[];
  caveats: string[];
  alternatives: PlanAlternative[];
  recommendedModelId: string | null;
  blockingRequirements: string[];
  quote: { credits: number; estimatedSeconds: number } | null;
  /** For the user's eyes. The server recompiles at submission. */
  finalPromptPreview: {
    modelId: string;
    compilerVersion: number;
    prompt: string;
    negativePrompt: string;
    omitted: string[];
  } | null;
  confirmationRequired: boolean;
  /** Absent while anything is unresolved. */
  planToken: string | null;
  expiresAtMs: number | null;
  ttlSeconds: number;
}

export interface PlanRequest {
  prompt: string;
  /** Defaults to video, as the endpoint does. */
  modality?: "video" | "image";
  modelId?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  resolution?: string;
  referenceIds?: string[];
  answers?: Record<string, unknown>;
}

/**
 * Ask the server what it understood.
 *
 * Resolves to `null` when the Director is disabled — the endpoint answers 404
 * rather than 403 so that a disabled feature does not confirm its own
 * existence, and the caller falls through to the existing direct path. Every
 * other failure throws, because a planning error the user cannot see is a
 * planning error they will discover as a wrong video.
 */
export async function planCreation(
  input: PlanRequest,
  signal?: AbortSignal,
): Promise<CreativePlanResponse | null> {
  try {
    return await request<CreativePlanResponse>("/api/creative/plan", {
      method: "POST",
      body: JSON.stringify({ modality: "video", ...input }),
      signal,
    });
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return null;
    throw cause;
  }
}

export type AnimateSource =
  | {
      status: "resolved";
      assetId: string;
      width: number | null;
      height: number | null;
      parentGenerationId: string | null;
    }
  | {
      status: "choose";
      candidates: {
        assetId: string;
        label: string;
        width: number | null;
        height: number | null;
        createdAt: number;
        generationId: string | null;
      }[];
    }
  | { status: "none"; reason: string };

/**
 * Ask the server which image "animate this" means.
 *
 * Takes an id or nothing, and never a URL. Returns `null` when the Director is
 * disabled, so the caller falls through rather than showing a broken action.
 *
 * Note what is *not* in the response: a fetchable link. The browser needs to
 * know that an image resolved and what shape it is; it does not need a signed
 * URL, and submission re-resolves from the id anyway.
 */
export async function resolveAnimateSource(
  input: { assetId?: string; collectionId?: string } = {},
): Promise<AnimateSource | null> {
  try {
    return await request<AnimateSource>("/api/creative/animate-source", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return null;
    throw cause;
  }
}
