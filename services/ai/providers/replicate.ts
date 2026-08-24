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
/**
 * The Veo 3.1 tiers, behind a flag that is off everywhere.
 *
 * All three are callable today — the existing Replicate token reaches them, and
 * their schemas were read on 2026-08-22. They are gated because their **real
 * invoice rate is unverified**: Google publishes $0.10-$0.40 per second, and
 * Replicate's margin on top of that is not exposed by its API and could not be
 * read from the model pages. Offering them to customers at a price never checked
 * against a bill is how a catalogue ends up losing money on its best feature.
 *
 * Set `ENABLE_VEO_31=1` to exercise them. Do that only after the approved
 * benchmark has produced an invoice line to price against.
 */
/**
 * The Veo family, by id.
 *
 * Declared outside the flag-gated array so `videoShape` can recognise a Veo
 * request whether or not the flag is on — the adapter's job is to know what a
 * model's schema takes, and that does not change with a feature flag.
 */
const VEO_MODEL_IDS = new Set([
  "replicate/veo-3.1",
  "replicate/veo-3.1-fast",
  "replicate/veo-3.1-lite",
]);

const VEO_MODELS: (ProviderModel & { version: string })[] =
  env.ENABLE_VEO_31 === "1"
    ? [
        {
          id: "replicate/veo-3.1-fast",
          providerId: "replicate",
          displayName: "Cinematic Fast",
          modality: "VIDEO",
          /**
           * 360, not 288.
           *
           * `creditCost` is the price at the model's **base** duration; the
           * charge then scales by `durationSeconds / min(durations)` in
           * `services/ai/pricing.ts`. So the floor has to hold at 4 seconds and
           * the multiplier carries it to 8.
           *
           * At 4s with audio Replicate charges $0.15/s = $0.60. 288 credits is
           * $1.44, which is 2.40x against a 3.0x video floor — the only Veo
           * tier that was actually underpriced. 4s x $0.15 x 3.0 / $0.005 = 360,
           * which charges 720 at 8s and holds exactly 3.00x there too.
           */
          creditCost: 360,
          version:
            "ba987aceebef53bebfede32973f842fe3aa2301bf2585878181e7a7677052e36",
          capabilities: {
            supportsNegativePrompt: true,
            supportsImageInput: true,
            supportsSeed: true,
            aspectRatios: ["16:9", "9:16"],
            maxOutputs: 1,
            durations: [4, 6, 8],
            maxDurationSeconds: 8,
            cameraMotions: CAMERA_MOTIONS,
            operations: ["text-to-video", "image-to-video"],
          },
        },
        {
          id: "replicate/veo-3.1",
          providerId: "replicate",
          displayName: "Cinematic",
          modality: "VIDEO",
          // 4s x $0.40 with audio x 3.0 / $0.005 = 960, scaling to 1,920 at 8s.
          creditCost: 960,
          version:
            "9c6ca0c25d89ac6102278405a0673fd929b7793856870d2718e3a84a5aa4ad4d",
          capabilities: {
            supportsNegativePrompt: true,
            supportsImageInput: true,
            supportsSeed: true,
            aspectRatios: ["16:9", "9:16"],
            maxOutputs: 1,
            durations: [4, 6, 8],
            maxDurationSeconds: 8,
            cameraMotions: CAMERA_MOTIONS,
            operations: ["text-to-video", "image-to-video"],
          },
        },
        {
          id: "replicate/veo-3.1-lite",
          providerId: "replicate",
          displayName: "Cinematic Lite",
          modality: "VIDEO",
          // 4s at 1080p ($0.08/s, the dearer rung) = $0.32. x3.0 / $0.005 = 192.
          creditCost: 192,
          version:
            "fe0ac882f170a9ee79aa4940abe83fa09f68b1e074cde15c7693a1e2728a9558",
          capabilities: {
            // Its schema is seed, image, prompt, duration, last_frame,
            // resolution, aspect_ratio — and nothing else. No negative prompt.
            supportsNegativePrompt: false,
            supportsImageInput: true,
            supportsSeed: true,
            aspectRatios: ["16:9", "9:16"],
            maxOutputs: 1,
            durations: [4, 6, 8],
            maxDurationSeconds: 8,
            cameraMotions: CAMERA_MOTIONS,
            operations: ["text-to-video", "image-to-video"],
          },
        },
      ]
    : [];

/**
 * Models whose input shape is the Google image schema rather than the FLUX one.
 *
 * A set rather than a capability flag because it is not a capability — it is
 * which field names the provider parses, and two models with identical
 * capabilities can still disagree about that.
 */
const NANO_BANANA_MODELS = new Set([
  "replicate/nano-banana-2",
  "replicate/nano-banana-pro",
]);

/**
 * Smart Image and Pro Image, behind `ENABLE_SMART_IMAGE`.
 *
 * ## Why these two and not the obvious third
 *
 * `black-forest-labs/flux-2-pro` was audited alongside them and is deliberately
 * absent. Its price is `$0.015/run + $0.015 per input megapixel + $0.015 per
 * output megapixel`, and the input term is chosen by the customer — four 4MP
 * references add $0.24 to a job quoted from the output size alone. A flat
 * credit price for that is a guess, and an unknown cost cannot be sold. See
 * `services/ai/image-capabilities.ts`, which keeps the audited figures next to
 * the decision not to use them.
 *
 * ## Both prices come from the provider's published table
 *
 *   nano-banana-2    1K $0.067   2K $0.101   4K $0.151   per output image
 *   nano-banana-pro  1K $0.150   2K $0.150   4K $0.300   per output image
 *
 * The `creditCost` below is the 2K figure, because 2K is what Atheos asks for.
 * Per-resolution pricing lives in `image-capabilities.ts`; this field is the
 * catalogue's single-number estimate and must not be the one that bills.
 */
const SMART_IMAGE_MODELS: (ProviderModel & { version: string })[] =
  env.ENABLE_SMART_IMAGE === "1"
    ? [
        {
          id: "replicate/nano-banana-2",
          providerId: "replicate",
          displayName: "Smart Image",
          modality: "IMAGE",
          // 2K: $0.101 x 2.72 margin at $0.005/credit.
          creditCost: 55,
          version:
            "d1be8b5fc0931a253d417e12a484ac01ee9ccbc6daffd4792151377d5e5ff55f",
          capabilities: {
            // Schema inputs are exactly: prompt, image_input, aspect_ratio,
            // resolution, output_format, google_search, image_search.
            supportsNegativePrompt: false,
            supportsImageInput: true,
            supportsSeed: false,
            aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
            maxOutputs: 1,
            operations: ["text-to-image", "image-to-image"],
          },
        },
        {
          id: "replicate/nano-banana-pro",
          providerId: "replicate",
          displayName: "Pro Image",
          modality: "IMAGE",
          creditCost: 80,
          version:
            "93f55bfdbdfd4a62e16bf861729bcfa9e8fd9b0325fb218cbc4dd138ecc87cc7",
          capabilities: {
            supportsNegativePrompt: false,
            supportsImageInput: true,
            supportsSeed: false,
            aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
            maxOutputs: 1,
            operations: ["text-to-image", "image-to-image"],
          },
        },
      ]
    : [];

const MODELS: (ProviderModel & { version: string })[] = [
  ...SMART_IMAGE_MODELS,
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
    // 13, not 12, since Sprint 4. At 12 the worst-case margin was 2.4x against
    // a 2.5x floor — thin rather than negative, and thinner than the plan
    // allowances were built on. `services/billing/model-costs.ts` holds the
    // arithmetic and `tests/unit/model-costs.test.ts` is what caught it.
    creditCost: 13,
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
    // wan-2.2-t2v-fast. Kept as the *fast* option after measuring the
    // alternative: Seedance renders better video and takes 5-7x longer
    // (568s at 720p, 877s at 1080p, against 118s here). For a sequence of ten
    // clips that is 95 minutes versus 20.
    version: "c483b1f7b892065bc58ebadb6381abf557f6b1f517d2ff0febb3fb635cf49b4d",
    capabilities: {
      /**
       * Both false, and both were true until Sprint 5D read the schema.
       *
       * wan-2.2-t2v-fast accepts prompt, seed, num_frames, frames_per_second,
       * resolution, aspect_ratio, go_fast, interpolate_output, sample_shift,
       * optimize_prompt, disable_safety_checker and four lora_* fields. There
       * is no `image` and no `negative_prompt` — the `t2v` in the slug is the
       * whole story.
       *
       * The consequence was not cosmetic: `buildInput` sends `image` whenever
       * a reference was attached and `negative_prompt` whenever the flag said
       * it could, so a user who used either got a rejected job on a model that
       * had already reserved 90 credits.
       */
      supportsNegativePrompt: false,
      supportsImageInput: false,
      supportsSeed: true,
      aspectRatios: ["16:9", "9:16"],
      // One clip per run. Video is slow and expensive enough that batching
      // four is a bill nobody asked for.
      maxOutputs: 1,
      // The model's two real lengths at 16fps: 81 and 121 frames. Not 5 and
      // 10 — see videoFrames().
      durations: [5, 7.5],
      maxDurationSeconds: 7.5,
      cameraMotions: CAMERA_MOTIONS,
      // Text-to-video only. Motion Pro keeps image-to-video, which its schema
      // genuinely supports through `image` and `last_frame_image`.
      operations: ["text-to-video"],
    },
  },
  {
    id: "replicate/video-pro",
    providerId: "replicate",
    displayName: "Motion Pro",
    modality: "VIDEO",
    // Twice the fast model. Provisional: it renders 5-7x longer, and until the
    // Replicate invoice is checked nobody knows whether that is billed as GPU
    // time or as output seconds. If it is GPU time this is under-priced.
    creditCost: 180,
    // bytedance/seedance-1-lite, 3.6M runs.
    version: "6e47dd83529ee0599c68f274f225635080e4fd218360a85e2a3a78396d388b73",
    capabilities: {
      // Seedance takes no negative prompt. Declaring it here is what stops the
      // studio offering a field the model ignores.
      supportsNegativePrompt: false,
      supportsImageInput: true,
      supportsSeed: true,
      aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
      maxOutputs: 1,
      durations: [5, 10, 12],
      maxDurationSeconds: 12,
      cameraMotions: CAMERA_MOTIONS,
      operations: ["text-to-video", "image-to-video"],
    },
  },
  {
    id: "replicate/music",
    providerId: "replicate",
    displayName: "Score",
    modality: "AUDIO",
    // Cheap next to video and not free: musicgen is a real GPU minute. Priced
    // between an image and a clip, which is where it sits on cost.
    creditCost: 20,
    // meta/musicgen.
    version: "671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb",
    capabilities: {
      supportsNegativePrompt: false,
      supportsImageInput: false,
      supportsSeed: true,
      // Audio has no aspect ratio. Empty rather than absent so the studio
      // renders no control instead of an empty dropdown.
      aspectRatios: [],
      maxOutputs: 1,
      // A continuous range in the model, but offered as steps for the same
      // reason the video models are: a slider whose positions are silently
      // rounded charges people for something they did not choose.
      durations: [8, 15, 30],
      maxDurationSeconds: 30,
      operations: ["text-to-audio"],
    },
  },
  {
    id: "replicate/sfx",
    providerId: "replicate",
    displayName: "Foley",
    modality: "AUDIO",
    // Shorter clips and a smaller model than Score.
    creditCost: 10,
    // sepal/audiogen — sound effects rather than music. A separate model
    // because musicgen asked for "a door slamming" returns music *about* a
    // door slamming, which is not what anybody scoring a video wants.
    version: "154b3e5141493cb1b8cec976d9aa90f2b691137e39ad906d2421b74c2a8c52b8",
    capabilities: {
      supportsNegativePrompt: false,
      supportsImageInput: false,
      supportsSeed: true,
      aspectRatios: [],
      maxOutputs: 1,
      durations: [3, 5, 8],
      maxDurationSeconds: 8,
      operations: ["text-to-audio"],
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

// Appended rather than inlined so the flagged tier is one obvious block that
// can be read, benchmarked and removed as a unit.
MODELS.push(...VEO_MODELS);

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
/**
 * Frame count for a requested duration, for the wan model.
 *
 * It expresses length in frames at 16fps and accepts 81-121 — about 5 to 7.5
 * seconds. Sending 161 for a "10s" request fails outright, which is a bug this
 * file has already had once.
 */
/**
 * wan-2.2 takes a frame count, not seconds, and runs at 16fps.
 *
 * The two lengths it can actually produce are **81 frames (5.06s)** and
 * **121 frames (7.56s)** — 121 is the model's hard ceiling. The catalogue used
 * to advertise 5 and 10 seconds, so somebody choosing "10 seconds" paid twice
 * the five-second price and received 7.5 seconds. A measured clip is 5.07s and
 * 10.13s for two of them, which is where this was caught.
 *
 * The catalogue now offers 5 and 7.5, and the credit multiplier follows the
 * real ratio.
 */
function videoFrames(durationSeconds: number | undefined): number {
  return durationSeconds && durationSeconds > 5 ? 121 : 81;
}

/**
 * The length/resolution shape each video family actually accepts.
 *
 * ## Why this is a function and not a ternary
 *
 * It was a ternary: `video-pro` got seconds, and **everything else** got
 * `num_frames` at 720p. That "everything else" silently included all three Veo
 * models, whose schema has no `num_frames` field at all — it takes `duration`
 * from the enum [4, 6, 8] plus `generate_audio`. Enabling `ENABLE_VEO_31` would
 * therefore have sent every Veo job a parameter the model cannot parse, and the
 * provider would have rejected it *after* the credits were reserved.
 *
 * That is the same defect class as the `image` field on Motion 1, and the same
 * lesson: a default branch in an adapter is a promise that every future model
 * looks like the one it was written for.
 */
function videoShape(
  request: GenerationRequest,
  model: ProviderModel,
): Record<string, unknown> {
  const aspect = request.aspectRatio === "9:16" ? "9:16" : "16:9";

  if (VEO_MODEL_IDS.has(model.id)) {
    /**
     * Veo takes whole seconds from a fixed enum. A request for 5s has to become
     * one of 4, 6 or 8 — snapping *down* so the customer is never billed for a
     * second they did not ask for.
     */
    const allowed = model.capabilities.durations ?? [4, 6, 8];
    const wanted = request.durationSeconds ?? 8;
    const duration =
      [...allowed].sort((a, b) => b - a).find((d) => d <= wanted) ??
      Math.min(...allowed);

    return {
      duration,
      aspect_ratio: aspect,
      resolution: request.videoResolution === "1080p" ? "1080p" : "720p",
      /**
       * Audio is the model's own default and the reason these tiers exist.
       * Sent explicitly rather than relied upon: `veo-3.1-lite` cannot turn it
       * off at all, and a silent request has to be a refusal upstream rather
       * than a flag the provider quietly ignores.
       */
      generate_audio: request.generateAudio ?? true,
    };
  }

  if (model.id === "replicate/video-pro") {
    // Seedance: seconds, 4-12, and its own resolution ladder.
    return {
      duration: Math.min(12, Math.max(4, request.durationSeconds ?? 5)),
      aspect_ratio: request.aspectRatio ?? "16:9",
      resolution: "1080p",
      fps: 24,
    };
  }

  // wan-2.2: length is frames at 16fps, 81-121.
  return {
    num_frames: videoFrames(request.durationSeconds),
    aspect_ratio: aspect,
    resolution: "720p",
  };
}

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
        /**
         * The capability check is the condition, not the presence of a URL.
         *
         * This used to be `source ? { image: source } : {}`. Motion 1 is
         * `wan-2.2-t2v-fast` and its schema has no `image` field at all, so a
         * reference attached to a Motion 1 job produced a provider rejection
         * *after* 90 credits had been reserved. The routing layer should refuse
         * that request long before here — but the adapter is the last place
         * that knows what the schema actually has, and it should not be able to
         * send a field the model cannot parse even if something upstream slips.
         */
        ...(source && model.capabilities.supportsImageInput
          ? { image: source }
          : {}),
        ...videoShape(request, model),
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
      };

    case "text-to-audio":
      return {
        prompt: request.prompt,
        duration: request.durationSeconds ?? 8,
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
        ...(model.id === "replicate/music"
          ? {
              // Stereo, and the large weights: this is background score for
              // video, and mono music under a widescreen clip sounds like a
              // mistake rather than a choice.
              model_version: "stereo-large",
              output_format: "mp3",
              normalization_strategy: "peak",
            }
          : {}),
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
      /**
       * The Google image models take a different set of fields entirely.
       *
       * `nano-banana-2` and `nano-banana-pro` accept prompt, aspect_ratio,
       * resolution, image_input and output_format — and *not* seed, not
       * num_outputs, not negative_prompt. Falling through to the FLUX shape
       * below would send three fields the schema has never heard of, which is
       * the same class of failure as `image` on Motion 1.
       */
      if (NANO_BANANA_MODELS.has(model.id)) {
        return {
          prompt: request.prompt,
          ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
          // The provider default is 1K on nano-banana-2. Atheos asks for the
          // brief's resolution, and the compiler has already reconciled it
          // against what this model offers.
          resolution: request.imageResolution ?? "2K",
          ...(request.inputImageUrls && request.inputImageUrls.length > 0
            ? { image_input: request.inputImageUrls }
            : {}),
          output_format: "png",
        };
      }

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
