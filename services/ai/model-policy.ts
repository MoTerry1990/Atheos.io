import "server-only";

/**
 * Whether Atheos may sell each model's output, and on what evidence.
 *
 * ## One registry, enforced on the server
 *
 * Every gate — quote, reservation, generation row, provider submission — reads
 * this. A second list in a route handler or a component would drift, and the
 * drift would be discovered by selling something we are not licensed to sell.
 *
 * ## Availability is not permission
 *
 * A provider hosting a model and charging for it proves that *they* will run
 * it. It says nothing about whether the person paying may sell the output. The
 * two are separate grants and this file keeps them separate: `hostedEndpoint`
 * records where the permission was verified, and an approval never travels to
 * a different endpoint or to self-hosted weights.
 *
 * ## Why the verdicts are conservative
 *
 * `REVIEW_REQUIRED` is the default for anything without published terms, not
 * `ALLOWED`. A missing licence page is an absence of evidence, and treating it
 * as permission is how a product ends up selling output it cannot defend.
 */

export type PolicyVerdict = "ALLOWED" | "BLOCKED" | "REVIEW_REQUIRED";

export interface ModelPolicy {
  /** Internal catalogue id. */
  modelId: string;
  /** The public id customers see. Kept here so the mapping is auditable. */
  publicId: string;
  publicName: string;
  /**
   * The exact hosted endpoint the verdict applies to.
   *
   * An approval is scoped to this string. FLUX.1 [dev] is commercially usable
   * *through Replicate's hosted endpoint* and is **not** commercially licensed
   * as downloadable weights — so a verdict that travelled with the model name
   * rather than the endpoint would be wrong the moment anything self-hosted it.
   */
  hostedEndpoint: string;
  /** Version pinned at audit time, so a silent model swap is visible. */
  auditedVersion: string;
  licence: string;
  /** May Atheos run this as a paid SaaS? */
  commercialSaasUse: boolean;
  /** May the customer sell or commercially use the output? */
  outputsSellable: boolean;
  attribution: string;
  /** Restrictions on using the vendor's name or marks. */
  trademark: string;
  acceptableUse: string;
  evidenceUrl: string;
  /** ISO date the evidence was read. */
  verifiedOn: string;
  verdict: PolicyVerdict;
  /** Why, in one line, for the audit trail. */
  reason: string;
}

/**
 * Audited 2026-08-25 against Replicate's model API and the linked licences.
 *
 * Versions are the ones live on that date. A version change does not
 * automatically invalidate a verdict, but it is recorded so a swap can be seen.
 */
export const MODEL_POLICIES: readonly ModelPolicy[] = [
  {
    modelId: "replicate/flux-schnell",
    publicId: "atheos-image-fast",
    publicName: "Atheos Image Fast",
    hostedEndpoint: "replicate:black-forest-labs/flux-schnell",
    auditedVersion: "c846a699",
    licence: "Apache-2.0 (FLUX.1 [schnell])",
    commercialSaasUse: true,
    outputsSellable: true,
    attribution: "None required by the licence.",
    trademark: "Do not imply endorsement by Black Forest Labs.",
    acceptableUse: "BFL acceptable-use policy applies to generated content.",
    evidenceUrl:
      "https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-schnell",
    verifiedOn: "2026-08-25",
    verdict: "ALLOWED",
    reason: "Apache-2.0 permits commercial use of the model and its outputs.",
  },
  {
    modelId: "replicate/flux-dev",
    publicId: "atheos-image-realistic",
    publicName: "Atheos Image Realistic",
    hostedEndpoint: "replicate:black-forest-labs/flux-dev",
    auditedVersion: "6e4a938f",
    licence:
      "FLUX.1 [dev] Non-Commercial for weights; commercial output use granted for this hosted endpoint",
    commercialSaasUse: true,
    outputsSellable: true,
    attribution: "None required for output use through this endpoint.",
    trademark: "Do not imply endorsement by Black Forest Labs.",
    acceptableUse: "BFL acceptable-use policy applies to generated content.",
    evidenceUrl: "https://replicate.com/black-forest-labs/flux-dev",
    verifiedOn: "2026-08-25",
    verdict: "ALLOWED",
    /**
     * The correction. The earlier audit read only the weights licence — which
     * is genuinely non-commercial — and concluded the model could not be sold.
     * That missed the hosted grant: Replicate's page for this endpoint states
     * images generated there may be used commercially.
     *
     * Scoped to `hostedEndpoint` deliberately. The downloadable weights remain
     * non-commercial, and nothing here may be read as licensing those.
     */
    reason:
      "Commercial output use permitted through this Replicate endpoint only; the downloadable weights remain non-commercial.",
  },
  {
    modelId: "replicate/real-esrgan",
    publicId: "atheos-upscale",
    publicName: "Atheos Upscale",
    hostedEndpoint: "replicate:nightmareai/real-esrgan",
    auditedVersion: "b3ef1941",
    licence: "BSD-3-Clause",
    commercialSaasUse: true,
    outputsSellable: true,
    attribution: "Copyright notice retained in our third-party notices.",
    trademark: "None asserted.",
    acceptableUse: "No model-specific restriction.",
    evidenceUrl:
      "https://github.com/NightmareAI/Real-ESRGAN/blob/master/LICENSE",
    verifiedOn: "2026-08-25",
    verdict: "ALLOWED",
    reason: "BSD-3-Clause permits commercial use with attribution retained.",
  },
  {
    modelId: "replicate/remove-bg",
    publicId: "atheos-cutout",
    publicName: "Atheos Cutout",
    hostedEndpoint: "replicate:lucataco/remove-bg",
    auditedVersion: "95fcc2a2",
    licence: "Apache-2.0",
    commercialSaasUse: true,
    outputsSellable: true,
    attribution: "None required.",
    trademark: "None asserted.",
    acceptableUse: "No model-specific restriction.",
    evidenceUrl:
      "https://huggingface.co/datasets/choosealicense/licenses/blob/main/markdown/apache-2.0.md",
    verifiedOn: "2026-08-25",
    verdict: "ALLOWED",
    reason: "Apache-2.0 permits commercial use.",
  },
  {
    modelId: "replicate/video-gen",
    publicId: "motion-1",
    publicName: "Motion 1",
    hostedEndpoint: "replicate:wan-video/wan-2.2-t2v-fast",
    auditedVersion: "c483b1f7",
    licence: "Not published on the endpoint. Wan 2.2 upstream is Apache-2.0.",
    /**
     * False because unverified, not because it is known to be forbidden.
     *
     * These two flags record what has been *confirmed*, and the upstream
     * project being permissively licensed is not confirmation that the hosted
     * endpoint passes that permission on. Marking them true on a guess would
     * make the table read like a rubber stamp for every model nobody checked.
     */
    commercialSaasUse: false,
    outputsSellable: false,
    attribution: "Unconfirmed — see reason.",
    trademark: "Do not imply endorsement.",
    acceptableUse: "Unconfirmed.",
    evidenceUrl: "https://replicate.com/wan-video/wan-2.2-t2v-fast",
    verifiedOn: "2026-08-25",
    /**
     * Live and already sold, with no licence published on the endpoint.
     *
     * `REVIEW_REQUIRED` rather than `BLOCKED`: nothing here is evidence of a
     * restriction, only an absence of evidence of permission, and the upstream
     * project is permissively licensed. The distinction is for whoever
     * finishes the review — it changes nothing operationally, because a review
     * verdict does not run either.
     */
    verdict: "REVIEW_REQUIRED",
    reason:
      "No licence published on the hosted endpoint. Upstream Wan 2.2 is Apache-2.0, but the hosted terms are unverified.",
  },
  {
    modelId: "replicate/video-pro",
    publicId: "motion-pro",
    publicName: "Motion Pro",
    hostedEndpoint: "replicate:bytedance/seedance-1-lite",
    auditedVersion: "6e47dd83",
    licence: "Not published on the endpoint.",
    commercialSaasUse: false,
    outputsSellable: false,
    attribution: "Unconfirmed.",
    trademark: "Do not imply endorsement by ByteDance.",
    acceptableUse: "Unconfirmed.",
    evidenceUrl: "https://replicate.com/bytedance/seedance-1-lite",
    verifiedOn: "2026-08-25",
    verdict: "REVIEW_REQUIRED",
    reason:
      "No licence published on the hosted endpoint and no upstream open licence identified.",
  },
  {
    modelId: "replicate/veo-3.1-fast",
    publicId: "cinematic-fast",
    publicName: "Cinematic Fast",
    hostedEndpoint: "replicate:google/veo-3.1-fast",
    auditedVersion: "ba987ace",
    licence: "Proprietary (Google), served via Replicate's terms.",
    commercialSaasUse: false,
    outputsSellable: false,
    attribution: "Unconfirmed.",
    trademark: "Do not use Google or Veo marks in customer-facing copy.",
    acceptableUse: "Google's generative-AI prohibited-use policy applies.",
    evidenceUrl: "https://replicate.com/google/veo-3.1-fast",
    verifiedOn: "2026-08-25",
    verdict: "REVIEW_REQUIRED",
    reason:
      "Proprietary model with no published licence on the endpoint. Not publicly enabled; used only for owner benchmarks.",
  },
  {
    modelId: "replicate/veo-3.1",
    publicId: "cinematic",
    publicName: "Cinematic",
    hostedEndpoint: "replicate:google/veo-3.1",
    auditedVersion: "9c6ca0c2",
    licence: "Proprietary (Google), served via Replicate's terms.",
    commercialSaasUse: false,
    outputsSellable: false,
    attribution: "Unconfirmed.",
    trademark: "Do not use Google or Veo marks in customer-facing copy.",
    acceptableUse: "Google's generative-AI prohibited-use policy applies.",
    evidenceUrl: "https://replicate.com/google/veo-3.1",
    verifiedOn: "2026-08-25",
    verdict: "REVIEW_REQUIRED",
    reason: "Same as Cinematic Fast. Not publicly enabled.",
  },
  {
    modelId: "replicate/music",
    publicId: "score",
    publicName: "Score",
    hostedEndpoint: "replicate:meta/musicgen",
    auditedVersion: "671ac645",
    licence: "CC-BY-NC-4.0 (MusicGen weights)",
    commercialSaasUse: false,
    outputsSellable: false,
    attribution: "Would require attribution to Meta even if permitted.",
    trademark: "Do not imply endorsement by Meta.",
    acceptableUse: "Non-commercial only.",
    evidenceUrl:
      "https://github.com/facebookresearch/audiocraft/blob/main/LICENSE_weights",
    verifiedOn: "2026-08-25",
    /**
     * Blocked, and it was live and sold at 20 credits when this was written.
     *
     * The weights are CC-BY-NC-4.0 and no separate commercial grant for the
     * hosted endpoint has been established — unlike FLUX.1 [dev], where such a
     * grant is published. Selling generations from a non-commercial model is
     * the one finding here that could not wait for a review cycle.
     */
    verdict: "BLOCKED",
    reason:
      "Weights are CC-BY-NC-4.0 and no commercial grant for the hosted endpoint has been established.",
  },
  {
    modelId: "replicate/sfx",
    publicId: "foley",
    publicName: "Foley",
    hostedEndpoint: "replicate:zsxkib/mmaudio",
    auditedVersion: "62871fb5",
    licence: "MIT (MMAudio)",
    commercialSaasUse: true,
    outputsSellable: true,
    attribution: "MIT notice retained in our third-party notices.",
    trademark: "None asserted.",
    acceptableUse: "No model-specific restriction.",
    evidenceUrl: "https://github.com/hkchengrex/MMAudio#MIT-1-ov-file",
    verifiedOn: "2026-08-25",
    verdict: "ALLOWED",
    reason: "MIT permits commercial use with the notice retained.",
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
 * May this model run for a paying customer, right now?
 *
 * Fails closed on a missing policy. A model added without an entry is a model
 * nobody has checked, and the safe answer to "has anyone verified this" is no —
 * not "probably, it is in the catalogue".
 */
export function isRunnable(modelId: string): boolean {
  const policy = policyFor(modelId);
  if (!policy) return false;
  return policy.verdict === "ALLOWED";
}

/**
 * May this model appear in a customer-facing list?
 *
 * The same rule. A model that cannot run must not be advertised, or the
 * interface offers something every submission will refuse.
 */
export function isPubliclyOffered(modelId: string): boolean {
  return isRunnable(modelId);
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
