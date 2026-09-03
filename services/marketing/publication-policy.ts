import "server-only";

import { MODEL_POLICIES } from "@/services/ai/model-policy";

/**
 * Which models' output may be published on a public page.
 *
 * ## Why this exists separately from `model-policy.ts`
 *
 * That registry answers "may a customer generate with this model". This one
 * answers a different and stricter question: "may output from this model be
 * put on atheos.io, where it is marketing, indefinitely, to everyone".
 *
 * The two came apart badly. Sprint 29 published 18 gallery images from
 * `nano-banana-pro` — a model with **no entry in the registry at all** — and 7
 * videos from models marked `OWNER_EVALUATION_ONLY_PENDING_TERMS`. Nothing
 * stopped it, because nothing was checking: the generation path enforces
 * policy, and the marketing manifest was hand-assembled from files on disk and
 * never went near it.
 *
 * ## Fail closed, and mean it
 *
 * A model with no policy entry is not "unknown", it is **not approved**. That
 * is the whole point of a fail-closed registry, and treating a missing entry as
 * permission is how 18 images shipped. `isPublishable` returns false for
 * anything it does not positively recognise, including a model id that is
 * misspelled, renamed, or invented by a forged manifest entry.
 *
 * ## What counts as approved
 *
 * Only two statuses. `ALLOWED_PUBLIC` is unrestricted.
 * `ALLOWED_PROVIDER_ENDPOINT_ONLY` is permitted *because* publication uses the
 * same hosted endpoint the approval was scoped to — `flux-dev` is the case:
 * non-commercial weights, commercial output through Replicate's endpoint.
 *
 * Everything else is refused, and `OWNER_EVALUATION_ONLY_PENDING_TERMS` is
 * refused deliberately: evaluating a model privately is not the same permission
 * as publishing its output as advertising, and the terms are, by that status's
 * own name, still pending.
 */

const PUBLISHABLE_STATUSES = new Set([
  "ALLOWED_PUBLIC",
  "ALLOWED_PROVIDER_ENDPOINT_ONLY",
]);

export interface PublicationVerdict {
  publishable: boolean;
  /** The recorded status, or `null` when the model is not in the registry. */
  status: string | null;
  reason: string;
}

/**
 * Whether output from this model may appear on a public marketing surface.
 *
 * Takes the model id as an untrusted string: a manifest entry is data on disk
 * and a forged one would name whatever it liked.
 */
export function publicationVerdict(modelId: unknown): PublicationVerdict {
  if (typeof modelId !== "string" || modelId.trim() === "") {
    return {
      publishable: false,
      status: null,
      reason: "No originating model recorded.",
    };
  }

  const policy = MODEL_POLICIES.find((entry) => entry.modelId === modelId);
  if (!policy) {
    return {
      publishable: false,
      status: null,
      reason: `${modelId} has no entry in model-policy.ts, so it is not approved.`,
    };
  }

  if (!PUBLISHABLE_STATUSES.has(policy.status)) {
    return {
      publishable: false,
      status: policy.status,
      reason: `${modelId} is ${policy.status}, which does not permit public publication.`,
    };
  }

  if (policy.commercialOutput !== "permitted") {
    return {
      publishable: false,
      status: policy.status,
      reason: `${modelId} records commercialOutput "${policy.commercialOutput}".`,
    };
  }

  return {
    publishable: true,
    status: policy.status,
    reason: `${modelId} is ${policy.status} with commercial output permitted.`,
  };
}

export function isPublishable(modelId: unknown): boolean {
  return publicationVerdict(modelId).publishable;
}

/** Every model whose output may currently be published. */
export function publishableModelIds(): string[] {
  return MODEL_POLICIES.filter((entry) => isPublishable(entry.modelId))
    .map((entry) => entry.modelId)
    .sort();
}

/**
 * Which model produced each showcase tab's media.
 *
 * Hand-written rather than generated, because the three showcase assets are
 * chosen by hand rather than built from a selection file. It lives here, on the
 * server, for the same reason the gallery's provenance does: `content.ts` is
 * imported by client components, and putting a provider id in it ships that id
 * to the browser. `tests/unit/bundle-boundary.test.ts` caught exactly that when
 * this was tried the other way round.
 */
export const SHOWCASE_SOURCE_MODELS: Readonly<Record<string, string>> = {
  image: "replicate/flux-dev",
  video: "replicate/video-gen",
  audio: "replicate/sfx",
};
