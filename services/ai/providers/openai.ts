import "server-only";

import {
  providerError,
  type AIProvider,
  type GenerationJob,
  type GenerationRequest,
  type ProviderModel,
} from "@/services/ai/types";
import { env } from "@/lib/env";

/**
 * OpenAI Images.
 *
 * The second adapter exists to prove the abstraction, not to pad the catalog.
 * It differs from Replicate in ways that would break a seam that was only ever
 * tested against one vendor:
 *
 * - **Synchronous.** There is no prediction to poll; the response contains the
 *   image. Our contract is submit-then-poll, so `submit` returns a terminal
 *   job and `poll` reports it. A contract that could not express that would be
 *   wrong.
 * - **No seed.** The model does not expose one, so `supportsSeed: false` and
 *   the studio hides the control rather than sending a value that is ignored.
 * - **Sizes, not aspect ratios.** Translated here, so nothing above this layer
 *   learns about `1024x1536`.
 * - **Base64 by default**, where Replicate returns URLs.
 *
 * ## Where the results are held
 *
 * The API returns base64. Rather than invent a second output channel, the
 * adapter emits a `data:` URL — which the pipeline can fetch and store exactly
 * like any other source URL. One storage path for both vendors.
 */

const API = "https://api.openai.com/v1";

const MODELS: ProviderModel[] = [
  {
    id: "openai/gpt-image-1",
    providerId: "openai",
    displayName: "GPT Image 1",
    modality: "IMAGE",
    // 20, not 16, since Sprint 4. $0.04 an image against 16 credits was a 2.0x
    // margin — the worst image ratio in the catalogue, on the model people are
    // most likely to pick because it is the one they recognise.
    creditCost: 20,
    capabilities: {
      supportsNegativePrompt: false,
      supportsImageInput: true,
      supportsSeed: false,
      aspectRatios: ["1:1", "3:2", "2:3"],
      maxOutputs: 4,
      // No upscale or background removal — this vendor does neither, and
      // declaring otherwise would offer the user an operation that fails.
      operations: ["text-to-image", "image-to-image", "variations"],
    },
  },
];

/** Our aspect ratios, in the sizes this API actually accepts. */
const SIZE_BY_RATIO: Record<string, string> = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

type ImageResponse = {
  data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
  error?: { message?: string; code?: string; type?: string };
};

function classify(status: number, body: ImageResponse | null) {
  const message = body?.error?.message;

  if (status === 429) {
    return providerError("rate_limited", "The provider is rate limiting us.", {
      retryable: true,
      raw: body,
    });
  }
  if (status === 400 && body?.error?.code === "content_policy_violation") {
    return providerError(
      "content_filtered",
      "That prompt was rejected by the provider's content policy.",
      { raw: body },
    );
  }
  if (status === 400) {
    return providerError(
      "invalid_request",
      message ?? "The provider rejected these settings.",
      { raw: body },
    );
  }
  if (status === 401 || status === 403) {
    return providerError(
      "provider_unavailable",
      "Generation is temporarily unavailable.",
      { raw: body },
    );
  }
  if (status >= 500) {
    return providerError(
      "provider_unavailable",
      "The provider is having trouble. Try again shortly.",
      { retryable: true, raw: body },
    );
  }
  return providerError("unknown", "The generation could not be completed.", {
    raw: body,
  });
}

/**
 * Terminal jobs, held in memory.
 *
 * The API is synchronous, so by the time `submit` returns there is nothing left
 * to poll. The client still polls once, because that is the contract — so the
 * result is parked here for it to collect.
 *
 * A Map on a serverless instance is not durable, which is fine because the
 * pipeline persists outputs to the database before the client ever polls. This
 * only covers the window between the two, and it is bounded so a long-lived
 * instance cannot grow it without limit.
 */
const completed = new Map<string, GenerationJob>();
const MAX_HELD = 100;

function remember(job: GenerationJob) {
  if (completed.size >= MAX_HELD) {
    const oldest = completed.keys().next().value;
    if (oldest) completed.delete(oldest);
  }
  completed.set(job.providerJobId, job);
}

export const openaiProvider: AIProvider = {
  id: "openai",
  displayName: "OpenAI",

  isConfigured: () => Boolean(env.OPENAI_API_KEY),

  listModels: () => MODELS,

  async submit(request: GenerationRequest) {
    const model = MODELS.find((entry) => entry.id === request.modelId);
    if (!model) {
      throw providerError(
        "invalid_request",
        "That model is not available from this provider.",
      );
    }
    if (!model.capabilities.operations.includes(request.operation)) {
      throw providerError(
        "unsupported_operation",
        `${model.displayName} cannot perform ${request.operation.replace(/-/g, " ")}.`,
      );
    }

    const size = SIZE_BY_RATIO[request.aspectRatio ?? "1:1"] ?? "1024x1024";
    const editing = request.operation !== "text-to-image";

    let response: Response;

    if (editing) {
      const [source] = request.inputImageUrls ?? [];
      if (!source) {
        throw providerError(
          "invalid_request",
          "This operation needs a source image.",
        );
      }

      // The edits endpoint takes multipart, not JSON — another vendor-specific
      // detail that stops here.
      const image = await fetch(source).then((res) => res.blob());
      const form = new FormData();
      form.append("model", "gpt-image-1");
      form.append("image", image, "source.png");
      form.append(
        "prompt",
        request.prompt || "a variation of this image, same subject and style",
      );
      form.append("n", String(request.outputs ?? 1));
      form.append("size", size);

      response = await fetch(`${API}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: form,
        cache: "no-store",
      });
    } else {
      response = await fetch(`${API}/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt: request.prompt,
          n: request.outputs ?? 1,
          size,
        }),
        cache: "no-store",
      });
    }

    const body: ImageResponse | null = await response.json().catch(() => null);

    if (!response.ok) throw classify(response.status, body);

    const outputs = (body?.data ?? [])
      .map((item) =>
        item.b64_json
          ? {
              sourceUrl: `data:image/png;base64,${item.b64_json}`,
              mimeType: "image/png",
            }
          : item.url
            ? { sourceUrl: item.url, mimeType: "image/png" }
            : null,
      )
      .filter(
        (output): output is NonNullable<typeof output> => output !== null,
      );

    const job: GenerationJob = {
      // Synthetic id: this vendor gives us nothing stable to key on.
      providerJobId: `openai_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      state: outputs.length > 0 ? "succeeded" : "failed",
      progress: 1,
      outputs,
      error:
        outputs.length === 0
          ? providerError("unknown", "The provider returned no images.")
          : undefined,
    };

    remember(job);
    return job;
  },

  async poll(providerJobId) {
    const job = completed.get(providerJobId);
    if (job) return job;

    // The instance that submitted has gone. The pipeline already persisted the
    // outcome, so reporting "succeeded with nothing to add" would be a lie —
    // this is honest about having lost track.
    return {
      providerJobId,
      state: "failed",
      error: providerError(
        "timeout",
        "The result could not be retrieved. Please try again.",
        { retryable: true },
      ),
    };
  },
};
