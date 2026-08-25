import "server-only";

import { MODEL_CAPABILITIES, assessModel } from "@/services/ai/brief-routing";
import { compileForModel } from "@/services/ai/compile-for-model";
import type { CreativeBrief } from "@/services/ai/creative-brief";
import { compileImageForModel } from "@/services/ai/compile-image";
import type { ImageBrief } from "@/services/ai/image-brief";
import { findImageModel } from "@/services/ai/image-capabilities";
import { assessImageModel } from "@/services/ai/image-routing";
import { generationIdForPlan } from "@/services/ai/plan-consumption";
import {
  creativeDirectorReady,
  verifyPlanToken,
} from "@/services/ai/plan-token";

/**
 * The gate between a confirmed plan and the provider.
 *
 * ## What it replaces
 *
 * `studio-workspace.tsx:283` sent `assemblePrompt(params, installedStyles)` —
 * a string built in the browser — straight through `submitGeneration` to the
 * adapter. The shot plan the composer displayed reached nothing.
 *
 * With the Director on, the browser sends a signed token and the brief it
 * confirmed. The server re-verifies both, recompiles from the brief, and
 * **overrides** whatever prompt the client supplied. A client-built prompt has
 * no route to a provider any more.
 *
 * ## Fail closed, in both directions
 *
 * Flag on and no token → refused, so the old request shape cannot be used to
 * bypass planning. Flag off → this returns `null` and the existing path runs
 * untouched, which is what keeps the change safe to land disabled.
 */

export interface DirectorOverrides {
  /** Deterministic, so a replay collides on the primary key. */
  generationId: string;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  /** "1K" | "2K" | "4K" for models that size by class. Images only. */
  imageResolution?: string;
  /**
   * The video resolution the compiler chose, e.g. `1080p`.
   *
   * Carried explicitly because it was previously computed and then dropped:
   * `compileVeo` set `parameters.resolution` from the confirmed brief, nothing
   * forwarded it, and the adapter's `request.videoResolution === "1080p"` was
   * therefore never true. Every Veo render came back 720p however it was
   * requested — a capability the studio offered and silently did not deliver.
   */
  videoResolution?: string;
  /** Server-resolved reference URLs. Never anything the client named. */
  inputImageUrls?: string[];
  quotedCredits: number;
  compilerVersion: number;
  /**
   * Sanitised, for the generation's audit metadata.
   *
   * Narrowed to JSON primitives rather than `unknown` so it satisfies Prisma's
   * `InputJsonValue` — and so nothing that is not plainly serialisable, like a
   * Date or a class instance, can be written into an audit record by accident.
   */
  planMetadata: Record<string, string | number | boolean | null | string[]>;
}

export class DirectorError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "DirectorError";
  }
}

export interface DirectorSubmitInput {
  userId: string;
  planToken?: string;
  brief?: CreativeBrief | ImageBrief;
  confirmed?: boolean;
  clientIdempotencyKey?: string;
  nowMs?: number;
  /**
   * Reference URLs the *server* resolved from owned asset ids.
   *
   * Passed in rather than resolved here so this module stays synchronous and
   * free of database access — `resolveAnimationSource` owns the ownership
   * check, and its output arrives here already proven.
   */
  referenceUrls?: readonly string[];
}

/**
 * Resolve a submission through the Director, or decline to.
 *
 * Returns `null` when the feature is off — the caller then runs its existing
 * path. Throws when the feature is on and the request is not a valid confirmed
 * plan, because that is a request that must not reach a provider.
 */
export function resolveDirectorSubmission(
  input: DirectorSubmitInput,
): DirectorOverrides | null {
  if (!creativeDirectorReady().ready) return null;

  /**
   * The bypass check. With the Director on, a request carrying a prompt and no
   * plan is the old shape — and the old shape is what let a four-shot request
   * reach a single-take model.
   */
  if (!input.planToken) {
    throw new DirectorError(
      "This generation needs a confirmed plan. Plan your creation first.",
      400,
      "plan_required",
    );
  }
  if (!input.brief) {
    throw new DirectorError(
      "The confirmed plan is missing its brief.",
      400,
      "brief_required",
    );
  }
  if (!input.confirmed) {
    throw new DirectorError(
      "This plan has not been confirmed.",
      400,
      "not_confirmed",
    );
  }

  const verified = verifyPlanToken({
    token: input.planToken,
    userId: input.userId,
    brief: input.brief,
    nowMs: input.nowMs ?? Date.now(),
  });

  if (!verified.ok || !verified.payload) {
    // One message for every rejection reason. Telling a caller *which* check
    // failed tells them what to change next.
    throw new DirectorError(
      "This plan is no longer valid. Plan your creation again.",
      403,
      `plan_${verified.reason ?? "invalid"}`,
    );
  }

  const payload = verified.payload;

  /**
   * Images take the same route with a different catalogue.
   *
   * Everything above this line — the token, the hash, the confirmation, the
   * replay id — is modality-agnostic and stays shared. What differs below is
   * only which capability table judges the plan and which compiler builds the
   * prompt, and that is the whole difference between a still and a clip.
   */
  if (isImageBrief(input.brief)) {
    return resolveImagePlan(input, input.brief, payload);
  }

  const model = MODEL_CAPABILITIES.find((m) => m.id === payload.modelId);
  if (!model) {
    throw new DirectorError(
      "That model is no longer available.",
      400,
      "unknown_model",
    );
  }

  /**
   * Capabilities are re-checked, not trusted from the token.
   *
   * The token proves the plan was confirmed under a given capability version;
   * the version check in `verifyPlanToken` catches a stale table. This catches
   * the rest — and it is cheap, so there is no reason to skip it.
   */
  const verdict = assessModel(input.brief, model);
  if (verdict.compatibility === "incompatible") {
    throw new DirectorError(
      `That model cannot make this plan: ${verdict.conflicts.join("; ")}`,
      400,
      "capability_conflict",
    );
  }

  const compiled = compileForModel(input.brief, model);

  /**
   * The quote is recalculated from the capability table, and the token's number
   * has to match. A token is signed, so it cannot be edited — but a capability
   * table edited between planning and submission would move the price under a
   * confirmation the user already gave.
   */
  if (verdict.credits !== payload.quotedCredits) {
    throw new DirectorError(
      "The price of this plan has changed. Plan your creation again.",
      409,
      "quote_changed",
    );
  }

  return {
    generationId: generationIdForPlan(input.planToken),
    modelId: model.id,
    prompt: compiled.prompt,
    negativePrompt: compiled.negativePrompt || undefined,
    durationSeconds:
      typeof compiled.parameters.duration === "number"
        ? compiled.parameters.duration
        : input.brief.durationSeconds.value,
    aspectRatio: input.brief.aspectRatio.value,
    videoResolution:
      typeof compiled.parameters.resolution === "string"
        ? compiled.parameters.resolution
        : undefined,
    quotedCredits: verdict.credits,
    compilerVersion: compiled.compilerVersion,
    // Enough to explain a generation later; no URLs, no payloads, no secrets.
    planMetadata: {
      briefVersion: payload.briefVersion,
      originalPromptHash: payload.originalPromptHash,
      briefHash: payload.briefHash,
      capabilityVersion: payload.capabilityVersion,
      compilerVersion: compiled.compilerVersion,
      audioStrategy: payload.audioStrategy,
      shotCount: input.brief.shotCount.value,
      omitted: compiled.omitted,
      clientIdempotencyKey: input.clientIdempotencyKey ?? null,
    },
  };
}

/**
 * A brief is an image brief when it says so.
 *
 * A discriminant rather than duck-typing on a field: two briefs that happen to
 * share `aspectRatio` are not interchangeable, and structural guessing is how a
 * video plan would end up compiled for a still.
 */
function isImageBrief(brief: CreativeBrief | ImageBrief): brief is ImageBrief {
  return (brief as ImageBrief).kind === "image";
}

/**
 * The image half of the gate.
 *
 * Same three guarantees as the video path: capabilities re-checked rather than
 * trusted from the token, the prompt recompiled server-side rather than taken
 * from the client, and the quote recalculated so a capability-table edit between
 * planning and submission cannot move the price under a confirmation the user
 * already gave.
 */
function resolveImagePlan(
  input: DirectorSubmitInput,
  brief: ImageBrief,
  payload: {
    modelId: string;
    quotedCredits: number;
    briefVersion: number;
    briefHash: string;
    originalPromptHash: string;
    capabilityVersion: number;
  },
): DirectorOverrides {
  const model = findImageModel(payload.modelId);
  if (!model) {
    throw new DirectorError(
      "That model is no longer available.",
      400,
      "unknown_model",
    );
  }

  const verdict = assessImageModel(brief, model);
  if (verdict.compatibility === "incompatible") {
    throw new DirectorError(
      `That model cannot make this plan: ${verdict.conflicts.join("; ")}`,
      400,
      "capability_conflict",
    );
  }

  if (verdict.credits === null) {
    // An unpriced model cannot be run. Rule 1 of the cost doctrine, enforced at
    // the last point before money moves rather than only in the catalogue.
    throw new DirectorError(
      "That model has no price and cannot be run.",
      400,
      "unpriced_model",
    );
  }

  if (verdict.credits !== payload.quotedCredits) {
    throw new DirectorError(
      "The price of this plan has changed. Plan your creation again.",
      409,
      "quote_changed",
    );
  }

  const compiled = compileImageForModel({
    brief,
    model,
    referenceUrls: input.referenceUrls ?? [],
  });

  return {
    generationId: generationIdForPlan(input.planToken!),
    modelId: model.id,
    prompt: compiled.prompt,
    // None of the audited image models has a negative-prompt input; the
    // compiler folds exclusions into the prompt instead.
    negativePrompt: undefined,
    aspectRatio: String(
      compiled.parameters.aspect_ratio ?? brief.aspectRatio.value,
    ),
    imageResolution: String(
      compiled.parameters.resolution ?? verdict.effectiveResolution,
    ),
    inputImageUrls: [...(input.referenceUrls ?? [])],
    quotedCredits: verdict.credits,
    compilerVersion: compiled.compilerVersion,
    planMetadata: {
      modality: "image",
      briefVersion: payload.briefVersion,
      originalPromptHash: payload.originalPromptHash,
      briefHash: payload.briefHash,
      capabilityVersion: payload.capabilityVersion,
      compilerVersion: compiled.compilerVersion,
      resolution: verdict.effectiveResolution,
      aspectRatio: brief.aspectRatio.value,
      // A count, never the URLs — those are signed and short-lived, and an
      // audit record outlives them.
      referenceCount: input.referenceUrls?.length ?? 0,
      omitted: compiled.omitted,
      clientIdempotencyKey: input.clientIdempotencyKey ?? null,
    },
  };
}
