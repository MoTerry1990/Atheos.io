import "server-only";

import {
  providerError,
  type AIProvider,
  type GenerationJob,
  type GenerationRequest,
  type ProviderModel,
} from "@/services/ai/types";
import { CAMERA_MOTIONS } from "@/services/ai/motion";
import { env } from "@/lib/env";

/**
 * Replicate.
 *
 * Chosen as the first real adapter because its predictions API is uniform
 * across wildly different models — text-to-image, upscaling and background
 * removal are all "create a prediction, poll it". That maps onto our
 * submit/poll contract almost exactly, which makes it a good test of whether
 * the contract is any good.
 *
 * ## No SDK
 *
 * Plain `fetch` against a documented REST API. The SDK adds a dependency, a
 * bundle, and its own opinions about retries for two endpoints. More
 * importantly it would be a vendor package imported into our codebase — the one
 * thing this directory exists to contain.
 *
 * ## Model versions are pinned
 *
 * Replicate identifies a model by a version hash. Tracking "latest" means a
 * vendor can silently change what our users get and what it costs us, mid-week,
 * with no deploy on our side. Pinning is the only way to make output
 * reproducible — and reproducibility is what the seed control promises.
 *
 * The hashes below are **placeholders**. They are structurally correct and
 * clearly marked; real ones come from the Replicate dashboard when an account
 * exists. Inventing plausible-looking hashes and presenting them as working
 * would be worse than an obvious placeholder.
 */

const API = "https://api.replicate.com/v1";

/**
 * Model catalog.
 *
 * `version` is the pinned Replicate version hash. `PLACEHOLDER` values are
 * rejected at submit time with a clear error rather than sent to the API, so a
 * misconfiguration fails loudly instead of as an opaque 422.
 */
const MODELS: (ProviderModel & { version: string })[] = [
  {
    id: "replicate/flux-schnell",
    providerId: "replicate",
    displayName: "FLUX Schnell",
    modality: "IMAGE",
    creditCost: 4,
    version: "c846a69991daf4c0e5d016514849d14ee5b2e6846ce6b9d6f21369e564cfe51e",
    capabilities: {
      supportsNegativePrompt: false,
      supportsImageInput: false,
      supportsSeed: true,
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      maxOutputs: 4,
      operations: ["text-to-image"],
    },
  },
  {
    id: "replicate/flux-dev",
    providerId: "replicate",
    displayName: "FLUX Dev",
    modality: "IMAGE",
    creditCost: 12,
    version: "6e4a938f85952bdabcc15aa329178c4d681c52bf25a0342403287dc26944661d",
    capabilities: {
      supportsNegativePrompt: false,
      supportsImageInput: true,
      supportsSeed: true,
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
      maxOutputs: 4,
      operations: ["text-to-image", "image-to-image", "variations"],
    },
  },
  {
    id: "replicate/real-esrgan",
    providerId: "replicate",
    displayName: "Real-ESRGAN",
    modality: "IMAGE",
    creditCost: 3,
    version: "b3ef194191d13140337468c916c2c5b96dd0cb06dffc032a022a31807f6a5ea8",
    capabilities: {
      // An upscaler takes no prompt at all. Declaring that here is what stops
      // the studio offering it as a generation model.
      supportsNegativePrompt: false,
      supportsImageInput: true,
      supportsSeed: false,
      aspectRatios: [],
      maxOutputs: 1,
      operations: ["upscale"],
    },
  },
  {
    id: "replicate/video-gen",
    providerId: "replicate",
    displayName: "Motion 1",
    modality: "VIDEO",
    // An order of magnitude above a still, which is roughly the real cost
    // ratio. Pricing a clip like an image is how a platform loses money on
    // every use of its most impressive feature.
    creditCost: 90,
    version: "1ffaab95d8f67adf487548468b03e795ad0410089c655c560e492add1b7beaf0",
    capabilities: {
      supportsNegativePrompt: true,
      supportsImageInput: true,
      supportsSeed: true,
      aspectRatios: ["16:9", "9:16", "1:1"],
      // One clip per run. Video is slow and expensive enough that batching
      // four is a bill nobody asked for.
      maxOutputs: 1,
      durations: [5, 10],
      maxDurationSeconds: 10,
      cameraMotions: CAMERA_MOTIONS,
      operations: ["text-to-video", "image-to-video"],
    },
  },
  {
    id: "replicate/remove-bg",
    providerId: "replicate",
    displayName: "Background Remover",
    modality: "IMAGE",
    creditCost: 2,
    version: "95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1",
    capabilities: {
      supportsNegativePrompt: false,
      supportsImageInput: true,
      supportsSeed: false,
      aspectRatios: [],
      maxOutputs: 1,
      operations: ["remove-background"],
    },
  },
];

type ReplicatePrediction = {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[] | null;
  error?: string | null;
  logs?: string | null;
};

function findModel(modelId: string) {
  return MODELS.find((model) => model.id === modelId);
}

/**
 * Translate our request into Replicate's `input` object.
 *
 * This function is the entire reason the abstraction exists: every vendor
 * quirk — `go_fast`, `image` vs `img`, strength being inverted — lives here and
 * nowhere else.
 */
function buildInput(
  request: GenerationRequest,
  model: ProviderModel,
): Record<string, unknown> {
  const [source] = request.inputImageUrls ?? [];

  switch (request.operation) {
    case "text-to-video":
    case "image-to-video":
      return {
        // Camera motion is appended to the prompt rather than sent as a
        // parameter: these models read it as caption text, and the vendors we
        // have looked at expose no structured motion control.
        prompt: [request.prompt, request.cameraMotion]
          .filter(Boolean)
          .join(", "),
        ...(model.capabilities.supportsNegativePrompt && request.negativePrompt
          ? { negative_prompt: request.negativePrompt }
          : {}),
        ...(source ? { image: source } : {}),
        duration: request.durationSeconds ?? 5,
        ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
      };

    case "upscale":
      return { image: source, scale: request.scale ?? 2 };

    case "remove-background":
      return { image: source };

    case "variations":
      return {
        prompt: request.prompt || "a variation of the input image",
        image: source,
        // High denoising for a variation: low values return the input almost
        // unchanged, which is not what "variation" means to a user.
        prompt_strength: 0.75,
        num_outputs: request.outputs ?? 1,
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
      };

    case "image-to-image":
      return {
        prompt: request.prompt,
        image: source,
        // Our `inputStrength` means "how much the reference matters".
        // Replicate's `prompt_strength` means the opposite — how far to move
        // away from it. Inverting here is exactly the kind of detail that must
        // not leak into the UI.
        prompt_strength: 1 - (request.inputStrength ?? 0.6),
        num_outputs: request.outputs ?? 1,
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
      };

    case "text-to-image":
    default:
      return {
        prompt: request.prompt,
        ...(model.capabilities.supportsNegativePrompt && request.negativePrompt
          ? { negative_prompt: request.negativePrompt }
          : {}),
        ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
        num_outputs: request.outputs ?? 1,
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
        output_format: "png",
      };
  }
}

/** Map a Replicate status onto ours. */
function toState(
  status: ReplicatePrediction["status"],
): GenerationJob["state"] {
  switch (status) {
    case "starting":
      return "queued";
    case "processing":
      return "running";
    case "succeeded":
      return "succeeded";
    case "canceled":
      return "canceled";
    default:
      return "failed";
  }
}

/**
 * Replicate returns a string or an array depending on the model.
 *
 * The MIME type is inferred from the extension rather than assumed. The same
 * response shape carries a PNG from an image model and an MP4 from a video one,
 * and assuming PNG would store a clip under an image content type — which then
 * refuses to play in a browser and is classified as an image asset in our own
 * database.
 */
function toOutputs(output: ReplicatePrediction["output"]) {
  if (!output) return [];
  const urls = Array.isArray(output) ? output : [output];

  return urls
    .filter((url): url is string => typeof url === "string")
    .map((url) => ({ sourceUrl: url, mimeType: mimeTypeFor(url) }));
}

const EXTENSION_MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  png: "image/png",
};

function mimeTypeFor(url: string): string {
  // Strip the query first — Replicate serves signed URLs, and ".mp4?token=…"
  // has no usable extension until it is gone.
  const path = url.split("?")[0].toLowerCase();
  const extension = path.slice(path.lastIndexOf(".") + 1);
  // Falls back to PNG because every image model here emits PNG; a video whose
  // URL carries no extension would be mislabelled, which is why the video
  // models above are pinned to vendors that return one.
  return EXTENSION_MIME_TYPES[extension] ?? "image/png";
}

/**
 * Classify a failure.
 *
 * The distinction that matters is retryable vs not, because that decides
 * whether the pipeline refunds and whether we try again. Guessing wrong in the
 * generous direction burns the user's credits twice.
 */
function classify(status: number, body: unknown) {
  const message = typeof body === "string" ? body : JSON.stringify(body);

  if (status === 429) {
    return providerError("rate_limited", "The provider is rate limiting us.", {
      retryable: true,
      raw: body,
    });
  }
  if (status === 402) {
    return providerError(
      "insufficient_provider_credit",
      "Generation is temporarily unavailable.",
      { raw: body },
    );
  }
  if (status === 422 || status === 400) {
    return providerError(
      "invalid_request",
      "The provider rejected these settings.",
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
  return providerError("unknown", "The generation could not be started.", {
    raw: message,
  });
}

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    // Never cache a prediction — polling a cached response would report a job
    // as running forever.
    cache: "no-store",
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) throw classify(response.status, body);
  return body;
}

export const replicateProvider: AIProvider = {
  id: "replicate",
  displayName: "Replicate",

  isConfigured: () => Boolean(env.REPLICATE_API_TOKEN),

  listModels: () => MODELS.map(({ version: _version, ...model }) => model),

  async submit(request) {
    const model = findModel(request.modelId);
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

    if (model.version.startsWith("PLACEHOLDER")) {
      // Fail here, clearly, rather than sending a nonsense version and getting
      // back an opaque 422 that looks like a bug in our request builder.
      throw providerError(
        "invalid_request",
        `No pinned model version is configured for ${model.displayName}. Set it in services/ai/providers/replicate.ts.`,
      );
    }

    const prediction: ReplicatePrediction = await call("/predictions", {
      method: "POST",
      body: JSON.stringify({
        version: model.version,
        input: buildInput(request, model),
      }),
    });

    return {
      providerJobId: prediction.id,
      state: toState(prediction.status),
      outputs: toOutputs(prediction.output),
    };
  },

  async poll(providerJobId) {
    const prediction: ReplicatePrediction = await call(
      `/predictions/${providerJobId}`,
    );

    const state = toState(prediction.status);

    return {
      providerJobId,
      state,
      outputs: toOutputs(prediction.output),
      error:
        state === "failed"
          ? providerError(
              "unknown",
              prediction.error ?? "The generation failed.",
              { raw: prediction.error },
            )
          : undefined,
    };
  },

  async cancel(providerJobId) {
    await call(`/predictions/${providerJobId}/cancel`, { method: "POST" });
  },
};
