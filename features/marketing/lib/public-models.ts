import "server-only";

import {
  AUDIO_CAPABILITIES,
  type AudioStrategy,
} from "@/services/ai/audio-strategy";
import { MODEL_CAPABILITIES } from "@/services/ai/brief-routing";
import { listModels } from "@/services/ai/registry";
import { isPubliclyOffered } from "@/services/ai/model-policy";
import { isModelEnabled } from "@/services/billing/model-costs";
import type { Modality } from "@/lib/generated/prisma/enums";

/**
 * What Atheos may say publicly about a model.
 *
 * ## Why this derives rather than describes
 *
 * A marketing page that keeps its own list of models is a list that goes stale
 * silently. The failure is not cosmetic: it advertises a model nobody can
 * select, quotes a price that has moved, or — the one that actually happened on
 * the video side — promises audio a model has no capability to produce.
 *
 * So every fact here is read from the same sources the studio and the invoice
 * read:
 *
 *   `listModels()`            the registry, which is feature-flag aware
 *   `isModelEnabled()`        the cost table, which refuses unpriced models
 *   `AUDIO_CAPABILITIES`      audited per-model audio, from provider schemas
 *
 * ## Two gates, not one
 *
 * A model must pass **both** to be shown. They are genuinely different
 * questions and they disagree today: `nano-banana-2` is `enabled: true` in the
 * cost table and absent from the registry because `ENABLE_SMART_IMAGE` is off.
 * Publishing it would advertise something no visitor can select.
 *
 * Mock models are excluded outright — they exist so the pipeline can run
 * without provider credentials, and they are not a product.
 */

export interface PublicModel {
  /** Catalogue id. Used to preselect the model in Studio. */
  id: string;
  /** URL-safe slug for `/models/[slug]`. */
  slug: string;
  /** Customer-facing name, from the registry. Never a provider slug. */
  name: string;
  modality: Modality;
  /** What it is good at, in one line. */
  bestFor: string;
  credits: number;
  /** Seconds, typical. Null when we have not measured it. */
  estimatedSeconds: number | null;
  supportsReferenceImage: boolean;
  /** Longest clip, for video. Null for stills. */
  maxDurationSeconds: number | null;
  aspectRatios: readonly string[];
  /**
   * How sound happens, if at all.
   *
   * `native` only when the provider's own schema produces it.
   *
   * Motion 1 and Motion Pro are `atheos`, which today means **silent**: the
   * video model produces no sound and the mix step that would add some has
   * never been built. The label is kept rather than renamed to `silent` so the
   * distinction survives — these are models that *could* take a mix, unlike a
   * model with no audio path at all — but nothing user-facing may promise that
   * mix until it exists.
   */
  audio: "native" | "atheos" | "silent" | "n/a";
  /** One honest thing it cannot do. Never marketing softening. */
  limitation: string;
}

/** Copy that is a product decision, keyed by catalogue id. */
const EDITORIAL: Record<string, { bestFor: string; limitation: string }> = {
  "replicate/flux-schnell": {
    bestFor: "Fast drafts and iterating on an idea before committing to it.",
    limitation:
      "Renders about one megapixel and takes no reference image, so it cannot continue an existing picture.",
  },
  "replicate/flux-dev": {
    bestFor: "A more considered still, or a variation on a picture you have.",
    limitation:
      "Renders about one megapixel, and a reference is a starting point rather than a subject it will keep identical.",
  },
  "openai/gpt-image-1": {
    bestFor: "Pictures that need text in them rendered correctly.",
    limitation: "Slower than the draft tiers, and priced accordingly.",
  },
  "replicate/real-esrgan": {
    bestFor: "Enlarging a picture you already have without softening it.",
    limitation: "Takes no prompt — it enlarges, it does not reinterpret.",
  },
  "replicate/remove-bg": {
    bestFor: "Cutting a subject out of its background.",
    limitation: "Takes no prompt, and struggles with fine hair and glass.",
  },
  "replicate/video-gen": {
    bestFor: "A short clip from a written description.",
    limitation:
      "Text only — it cannot animate a picture you supply. Silent: no native audio, and Atheos sound mix is not currently available.",
  },
  "replicate/video-pro": {
    bestFor:
      "Longer clips, higher resolution, and motion that starts from a picture.",
    limitation:
      "Produces no sound of its own. Atheos sound mix is not currently available.",
  },
  /**
   * No audio entry, on purpose.
   *
   * `replicate/sfx` sat here promising "individual sound effects and short
   * ambiences" until 3 September 2026. It resolves to `sepal/audiogen`, whose
   * weights are CC-BY-NC 4.0, so it is `BLOCKED_COMMERCIAL` and
   * `isPubliclyOffered` already keeps it out of the list this copy annotates.
   * The line is deleted rather than left inert: dead editorial copy is how a
   * withdrawn model gets re-advertised the day somebody re-enables it.
   */
};

/** How sound happens for a model, read from the audited capability table. */
function audioFor(id: string, modality: Modality): PublicModel["audio"] {
  if (modality === "AUDIO") return "native";
  if (modality !== "VIDEO") return "n/a";

  const capability = AUDIO_CAPABILITIES[id];
  if (!capability) return "silent";

  const strategies: readonly AudioStrategy[] = capability.strategies;
  if (strategies.includes("NATIVE")) return "native";
  if (strategies.includes("ATHEOS_SOUND_DESIGN")) return "atheos";
  return "silent";
}

/** `replicate/video-pro` -> `video-pro`. Stable, and never a provider slug. */
export function slugFor(id: string): string {
  return id.split("/").slice(1).join("-");
}

/**
 * Every model Atheos may advertise, right now, with the flags as they are.
 *
 * Recomputed per call rather than cached in a module constant: the registry
 * reads feature flags, and a constant would freeze whichever state happened to
 * exist when the module first loaded.
 */
export function publicModels(): PublicModel[] {
  return (
    listModels()
      .filter((model) => !model.id.startsWith("mock/"))
      .filter((model) => isModelEnabled(model.id))
      /**
       * Licence policy, not a feature flag.
       *
       * A model page is a sales page: it names a price and invites a signup.
       * Listing one we are not licensed to run commercially is the same
       * misrepresentation as selling it, so the registry filters here too
       * rather than only at submission.
       */
      .filter((model) => isPubliclyOffered(model.id))
      // A model with no editorial copy is one nobody has decided how to
      // describe. Better absent than described by its slug.
      .filter((model) => EDITORIAL[model.id])
      .map((model) => {
        const editorial = EDITORIAL[model.id];
        const capabilities = model.capabilities;

        return {
          id: model.id,
          slug: slugFor(model.id),
          name: model.displayName,
          modality: model.modality,
          bestFor: editorial.bestFor,
          credits: model.creditCost,
          /**
           * Measured, or absent.
           *
           * `ProviderModel` carries no timing, and the studio's own
           * `typicalSeconds` is a different type. The video capability table
           * has real figures because the sequence sprint measured them; for
           * everything else this is null and the page says nothing rather than
           * publishing a guess dressed as a fact.
           */
          estimatedSeconds:
            MODEL_CAPABILITIES.find((m) => m.id === model.id)
              ?.estimatedSeconds ?? null,
          supportsReferenceImage: capabilities.supportsImageInput,
          maxDurationSeconds: capabilities.maxDurationSeconds ?? null,
          aspectRatios: capabilities.aspectRatios,
          audio: audioFor(model.id, model.modality),
          limitation: editorial.limitation,
        } satisfies PublicModel;
      })
      .sort((a, b) => a.credits - b.credits)
  );
}

export function publicModelBySlug(slug: string): PublicModel | null {
  return publicModels().find((model) => model.slug === slug) ?? null;
}
