import { describe, expect, it } from "vitest";

import {
  catalogueModelId,
  toPublicGenerationFrom,
  toPublicModel,
} from "@/features/studio/lib/public-model";
import { toStudioModel } from "@/features/studio/lib/dto";
import type { ProviderModel } from "@/services/ai/types";

/**
 * The contract a browser receives.
 *
 * ## Measured before it was changed
 *
 * The live `/api/generations` response carried **56 occurrences of
 * "replicate"** — on every model and every generation. These assertions are
 * written against the exact shapes that endpoint now returns, so the count
 * cannot drift back up without a test failing.
 *
 * ## Why the whole object is searched rather than named fields
 *
 * Asserting `providerId === undefined` only proves that one field was handled.
 * Serialising the object and searching it proves the property that actually
 * matters: whatever fields exist, none of them says who runs the job.
 */

const VENDORS =
  /replicate|openai|google|black-forest|bytedance|wan-video|veo|flux|seedance|musicgen|mmaudio/i;

const providerModel = (over: Partial<ProviderModel> = {}): ProviderModel =>
  ({
    id: "replicate/veo-3.1-fast",
    providerId: "replicate",
    displayName: "Cinematic Fast",
    modality: "VIDEO",
    creditCost: 360,
    capabilities: {
      operations: ["text-to-video"],
      supportsImageInput: true,
      supportsNegativePrompt: true,
      supportsSeed: true,
      maxOutputs: 1,
      aspectRatios: ["16:9", "9:16"],
      durations: [4, 6, 8],
      maxDurationSeconds: 8,
    },
    ...over,
  }) as unknown as ProviderModel;

describe("the model contract", () => {
  const publicModel = toPublicModel(toStudioModel(providerModel()));

  it("names no vendor anywhere in the serialised object", () => {
    expect(JSON.stringify(publicModel)).not.toMatch(VENDORS);
  });

  it("carries no provider infrastructure fields", () => {
    for (const field of [
      "providerId",
      "providerName",
      "provider",
      "predictionId",
      "versionHash",
      "costMicroUsd",
      "providerCost",
    ]) {
      expect(field in publicModel, field).toBe(false);
    }
  });

  it("carries the fields the interface actually needs", () => {
    // A contract that leaks nothing but says nothing is not an improvement.
    for (const field of [
      "id",
      "displayName",
      "modality",
      "qualityTier",
      "creditCost",
      "durations",
      "aspectRatios",
      "audio",
      "audioNote",
      "takesReference",
      "typicalWait",
      "availability",
    ]) {
      expect(field in publicModel, field).toBe(true);
    }
  });

  it("states audio capability, which the old contract could not", () => {
    expect(publicModel.audio).toBe("native");

    const motion = toPublicModel(
      toStudioModel(
        providerModel({ id: "replicate/video-gen", displayName: "Motion 1" }),
      ),
    );
    expect(motion.audio).toBe("silent");
    expect(motion.audioNote).toMatch(/no audio track/i);
  });

  it("gives a wait range rather than a single number that reads as a promise", () => {
    expect(publicModel.typicalWait.maxSeconds).toBeGreaterThan(
      publicModel.typicalWait.minSeconds,
    );
  });
});

describe("the generation contract", () => {
  const dto = {
    id: "gen_1",
    status: "succeeded",
    operation: "TEXT_TO_VIDEO",
    modelId: "replicate/veo-3.1-fast",
    prompt: "a wolf in a forest",
    negativePrompt: null,
    creditCost: 720,
    error: null,
    createdAt: 0,
    completedAt: 1,
    parameters: {
      aspectRatio: "16:9",
      durationSeconds: 8,
      // Internal fields an older version wrote. Must not survive.
      providerJobId: "a3n0abcd1234",
      providerModel: "google/veo-3.1-fast",
      costMicroUsd: 1_200_000,
    },
    outputs: [],
  };

  const publicGeneration = toPublicGenerationFrom(dto);

  it("replaces the provider-prefixed model id", () => {
    expect(publicGeneration.modelId).toBe("cinematic-fast");
    expect(publicGeneration.modelId).not.toMatch(VENDORS);
  });

  it("carries the friendly name so history need not resolve it", () => {
    expect(publicGeneration.modelName).toBe("Cinematic Fast");
  });

  it("drops unrecognised stored parameters rather than passing them through", () => {
    /**
     * `parameters` is a blob written by older code and can carry anything. It
     * is filtered against a known-safe list, so a field added years ago cannot
     * become a disclosure today.
     */
    const parameters = publicGeneration.parameters!;

    expect(parameters.aspectRatio).toBe("16:9");
    expect("providerJobId" in parameters).toBe(false);
    expect("providerModel" in parameters).toBe(false);
    expect("costMicroUsd" in parameters).toBe(false);
  });

  it("names no vendor anywhere in the serialised generation", () => {
    expect(JSON.stringify(publicGeneration)).not.toMatch(VENDORS);
  });

  it("resolves a historical generation to the right public name", () => {
    // A video made months ago still reads correctly, because the mapping is by
    // catalogue id rather than by anything stored at generation time.
    const old = toPublicGenerationFrom({
      ...dto,
      modelId: "replicate/flux-dev",
    });

    expect(old.modelName).toBe("Atheos Image Realistic");
    expect(old.modelId).toBe("atheos-image-realistic");
  });
});

describe("what the server accepts from a client", () => {
  it("resolves a public id to its catalogue model", () => {
    expect(catalogueModelId("cinematic-fast")).toBe("replicate/veo-3.1-fast");
  });

  it("refuses an internal path, so it cannot stay a working input", () => {
    /**
     * A client sending `replicate/veo-3.1` is an old build or someone probing.
     * Accepting it would keep the internal path valid forever, which is exactly
     * what makes a provider swap a breaking change.
     */
    expect(catalogueModelId("replicate/veo-3.1-fast")).toBeNull();
    expect(catalogueModelId("replicate/video-gen")).toBeNull();
  });

  it("refuses an unknown id rather than guessing", () => {
    expect(catalogueModelId("../../etc/passwd")).toBeNull();
    expect(catalogueModelId("")).toBeNull();
  });
});
