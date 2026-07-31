import "server-only";

import {
  providerError,
  type AIProvider,
  type GenerationRequest,
  type ProviderModel,
} from "@/services/ai/types";

/**
 * The mock provider. **It does not generate anything.**
 *
 * ## Why this exists
 *
 * A developer cloning this repository has no Replicate token and no OpenAI key.
 * Without a fallback the studio would be dead on arrival: nothing to click,
 * no way to see whether the pipeline, the credit ledger, the storage copy or
 * the error states work. The whole of Sprint 6 would be unreviewable.
 *
 * So when no real provider is configured, the registry falls back to this. It
 * exercises the **entire server pipeline** — jobs are persisted, credits are
 * debited and refunded, outputs are written to storage — with a synthetic image
 * standing in for a model's work.
 *
 * ## It is not disguised
 *
 * `displayName` says "Mock", the models are named Mock, and the studio shows a
 * banner whenever the active provider is this one. Its output is a flat SVG
 * gradient with the words "Mock provider — not AI generated" rendered into it,
 * so a file that escapes the app still says what it is.
 *
 * ## It fails on purpose
 *
 * One in ten submissions fails, and one in twenty fails *after* running. Those
 * are the paths that decide whether a refund happens, and they are the ones a
 * happy-path demo never reaches. A mock that always succeeds would let a broken
 * refund ship.
 */

const MODELS: ProviderModel[] = [
  {
    id: "mock/standard",
    providerId: "mock",
    displayName: "Mock Standard",
    modality: "IMAGE",
    creditCost: 4,
    capabilities: {
      supportsNegativePrompt: true,
      supportsImageInput: true,
      supportsSeed: true,
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
      maxOutputs: 4,
      operations: [
        "text-to-image",
        "image-to-image",
        "upscale",
        "remove-background",
        "variations",
      ],
    },
  },
];

const FAIL_ON_SUBMIT = 0.1;
const FAIL_WHILE_RUNNING = 0.05;

interface MockJob {
  request: GenerationRequest;
  startedAt: number;
  durationMs: number;
  failsAt: number | null;
}

const jobs = new Map<string, MockJob>();

/** Deterministic hue from the seed, so a repeated seed previews identically. */
function hueFor(seed: number, index: number) {
  return (seed * 7 + index * 53) % 360;
}

/**
 * A data-URL SVG standing in for a generated image.
 *
 * SVG rather than a raster: it is a few hundred bytes, needs no image library
 * on the server, and the pipeline stores it exactly like any other output — so
 * the storage path is genuinely exercised.
 */
function placeholderImage(
  hue: number,
  width: number,
  height: number,
  label: string,
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="hsl(${hue} 70% 55%)"/>
<stop offset="55%" stop-color="hsl(${(hue + 55) % 360} 65% 38%)"/>
<stop offset="100%" stop-color="hsl(${(hue + 300) % 360} 60% 18%)"/>
</linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="4%" y="94%" font-family="sans-serif" font-size="${Math.max(12, Math.round(width / 42))}" fill="rgba(255,255,255,0.78)">Mock provider — not AI generated · ${label}</text>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function dimensions(request: GenerationRequest) {
  if (request.width && request.height) {
    return { width: request.width, height: request.height };
  }
  const [w, h] = (request.aspectRatio ?? "1:1").split(":").map(Number);
  const longest = 1024;
  return w >= h
    ? { width: longest, height: Math.round((longest * h) / w) }
    : { width: Math.round((longest * w) / h), height: longest };
}

export const mockProvider: AIProvider = {
  id: "mock",
  displayName: "Mock (no provider configured)",

  // Always available. It is the fallback precisely for the case where nothing
  // else is.
  isConfigured: () => true,

  listModels: () => MODELS,

  async submit(request) {
    if (Math.random() < FAIL_ON_SUBMIT) {
      throw providerError(
        "provider_unavailable",
        "The mock provider rejected this request (simulated failure).",
        { retryable: true },
      );
    }

    const id = `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // Upscaling and background removal are quick; generation is not.
    const durationMs =
      request.operation === "upscale" ||
      request.operation === "remove-background"
        ? 1500
        : 4000;

    jobs.set(id, {
      request,
      startedAt: Date.now(),
      durationMs,
      failsAt:
        Math.random() < FAIL_WHILE_RUNNING
          ? Date.now() + durationMs * 0.6
          : null,
    });

    return { providerJobId: id, state: "queued", progress: 0 };
  },

  async poll(providerJobId) {
    const job = jobs.get(providerJobId);

    if (!job) {
      return {
        providerJobId,
        state: "failed",
        error: providerError("timeout", "That job is no longer available."),
      };
    }

    const elapsed = Date.now() - job.startedAt;

    if (job.failsAt !== null && Date.now() >= job.failsAt) {
      jobs.delete(providerJobId);
      return {
        providerJobId,
        state: "failed",
        error: providerError(
          "unknown",
          "The mock provider failed mid-run (simulated failure).",
        ),
      };
    }

    if (elapsed < job.durationMs) {
      return {
        providerJobId,
        state: elapsed < 500 ? "queued" : "running",
        progress: Math.min(0.99, elapsed / job.durationMs),
      };
    }

    const { width, height } = dimensions(job.request);
    const seed = job.request.seed ?? 1;
    const count =
      job.request.operation === "upscale" ||
      job.request.operation === "remove-background"
        ? 1
        : (job.request.outputs ?? 1);

    jobs.delete(providerJobId);

    return {
      providerJobId,
      state: "succeeded",
      progress: 1,
      outputs: Array.from({ length: count }, (_, index) => {
        const scaled =
          job.request.operation === "upscale"
            ? {
                width: width * (job.request.scale ?? 2),
                height: height * (job.request.scale ?? 2),
              }
            : { width, height };

        return {
          sourceUrl: placeholderImage(
            hueFor(seed, index),
            scaled.width,
            scaled.height,
            job.request.operation,
          ),
          mimeType: "image/svg+xml",
          width: scaled.width,
          height: scaled.height,
          seed: seed + index,
        };
      }),
    };
  },

  async cancel(providerJobId) {
    jobs.delete(providerJobId);
  },
};
