import "server-only";

import { GoogleGenAI } from "@google/genai";

import { env } from "@/lib/env";
import { providerError } from "@/services/ai/types";
import type {
  AIProvider,
  GenerationJob,
  GenerationRequest,
  ProviderModel,
} from "@/services/ai/types";

/**
 * Cinematic Next — Google's video model, reached directly.
 *
 * ## Status: written against the SDK's types, never executed
 *
 * There is no `GOOGLE_AI_API_KEY` in any environment, so not one line of this
 * has run against Google. `isConfigured()` returns false and the registry
 * never offers the model — a missing credential hides *this* model and nothing
 * else. Replicate keeps serving everything; the studio keeps working.
 *
 * The first draft was written from a guessed REST shape: `:predictLongRunning`,
 * an `instances`/`parameters` body, a `videos[].uri` response. None of that is
 * the documented contract. It is now written against `@google/genai`'s
 * **Interactions API** and its published types, so every field below is one the
 * compiler checks rather than one I hoped for.
 *
 * ## Why the version is pinned to the exact stable id
 *
 * `gemini-omni-1.1-flash` is the stable id. Google also publishes
 * `gemini-omni-flash-preview`, and this file must never point at it: an
 * approval is granted for the endpoint that was audited, and a preview alias is
 * a moving target. A successor needs its own audit and its own entry.
 *
 * ## Duration is the model's decision, not ours
 *
 * `VideoResponseFormat` does expose an optional `duration`, but the
 * documentation describes 3–10 second outputs without committing to honouring
 * an exact requested length, and timecodes inside a prompt *steer* a model
 * rather than binding it. So Atheos publishes no enum of exact lengths it
 * cannot deliver: the capability is `model_decided` across a 3–10s range, the
 * studio says "Up to 10 seconds", and the price is fixed at the 10-second
 * maximum.
 *
 * That last part is a commercial choice with a reason. Quoting happens before
 * the length is known, and there are only two honest options: charge the
 * maximum and say so, or reserve the maximum and capture the real cost after
 * measuring the file. The second needs partial release in the ledger and
 * duration parsing from the MP4, neither of which is proven here. Charging the
 * stated maximum can only be wrong in the customer's favour.
 *
 * ## Audio cannot be turned off
 *
 * `VideoResponseFormat` has no audio field, and Google states the model
 * "natively generates audio with every video output". Inventing a parameter
 * the API ignores would deliver sound to somebody who asked for silence and
 * paid for the choice. `services/ai/audio-strategy.ts` lists `NATIVE` only.
 *
 * ## Retention
 *
 * `store: false` on every call, so Google keeps no interaction for later
 * retrieval. That forecloses multi-turn conversational editing, which is a real
 * capability of this model and a deliberate later phase — it needs an explicit
 * retention policy and the customer's consent, not a default nobody chose.
 *
 * ## Everything a browser must never see
 *
 * The key, the model id, the interaction id and the output URI. The public
 * identity is `cinematic-next` / "Cinematic Next" — Atheos's own name, which
 * neither claims Atheos built the model nor carries Google's branding into our
 * catalogue.
 */

/**
 * The audited endpoint. Stable, not the preview alias.
 *
 * Changing this string is a licence decision, not a version bump: it needs a
 * new entry in `docs/LICENCE-EVIDENCE.md` and a new policy record, or
 * `isRunnableFor` refuses it and the model vanishes.
 */
export const OMNI_MODEL_ID = "gemini-omni-1.1-flash";

/** Our catalogue id. Never sent to a browser. */
export const OMNI_CATALOGUE_ID = "google/omni-1.1-flash";

/**
 * The only resolution Atheos sells today.
 *
 * Google publishes ~$0.10/s specifically for 720p. 1080p and 4K are documented
 * outputs, but the pricing read does not establish their token consumption, and
 * a price we cannot derive is a price we must not charge.
 */
export const OMNI_SELLABLE_RESOLUTION = "720p";

/** Documented output range. Not a list of deliverable exact lengths. */
export const OMNI_DURATION_RANGE = { min: 3, max: 10 } as const;

/**
 * How this model treats a requested length.
 *
 * A contract with the rest of the codebase: do not offer a duration picker, do
 * not call `exactDuration`, do not silently substitute a length, and price on
 * the maximum.
 */
export const OMNI_DURATION_MODE = "model_decided" as const;

/**
 * What the documentation states, and only that.
 *
 * `durations` is deliberately **absent**. Every other video model enumerates
 * the lengths it accepts and `exactDuration` refuses anything off the list —
 * correct for a model with a duration enum, and a lie for this one. The
 * absence is what routes this model past that check; `OMNI_DURATION_MODE` says
 * why. `maxDurationSeconds` is what the fixed price is computed on.
 */
const OMNI_MODEL: ProviderModel = {
  id: OMNI_CATALOGUE_ID,
  providerId: "google-omni",
  displayName: "Cinematic Next",
  modality: "VIDEO",
  // Priced by `services/billing/model-costs.ts`, the only place that knows a
  // rate. Nothing here holds a copy.
  creditCost: 0,
  capabilities: {
    operations: ["text-to-video", "image-to-video"],
    maxOutputs: 1,
    aspectRatios: ["16:9", "9:16"],
    supportsImageInput: true,
    // Neither is documented for this model. Declared false rather than
    // hopefully true: a capability we cannot cite is one the composer must not
    // build a prompt around.
    supportsNegativePrompt: false,
    supportsSeed: false,
    maxDurationSeconds: OMNI_DURATION_RANGE.max,
  },
};

/**
 * Configured means a key exists **and** the model is switched on.
 *
 * Two conditions rather than one. The key alone would make the model appear
 * the moment somebody added a Google credential for something unrelated, and
 * appearing is an offer.
 */
function configured(): boolean {
  return (
    Boolean(env.GOOGLE_AI_API_KEY) && process.env.ENABLE_GOOGLE_OMNI === "1"
  );
}

/**
 * The client, built per call with an explicit key.
 *
 * Explicit rather than relying on whatever variable name the SDK discovers by
 * itself: an adapter that picks up an ambient credential is one that silently
 * starts working in an environment nobody configured it for.
 */
function client(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: env.GOOGLE_AI_API_KEY! });
}

/** Polling limits. A vendor that never finishes must not hold a job forever. */
export const POLL_LIMITS = {
  maxAttempts: 60,
  initialDelayMs: 2_000,
  maxDelayMs: 15_000,
  totalTimeoutMs: 10 * 60 * 1000,
} as const;

/** Exponential backoff, capped. Exported so the worker uses the same curve. */
export function pollDelayMs(attempt: number): number {
  return Math.min(
    POLL_LIMITS.initialDelayMs * 2 ** Math.max(0, attempt),
    POLL_LIMITS.maxDelayMs,
  );
}

/**
 * The statuses the Interactions API reports.
 *
 * Taken from the SDK's `InteractionStatus` union rather than invented. These
 * are *not* `FileState`'s `ACTIVE`/`FAILED` — that enum belongs to uploaded
 * files, and conflating the two is the kind of guess this rewrite removed.
 */
const TERMINAL_FAILURES = new Set([
  "failed",
  "cancelled",
  "incomplete",
  "budget_exceeded",
]);

/** The subset of `Interaction` this adapter reads. */
export interface InteractionLike {
  id: string;
  status: string;
  output_video?: { data?: string; mime_type?: string; uri?: string };
  errors?: unknown[];
}

/**
 * Turn one interaction into our normalised job.
 *
 * Exported so fixtures drive it directly. The REST payload and the SDK's
 * object are the same shape, so one function serves both — and the tests prove
 * that rather than asserting it.
 */
export function jobFromInteraction(
  interaction: InteractionLike,
): GenerationJob {
  if (TERMINAL_FAILURES.has(interaction.status)) {
    // The vendor's diagnostics ride along for the log, never for the response:
    // they can name the model, the project and the quota that was hit.
    throw providerError("unknown", "The generation failed.", {
      raw: interaction.errors,
    });
  }

  if (interaction.status !== "completed") {
    return { providerJobId: interaction.id, state: "running" };
  }

  const video = interaction.output_video;
  const mimeType = video?.mime_type ?? "video/mp4";

  /**
   * Two delivery modes, both handled.
   *
   * `delivery: "uri"` is requested because a clip is far too large for a JSON
   * body, but the API may still answer inline for a short one — so both are
   * accepted. A data URI keeps `storeGeneratedAsset` on one code path: it
   * fetches whatever `sourceUrl` names and writes the bytes verbatim, which is
   * what preserves SynthID and the C2PA manifest.
   */
  const sourceUrl = video?.uri
    ? video.uri
    : video?.data
      ? `data:${mimeType};base64,${video.data}`
      : null;

  if (!sourceUrl) {
    throw providerError("unknown", "The generation produced no output.");
  }

  return {
    providerJobId: interaction.id,
    state: "succeeded",
    outputs: [{ sourceUrl, mimeType }],
  };
}

export const googleOmniProvider: AIProvider = {
  id: "google-omni",
  displayName: "Cinematic Next",

  isConfigured: configured,

  listModels() {
    // An unconfigured provider offers nothing. The registry filters on
    // `isConfigured()` too; this is the second lock, so a refactor that
    // loosens one does not expose the model.
    return configured() ? [OMNI_MODEL] : [];
  },

  async submit(request: GenerationRequest): Promise<GenerationJob> {
    if (!configured()) {
      throw providerError(
        "provider_unavailable",
        "That model is not available.",
      );
    }

    const interaction = (await client().interactions.create({
      model: OMNI_MODEL_ID,
      input: request.prompt,
      response_format: {
        type: "video",
        // The only resolution we have a defensible price for.
        resolution: OMNI_SELLABLE_RESOLUTION,
        /**
         * `uri`, not `inline`. A ten-second clip as base64 in a JSON body is
         * tens of megabytes through the response parser, and the pipeline
         * fetches from a URL anyway.
         *
         * No `duration` is sent: see the header. We do not request a length
         * the documentation does not promise to honour.
         */
        delivery: "uri",
        ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
      },
      // Nothing kept on Google's side for later retrieval.
      store: false,
      // Long-running: we poll rather than hold a connection open.
      background: true,
    })) as unknown as InteractionLike;

    if (!interaction?.id) {
      throw providerError("unknown", "The generation could not be started.", {
        raw: interaction,
      });
    }

    return { providerJobId: interaction.id, state: "running" };
  },

  async poll(providerJobId: string): Promise<GenerationJob> {
    if (!configured()) {
      throw providerError(
        "provider_unavailable",
        "That model is not available.",
      );
    }

    const interaction = (await client().interactions.get(
      providerJobId,
    )) as unknown as InteractionLike;

    return jobFromInteraction(interaction);
  },

  async cancel(providerJobId: string): Promise<void> {
    if (!configured()) return;
    // Best effort, as the interface requires: a vendor that cannot cancel
    // resolves rather than throws, so callers need no special case.
    await client()
      .interactions.delete(providerJobId)
      .catch(() => undefined);
  },
};
