import "server-only";

/**
 * Which models Atheos may run, for whom, and on whose evidence.
 *
 * ## Why a status is not a licence label
 *
 * The first version of this file had three verdicts and collapsed two
 * different questions into each one: *may we run this at all* and *who may we
 * run it for*. That produced a wrong answer in both directions.
 *
 * It marked FLUX.1 [dev] allowed without recording that the permission comes
 * from one hosted endpoint rather than from the model, so the approval would
 * have travelled to a self-hosted copy where it is false. And it marked three
 * proprietary video models `REVIEW_REQUIRED` — off, for everybody — on the
 * reasoning that their endpoints publish no open-source licence.
 *
 * That reasoning was wrong. A proprietary hosted API is not an open-weights
 * release with the licence file missing. The absence of an SPDX badge on
 * `google/veo-3.1` says nothing about whether Google permits commercial use
 * through a paid API; it says the model was never distributed as weights in
 * the first place. Treating silence as prohibition is as unfounded as treating
 * availability as permission, and it took a working product offline.
 *
 * So the vocabulary now separates the two questions:
 *
 *   `ALLOWED_PUBLIC`                        run it, sell it, list it
 *   `ALLOWED_PROVIDER_ENDPOINT_ONLY`        same, but the grant is pinned to
 *                                           one endpoint and does not travel
 *   `OWNER_EVALUATION_ONLY_PENDING_TERMS`   the owner may evaluate it; no
 *                                           customer may reach it and it is
 *                                           not sold, until written terms
 *                                           are recorded
 *   `BLOCKED_COMMERCIAL`                    nobody runs it, owner included
 *   `REVIEW_REQUIRED`                       unknown; fails closed
 *
 * ## What owner-evaluation is, and what it is not
 *
 * It is not a licence bypass, and must never be described as one. It is the
 * narrower claim that evaluating a paid API before deciding whether to build
 * on it is ordinary commercial diligence, whereas reselling access to it to
 * third parties is a distribution right that needs to be granted in writing.
 * The first is defensible on the evidence recorded below. The second is not
 * yet, so it does not happen.
 *
 * The distinction is enforced by `permittedAudience`, not by trust:
 * `BLOCKED_COMMERCIAL` ignores the caller entirely, so no amount of admin
 * makes MusicGen runnable.
 */

export type PolicyStatus =
  | "ALLOWED_PUBLIC"
  | "ALLOWED_PROVIDER_ENDPOINT_ONLY"
  | "OWNER_EVALUATION_ONLY_PENDING_TERMS"
  | "BLOCKED_COMMERCIAL"
  | "REVIEW_REQUIRED";

/**
 * Who may reach a model.
 *
 * `owner` means the server-verified admin, resolved by `isAdmin()` against the
 * session — never a header, a flag or anything the client can assert.
 */
export type Audience = "public" | "owner" | "nobody";

/** Who is asking. Callers resolve this from the session, not from input. */
export type Caller = "public" | "owner";

export interface ModelPolicy {
  /** Internal catalogue id — what `services/ai/registry.ts` calls it. */
  modelId: string;
  /** The exact hosted endpoint the record applies to. */
  hostedEndpoint: string;
  /** Version pinned at audit time, so a silent model swap is visible. */
  auditedVersion: string;
  /** The public id customers see. Kept here so the mapping is auditable. */
  publicId: string;
  publicName: string;

  status: PolicyStatus;
  /** The widest audience this status permits. */
  permittedAudience: Audience;
  /**
   * The only provider this record grants anything for.
   *
   * Separate from `status` on purpose. FLUX.1 [dev] is publicly sellable *and*
   * pinned to one endpoint; those are independent facts, and folding them into
   * a single label is what made the first version of this file wrong.
   */
  permittedProvider: string;

  /** May the customer use, sell or publish the output? */
  commercialOutput: "permitted" | "permitted-for-owner-evaluation" | "denied";
  licence: string;
  /**
   * Attribution, watermarking and provenance obligations.
   *
   * Not decorative. Veo output carries SynthID and C2PA content credentials,
   * and stripping them would breach the terms *and* remove a disclosure the
   * viewer is entitled to. Atheos stores provider bytes verbatim, so this is
   * a constraint on anything that ever re-encodes.
   */
  attribution: string;
  trademark: string;
  acceptableUse: string;

  /** Everything read to reach this status. Plural — one link is rarely enough. */
  evidenceUrls: readonly string[];
  /** ISO date the evidence was read. */
  verifiedOn: string;
  /** Why, for whoever revisits this. */
  notes: string;
}

/**
 * Audited 2026-08-25 against each hosted endpoint and the terms it links to.
 *
 * Versions are the ones live on that date. A version change does not
 * automatically invalidate a status, but it is recorded so a swap can be seen.
 */
export const MODEL_POLICIES: readonly ModelPolicy[] = [
  {
    modelId: "replicate/flux-schnell",
    hostedEndpoint: "replicate:black-forest-labs/flux-schnell",
    auditedVersion: "c846a699",
    publicId: "atheos-image-fast",
    publicName: "Atheos Image Fast",
    status: "ALLOWED_PUBLIC",
    permittedAudience: "public",
    permittedProvider: "replicate",
    commercialOutput: "permitted",
    licence: "Apache-2.0 (FLUX.1 [schnell])",
    attribution: "None required.",
    trademark: "Do not imply endorsement by Black Forest Labs.",
    acceptableUse: "BFL acceptable-use policy applies to generated content.",
    evidenceUrls: [
      "https://replicate.com/black-forest-labs/flux-schnell",
      "https://huggingface.co/black-forest-labs/FLUX.1-schnell",
    ],
    verifiedOn: "2026-08-25",
    notes:
      "Apache-2.0 on the weights themselves, so the permission does not depend on the host.",
  },
  {
    modelId: "replicate/flux-dev",
    hostedEndpoint: "replicate:black-forest-labs/flux-dev",
    auditedVersion: "6e4a938f",
    publicId: "atheos-image-realistic",
    publicName: "Atheos Image Realistic",
    status: "ALLOWED_PROVIDER_ENDPOINT_ONLY",
    permittedAudience: "public",
    permittedProvider: "replicate",
    commercialOutput: "permitted",
    licence:
      "FLUX.1 [dev] Non-Commercial for the weights; commercial output use granted through this hosted endpoint",
    attribution: "None required for output use through this endpoint.",
    trademark: "Do not imply endorsement by Black Forest Labs.",
    acceptableUse: "BFL acceptable-use policy applies to generated content.",
    evidenceUrls: [
      "https://replicate.com/black-forest-labs/flux-dev",
      "https://huggingface.co/black-forest-labs/FLUX.1-dev",
    ],
    verifiedOn: "2026-08-25",
    /**
     * The status carries the scope because the scope is the whole point.
     *
     * The downloadable weights are non-commercial. What is commercially
     * usable is output generated through this endpoint. Self-hosting the same
     * model, or running it at another provider, is a different question with
     * a different answer, and `permittedProvider` is what stops this record
     * from being read as covering either.
     */
    notes:
      "Approval is scoped to the Replicate endpoint. Do not extend it to self-hosting or another provider without a fresh review.",
  },
  {
    modelId: "replicate/real-esrgan",
    hostedEndpoint: "replicate:nightmareai/real-esrgan",
    auditedVersion: "b3ef1941",
    publicId: "atheos-upscale",
    publicName: "Atheos Upscale",
    status: "ALLOWED_PUBLIC",
    permittedAudience: "public",
    permittedProvider: "replicate",
    commercialOutput: "permitted",
    licence: "BSD-3-Clause",
    attribution: "BSD notice retained upstream; none required on output.",
    trademark: "None.",
    acceptableUse: "No field-of-use restriction.",
    evidenceUrls: [
      "https://replicate.com/nightmareai/real-esrgan",
      "https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE",
    ],
    verifiedOn: "2026-08-25",
    notes: "Permissive open source; nothing endpoint-specific.",
  },
  {
    modelId: "replicate/remove-bg",
    hostedEndpoint: "replicate:lucataco/remove-bg",
    auditedVersion: "95fcc2a2",
    publicId: "atheos-cutout",
    publicName: "Atheos Cutout",
    status: "ALLOWED_PUBLIC",
    permittedAudience: "public",
    permittedProvider: "replicate",
    commercialOutput: "permitted",
    licence: "Apache-2.0",
    attribution: "None required.",
    trademark: "None.",
    acceptableUse: "No field-of-use restriction.",
    evidenceUrls: ["https://replicate.com/lucataco/remove-bg"],
    verifiedOn: "2026-08-25",
    notes: "Permissive open source; nothing endpoint-specific.",
  },
  {
    modelId: "replicate/video-gen",
    hostedEndpoint: "replicate:wan-video/wan-2.2-t2v-fast",
    auditedVersion: "c483b1f7",
    publicId: "motion-1",
    publicName: "Motion 1",
    status: "ALLOWED_PUBLIC",
    permittedAudience: "public",
    permittedProvider: "replicate",
    commercialOutput: "permitted",
    licence: "Apache-2.0, inherited by the optimised build from Wan 2.2 A14B",
    attribution:
      "Apache-2.0 notice retained upstream; none required on output. Wan-AI state they claim no rights over generated content.",
    trademark: "Do not imply endorsement by Wan-AI or PrunaAI.",
    acceptableUse: "Apache-2.0 imposes no field-of-use restriction.",
    evidenceUrls: [
      "https://github.com/Wan-Video/Wan2.2",
      "https://huggingface.co/Wan-AI/Wan2.2-T2V-A14B",
      "https://replicate.com/wan-video/wan-2.2-t2v-fast",
    ],
    verifiedOn: "2026-08-25",
    /**
     * The endpoint publishes no licence of its own. Following it upstream
     * closes the question rather than leaving it open:
     *
     *   1. Wan-AI release Wan 2.2 under Apache-2.0 and state they claim no
     *      rights over generated content.
     *   2. PrunaAI, whose optimised build this endpoint serves, state that
     *      the base model's licensing terms remain applicable to the
     *      adaptation — so the derivative carries Apache-2.0 too.
     *
     * This is the one video model where the grant comes from the model rather
     * than from a hosting arrangement, which is why it is public and the
     * other three are not.
     */
    notes:
      "Open-weights Apache-2.0 upstream, expressly inherited by the optimised build. The grant follows the model, not the host.",
  },
  {
    modelId: "replicate/video-pro",
    hostedEndpoint: "replicate:bytedance/seedance-1-lite",
    auditedVersion: "6e47dd83",
    publicId: "motion-pro",
    publicName: "Motion Pro",
    status: "OWNER_EVALUATION_ONLY_PENDING_TERMS",
    permittedAudience: "owner",
    permittedProvider: "replicate",
    commercialOutput: "permitted-for-owner-evaluation",
    licence: "Proprietary (ByteDance), served through Replicate's terms.",
    attribution:
      "None stated. Preserve any provenance metadata the provider embeds.",
    trademark: "Do not imply endorsement by ByteDance.",
    acceptableUse:
      "Replicate's acceptable-use terms apply; no vendor policy published for this endpoint.",
    evidenceUrls: [
      "https://replicate.com/bytedance/seedance-1-lite",
      "https://replicate.com/terms",
    ],
    verifiedOn: "2026-08-25",
    /**
     * Replicate present this endpoint for commercial video production and
     * grant output rights *subject to third-party terms* — and no third-party
     * terms are published for it. That is genuinely ambiguous rather than
     * prohibitive, and the two halves of the ambiguity have different answers:
     *
     *   evaluating a paid API to decide whether to build on it — ordinary
     *   diligence, and what the endpoint is plainly offered for;
     *
     *   reselling generation access to customers for credits — a
     *   distribution right, which nothing on the record grants.
     *
     * So the owner may run it and no customer may. Written confirmation from
     * ByteDance or Replicate is what moves it to public, and the question is
     * drafted in `docs/LICENCE-EVIDENCE.md`.
     */
    notes:
      "Owner evaluation only, pending written commercial-SaaS confirmation. Not sold, not listed, not reachable by any customer.",
  },
  {
    modelId: "replicate/veo-3.1-fast",
    hostedEndpoint: "replicate:google/veo-3.1-fast",
    auditedVersion: "ba987ace",
    publicId: "cinematic-fast",
    publicName: "Cinematic Fast",
    status: "OWNER_EVALUATION_ONLY_PENDING_TERMS",
    permittedAudience: "owner",
    permittedProvider: "replicate",
    commercialOutput: "permitted-for-owner-evaluation",
    licence: "Proprietary (Google), served through Replicate's terms.",
    attribution:
      "Output carries SynthID watermarking and C2PA content credentials. These must survive storage and delivery intact.",
    trademark: "Do not imply endorsement by Google.",
    acceptableUse:
      "Google's generative-AI prohibited-use policy applies to generated content.",
    evidenceUrls: [
      "https://replicate.com/google/veo-3.1-fast",
      "https://ai.google.dev/gemini-api/terms",
      "https://replicate.com/terms",
    ],
    verifiedOn: "2026-08-25",
    /**
     * A proprietary hosted API, never released as weights — so there is no
     * open-source licence to be missing, and its absence proves nothing. What
     * the record does show is that Google do not claim ownership of generated
     * output and offer the model for professional creation.
     *
     * What is not established is the reseller position: whether serving it to
     * our customers for credits is permitted under Replicate's third-party
     * terms. Until that is in writing, the owner may evaluate and nobody else
     * may reach it.
     *
     * The watermark obligation is not conditional on any of that. SynthID and
     * the C2PA manifest are how a viewer can tell the video is synthetic, and
     * nothing in the pipeline may strip them.
     */
    notes:
      "Owner evaluation only, pending written reseller terms. Preserve SynthID and content credentials on every stored and delivered file.",
  },
  {
    modelId: "replicate/veo-3.1",
    hostedEndpoint: "replicate:google/veo-3.1",
    auditedVersion: "9c6ca0c2",
    publicId: "cinematic",
    publicName: "Cinematic",
    status: "OWNER_EVALUATION_ONLY_PENDING_TERMS",
    permittedAudience: "owner",
    permittedProvider: "replicate",
    commercialOutput: "permitted-for-owner-evaluation",
    licence: "Proprietary (Google), served through Replicate's terms.",
    attribution:
      "Output carries SynthID watermarking and C2PA content credentials. These must survive storage and delivery intact.",
    trademark: "Do not imply endorsement by Google.",
    acceptableUse:
      "Google's generative-AI prohibited-use policy applies to generated content.",
    evidenceUrls: [
      "https://replicate.com/google/veo-3.1",
      "https://ai.google.dev/gemini-api/terms",
      "https://replicate.com/terms",
    ],
    verifiedOn: "2026-08-25",
    notes:
      "Same position as Cinematic Fast; the two differ in price and speed, not in terms.",
  },
  {
    modelId: "replicate/music",
    hostedEndpoint: "replicate:meta/musicgen",
    auditedVersion: "671ac645",
    publicId: "score",
    publicName: "Score",
    status: "BLOCKED_COMMERCIAL",
    permittedAudience: "nobody",
    permittedProvider: "none",
    commercialOutput: "denied",
    licence: "CC-BY-NC-4.0 (MusicGen weights)",
    attribution: "Not applicable — the model does not run.",
    trademark: "Not applicable.",
    acceptableUse: "Not applicable.",
    evidenceUrls: [
      "https://replicate.com/meta/musicgen",
      "https://github.com/facebookresearch/audiocraft/blob/main/LICENSE_weights",
    ],
    verifiedOn: "2026-08-25",
    /**
     * The one unambiguous finding, and the only one that could not wait for a
     * review cycle. Score was live and sellable at 20 credits.
     *
     * `NC` is not silence to be interpreted — it is an express prohibition on
     * the exact thing Atheos was doing. There is no owner carve-out here:
     * running a non-commercial model inside a commercial product is
     * commercial use whoever presses the button, and a company testing its own
     * paid feature is not a hobbyist. `permittedAudience: "nobody"` is what
     * makes that structural rather than a matter of restraint.
     */
    notes:
      "Non-commercial weights. Blocked for everyone including the owner; no audience, no provider, no exceptions. Existing history and assets are preserved untouched.",
  },
  {
    modelId: "replicate/sfx",
    hostedEndpoint: "replicate:zsxkib/mmaudio",
    auditedVersion: "62871fb5",
    publicId: "foley",
    publicName: "Foley",
    status: "ALLOWED_PUBLIC",
    permittedAudience: "public",
    permittedProvider: "replicate",
    commercialOutput: "permitted",
    licence: "MIT (MMAudio)",
    attribution: "MIT notice retained upstream; none required on output.",
    trademark: "None.",
    acceptableUse: "No field-of-use restriction.",
    evidenceUrls: [
      "https://replicate.com/zsxkib/mmaudio",
      "https://github.com/hkchengrex/MMAudio/blob/main/LICENSE",
    ],
    verifiedOn: "2026-08-25",
    notes: "Permissive open source; nothing endpoint-specific.",
  },
];

const BY_MODEL_ID = new Map(
  MODEL_POLICIES.map((policy) => [policy.modelId, policy]),
);

/** The policy for a catalogue model, or undefined when none is recorded. */
export function policyFor(modelId: string): ModelPolicy | undefined {
  return BY_MODEL_ID.get(modelId);
}

/**
 * May this model run for this caller, right now?
 *
 * Fails closed on a missing policy. A model added without an entry is a model
 * nobody has checked, and the safe answer to "has anyone verified this" is no,
 * not "probably, it is in the catalogue".
 *
 * `caller` must be resolved from the session by the caller — `isAdmin()`, not
 * a request field. Nothing here validates it, because nothing here can.
 */
export function isRunnableFor(modelId: string, caller: Caller): boolean {
  const policy = policyFor(modelId);
  if (!policy) return false;

  switch (policy.status) {
    case "ALLOWED_PUBLIC":
    case "ALLOWED_PROVIDER_ENDPOINT_ONLY":
      return true;

    case "OWNER_EVALUATION_ONLY_PENDING_TERMS":
      return caller === "owner";

    /**
     * Listed rather than folded into a default, so that adding a status forces
     * a decision here instead of silently inheriting "no". The compiler is the
     * thing enforcing that, via the exhaustiveness check below.
     */
    case "BLOCKED_COMMERCIAL":
    case "REVIEW_REQUIRED":
      return false;
  }
}

/**
 * May this model appear in a customer-facing list?
 *
 * Never true for an owner-evaluation model, whatever the caller. A model the
 * owner is trialling must not appear in a catalogue, a price list or a picker,
 * because appearing there is what turns evaluation into an offer.
 */
export function isPubliclyOffered(modelId: string): boolean {
  return policyFor(modelId)?.permittedAudience === "public";
}

/**
 * May this model appear in the owner's own catalogue?
 *
 * Wider than `isPubliclyOffered` by exactly the owner-evaluation set, and no
 * wider — a blocked model is absent from every list there is.
 */
export function isOfferedToOwner(modelId: string): boolean {
  const audience = policyFor(modelId)?.permittedAudience;
  return audience === "public" || audience === "owner";
}

/**
 * The refusal a customer sees.
 *
 * Deliberately says nothing about which provider, which licence or why. The
 * reason is a commercial matter between Atheos and a vendor, and a customer
 * reading "CC-BY-NC" learns who we buy from.
 */
export const MODEL_UNAVAILABLE_MESSAGE = "That model is not available.";
export const MODEL_UNAVAILABLE_CODE = "model_unavailable";
