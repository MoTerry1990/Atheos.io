import "server-only";

import { env } from "@/lib/env";
import { providerFetch } from "@/services/ai/providers/http";
import { providerError } from "@/services/ai/types";
import type {
  AIProvider,
  GenerationJob,
  GenerationRequest,
  ProviderError,
  ProviderModel,
} from "@/services/ai/types";

/**
 * Google Gemini — image generation.
 *
 * ## Status: written, never executed
 *
 * There is no `GOOGLE_AI_API_KEY` in this environment and no way to obtain one
 * here, so **not one line of this has run against Google**. It is written from
 * the documented shape of the `generateContent` API, and the parts most likely
 * to be wrong are named in AI_PROVIDER_REPORT.md rather than left to be
 * discovered.
 *
 * That is the honest status, and it is why `catalogue.ts` keeps this provider
 * `declared` until someone runs it. A `declared` provider is unreachable: the
 * registry will not offer it, so this file cannot silently become the default
 * for anybody.
 *
 * ## Synchronous, so the job id is ours
 *
 * Gemini's image models return inline base64 in the response rather than a job
 * handle. There is nothing to poll. The adapter therefore mints a synthetic id
 * and caches the result, exactly as the OpenAI adapter does — the alternative
 * is a second shape for `submit`/`poll` that the whole pipeline would have to
 * branch on.
 *
 * The cache is process-local and short-lived, which is a real constraint: on a
 * serverless platform a poll can land on an instance that never saw the submit.
 * Mitigated by the studio polling immediately after submit, and named as a
 * limitation rather than hidden.
 */

const API = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Results held between submit and the first poll.
 *
 * Bounded and time-limited so a burst of generations cannot grow it without
 * limit — the same reasoning as the rate limiter's key cap.
 */
const RESULTS = new Map<string, { job: GenerationJob; at: number }>();
const RESULT_TTL_MS = 10 * 60_000;
const MAX_CACHED = 500;

function remember(id: string, job: GenerationJob): void {
  const now = Date.now();

  for (const [key, entry] of RESULTS) {
    if (now - entry.at > RESULT_TTL_MS) RESULTS.delete(key);
  }
  if (RESULTS.size >= MAX_CACHED) {
    const oldest = RESULTS.keys().next().value;
    if (oldest) RESULTS.delete(oldest);
  }

  RESULTS.set(id, { job, at: now });
}

const MODELS: ProviderModel[] = [
  {
    id: "google/gemini-2.5-flash-image",
    providerId: "google",
    displayName: "Gemini 2.5 Flash Image",
    modality: "IMAGE",
    creditCost: 8,
    capabilities: {
      supportsNegativePrompt: false,
      supportsImageInput: true,
      supportsSeed: false,
      // Gemini derives dimensions from the prompt and any input image rather
      // than taking an explicit ratio. Declaring none is honest: the studio
      // will not show a control the model ignores.
      aspectRatios: [],
      maxOutputs: 4,
      operations: ["text-to-image", "image-to-image"],
    },
  },
];

/** Google's error envelope: `{ error: { code, message, status } }`. */
function mapGoogleError(status: number, body: unknown): ProviderError | null {
  const message =
    typeof body === "object" && body !== null && "error" in body
      ? String(
          (body as { error?: { message?: string } }).error?.message ?? "",
        ).slice(0, 200)
      : "";

  // Google reports safety blocks as a 200 with no candidate, and as 400 with a
  // SAFETY reason. Both must map to `content_filtered` — not to
  // `invalid_request` — because the two are treated differently: a filtered
  // prompt is the user's to change, and neither is ever retried.
  if (/safety|blocked|prohibited/i.test(message)) {
    return providerError(
      "content_filtered",
      "That prompt was blocked by the provider's safety filter.",
      { retryable: false, raw: body },
    );
  }

  if (status === 400 && /api key/i.test(message)) {
    return providerError("invalid_request", "The provider rejected our key.", {
      retryable: false,
      raw: body,
    });
  }

  // Anything else falls through to the shared default mapping.
  return null;
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { inlineData?: { mimeType?: string; data?: string } }[];
    };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export const googleProvider: AIProvider = {
  id: "google",
  displayName: "Google Gemini",

  isConfigured: () => Boolean(env.GOOGLE_AI_API_KEY),

  listModels: () => MODELS,

  async submit(request: GenerationRequest): Promise<GenerationJob> {
    const key = env.GOOGLE_AI_API_KEY;
    if (!key) {
      throw providerError("invalid_request", "Google is not configured.", {
        retryable: false,
      });
    }

    const model = MODELS.find((m) => m.id === request.modelId);
    if (!model) {
      throw providerError(
        "unsupported_operation",
        "That model is not offered by Google.",
        { retryable: false },
      );
    }

    // Input images are passed as URLs everywhere else in this codebase, but
    // Gemini wants inline base64. Fetching and encoding here keeps that
    // difference inside the adapter rather than leaking a second input shape
    // into `GenerationRequest`.
    const parts: Record<string, unknown>[] = [{ text: request.prompt }];

    for (const url of request.inputImageUrls ?? []) {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw providerError(
          "invalid_request",
          "Could not read the reference image.",
          { retryable: false },
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      parts.push({
        inlineData: {
          mimeType: response.headers.get("content-type") ?? "image/png",
          data: buffer.toString("base64"),
        },
      });
    }

    const modelPath = request.modelId.replace(/^google\//, "");

    const { data, latencyMs, usage } = await providerFetch<GeminiResponse>({
      providerId: "google",
      // Key in a header, never the query string. Google accepts `?key=`, and a
      // credential in a URL ends up in every log and proxy along the way.
      url: `${API}/models/${modelPath}:generateContent`,
      headers: { "x-goog-api-key": key },
      body: {
        contents: [{ parts }],
        generationConfig: {
          candidateCount: Math.min(
            request.outputs ?? 1,
            model.capabilities.maxOutputs,
          ),
        },
      },
      mapError: mapGoogleError,
      readUsage: (body) => {
        const meta = (body as GeminiResponse).usageMetadata;
        return meta
          ? {
              promptTokens: meta.promptTokenCount,
              completionTokens: meta.candidatesTokenCount,
            }
          : undefined;
      },
    });

    const outputs = (data.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .filter((part) => part.inlineData?.data)
      .map((part) => ({
        // A data URL rather than a fetchable link: the storage layer already
        // handles both shapes, so the adapter does not need to upload first.
        sourceUrl: `data:${part.inlineData?.mimeType ?? "image/png"};base64,${part.inlineData?.data}`,
        mimeType: part.inlineData?.mimeType ?? "image/png",
      }));

    if (outputs.length === 0) {
      // A 200 with no image is how Gemini reports a safety block. Treating it
      // as success would produce a "succeeded" generation with nothing in it.
      const reason = data.candidates?.[0]?.finishReason ?? "no output";
      throw providerError(
        /safety/i.test(reason) ? "content_filtered" : "provider_unavailable",
        /safety/i.test(reason)
          ? "That prompt was blocked by the provider's safety filter."
          : "The provider returned no image.",
        { retryable: !/safety/i.test(reason), raw: data },
      );
    }

    const job: GenerationJob = {
      providerJobId: `google_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      state: "succeeded",
      outputs,
    };

    remember(job.providerJobId, job);

    // Latency and token usage are deliberately **not** attached to the job.
    //
    // `GenerationJob` has no field for either, and this sprint forbids changing
    // the provider interface. The first version of this line used an
    // `as GenerationJob` cast to smuggle them through — which typechecks,
    // silently drops both, and would have made "we persist token usage" a
    // claim nothing supported.
    //
    // Submit latency is instead measured by the Provider Manager, which wraps
    // this call and can time it from outside. Token usage has no such route and
    // is a documented gap: see AI_PROVIDER_REPORT.md.
    void latencyMs;
    void usage;

    return job;
  },

  async poll(providerJobId: string): Promise<GenerationJob> {
    const cached = RESULTS.get(providerJobId);
    if (cached) return cached.job;

    // The instance that ran submit is not this one, or the TTL elapsed. Failing
    // is correct and better than reporting `running` forever: the pipeline
    // refunds, and the user can try again.
    throw providerError(
      "provider_unavailable",
      "That generation's result is no longer available.",
      { retryable: false },
    );
  },
};
