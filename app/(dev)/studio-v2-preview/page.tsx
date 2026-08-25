import type { Metadata } from "next";

import { StudioV2 } from "@/features/studio/components/v2/studio-v2";
import type { PublicStudioModel } from "@/features/studio/lib/public-model";

export const metadata: Metadata = {
  title: "Studio V2 preview",
  robots: { index: false, follow: false },
};

/**
 * Studio V2, on fixtures.
 *
 * ## Why a preview route rather than screenshotting the real Studio
 *
 * The real one needs a Clerk session, an admin role and the beta flag, and its
 * history is whatever the owner happens to have generated — so a screenshot of
 * it changes every time somebody makes a video, and a visual regression would
 * be indistinguishable from new work appearing.
 *
 * These fixtures are fixed, so a diff between two runs is a change in the
 * interface and nothing else.
 *
 * The `(dev)` group answers 404 in production, which is what makes it safe for
 * this to render a signed-in surface with the gate bypassed.
 *
 * ## The models are the real public contract
 *
 * Built by hand here rather than fetched, but to `PublicStudioModel` — so if
 * the contract gains a provider field, this stops compiling. A fixture that
 * drifts from the type it imitates is worse than no fixture.
 */

const MODELS: PublicStudioModel[] = [
  {
    id: "atheos-image-fast",
    displayName: "Atheos Image Fast",
    modality: "IMAGE",
    description: "Fast drafts and iterating before committing.",
    creditCost: 4,
    typicalSeconds: 12,
    capabilities: {
      operations: ["text-to-image"],
      supportsImageInput: false,
      supportsNegativePrompt: false,
      supportsSeed: true,
      maxOutputs: 4,
      aspectRatios: ["1:1", "16:9", "9:16"],
    } as PublicStudioModel["capabilities"],
    audio: "not_applicable",
    audioNote: "",
    takesReference: false,
    qualityTier: "draft",
    durations: [],
    aspectRatios: ["1:1", "16:9", "9:16"],
    resolutions: ["1K", "2K"],
    typicalWait: { minSeconds: 7, maxSeconds: 19 },
    availability: "available",
  },
  {
    id: "motion-1",
    displayName: "Motion 1",
    modality: "VIDEO",
    description: "A short clip from a written description.",
    creditCost: 90,
    typicalSeconds: 300,
    capabilities: {
      operations: ["text-to-video"],
      supportsImageInput: false,
      supportsNegativePrompt: false,
      supportsSeed: true,
      maxOutputs: 1,
      aspectRatios: ["16:9", "9:16"],
      durations: [5, 7.5],
    } as PublicStudioModel["capabilities"],
    // The line the Studio could not previously show at all.
    audio: "silent",
    audioNote: "Silent — the finished video has no audio track.",
    takesReference: false,
    qualityTier: "standard",
    durations: [5, 7.5],
    aspectRatios: ["16:9", "9:16"],
    resolutions: [],
    typicalWait: { minSeconds: 180, maxSeconds: 480 },
    availability: "available",
  },
  {
    id: "score",
    displayName: "Foley",
    modality: "AUDIO",
    description: "Background score for a clip.",
    creditCost: 20,
    typicalSeconds: 40,
    capabilities: {
      operations: ["text-to-audio"],
      supportsImageInput: false,
      supportsNegativePrompt: false,
      supportsSeed: true,
      maxOutputs: 1,
      aspectRatios: [],
      durations: [30],
    } as PublicStudioModel["capabilities"],
    audio: "native",
    audioNote: "Generates sound as its output.",
    takesReference: false,
    qualityTier: "standard",
    durations: [30],
    aspectRatios: [],
    resolutions: [],
    typicalWait: { minSeconds: 24, maxSeconds: 64 },
    availability: "available",
  },
];

/**
 * History with a deliberately punishing prompt.
 *
 * The 600-character entry is the fixture that matters: the old rail rendered
 * whole prompts, so three of these filled it and the fourth was below the
 * fold. If truncation ever regresses, this screenshot shows it immediately.
 */
const HISTORY = [
  {
    id: "gen_1",
    modelName: "Atheos Image Fast",
    prompt: "A red dragon on a castle breathing fire",
    status: "succeeded",
    createdAt: Date.parse("2026-08-24T18:30:00Z"),
  },
  {
    id: "gen_2",
    modelName: "Motion 1",
    prompt:
      "A cinematic establishing shot of a coastal road at golden hour, " +
      "camera tracking a vintage convertible from a slightly elevated angle, " +
      "the ocean glittering to the left and cliffs rising to the right, " +
      "warm rim light on the bodywork, shallow depth of field, volumetric haze, " +
      "the horizon held level throughout and the whole coastline visible in frame " +
      "without any part of it being cropped away by the edges of the picture.",
    status: "succeeded",
    createdAt: Date.parse("2026-08-24T17:05:00Z"),
  },
  {
    id: "gen_3",
    modelName: "Foley",
    prompt: "Slow ambient pads",
    status: "failed",
    createdAt: Date.parse("2026-08-24T16:40:00Z"),
  },
];

export default function StudioV2PreviewPage() {
  return (
    <StudioV2
      models={MODELS}
      creditBalance={14_890}
      history={HISTORY}
      projectName="Coastal campaign"
    />
  );
}
