"use client";

import { useEffect } from "react";

import { StudioWorkspace } from "@/features/studio/components/studio-workspace";
import { mapInstalled } from "@/features/studio/lib/installed";
import { CATALOGUE } from "@/services/marketplace/catalogue";
import { useStudioStore } from "@/store/studio-store";
import { CAMERA_MOTIONS } from "@/services/ai/motion";
import type { StudioJob, StudioModel } from "@/features/studio/types";

/**
 * Studio preview.
 *
 * The production `StudioWorkspace`, outside the authenticated group so it can be
 * opened and exercised without a Clerk instance or a database. Same pattern as
 * `/dashboard-preview`, and the same reason: an interface that has only been
 * typechecked has not been verified.
 *
 * ## Why it now needs fixtures
 *
 * Until Sprint 6 the studio was pure client state and this page needed nothing.
 * It now bootstraps its catalogue and history from `/api/generations`, which
 * needs a signed-in user and a database — so without fixtures this page renders
 * a permanently empty composer and none of the video work can be looked at.
 *
 * The fixtures are seeded **after** mount, deliberately. Seeding during render
 * would write to the store while the server-rendered HTML says otherwise, which
 * is a hydration mismatch — a bug this codebase has already shipped once.
 *
 * ## What the fixture clip is
 *
 * `public/dev/fixture-clip.webm` is a canvas recording with "not AI generated"
 * burned into the frame. It exists so the `<video>` branch of `OutputTile` can
 * be played, scrubbed and downloaded rather than assumed to work. It is not
 * model output and this route is `noindex` via the `(dev)` layout.
 */

const FIXTURE_MODELS: StudioModel[] = [
  {
    id: "fixture/still",
    providerId: "fixture",
    providerName: "fixture",
    displayName: "Fixture Still",
    description: "4 outputs per run · reproducible with a seed",
    modality: "IMAGE",
    creditCost: 4,
    typicalSeconds: 14,
    capabilities: {
      supportsNegativePrompt: true,
      supportsImageInput: true,
      supportsSeed: true,
      aspectRatios: ["1:1", "16:9", "9:16", "4:3"],
      maxOutputs: 4,
      operations: ["text-to-image", "image-to-image", "variations"],
    },
  },
  {
    id: "fixture/motion",
    providerId: "fixture",
    providerName: "fixture",
    displayName: "Fixture Motion",
    description: "5s or 10s clips, from a prompt or a still",
    modality: "VIDEO",
    creditCost: 90,
    typicalSeconds: 150,
    capabilities: {
      supportsNegativePrompt: true,
      supportsImageInput: true,
      supportsSeed: true,
      aspectRatios: ["16:9", "9:16", "1:1"],
      maxOutputs: 1,
      durations: [5, 10],
      maxDurationSeconds: 10,
      cameraMotions: CAMERA_MOTIONS,
      operations: ["text-to-video", "image-to-video"],
    },
  },
];

const FIXTURE_HISTORY: StudioJob[] = [
  {
    id: "fixture_clip",
    status: "succeeded",
    modelName: "Fixture Motion",
    creditCost: 90,
    progress: 1,
    error: null,
    // Stamped at seed time rather than baked in, so the history entry does not
    // read "57 years ago" from a zero epoch.
    createdAt: 0,
    completedAt: 0,
    params: {
      sequenceMode: "continuous",
      modelId: "fixture/motion",
      prompt: "a paper boat drifting down a rain-slicked street at night",
      negativePrompt: "",
      presetIds: [],
      camera: { shot: null, angle: null, lens: null, lighting: null },
      aspectRatio: "16:9",
      resolution: 1080,
      creativity: 0.5,
      seed: 42,
      seedLocked: false,
      outputs: 1,
      references: [],
      durationSeconds: 5,
      cameraMotion: "slow push in",
    },
    outputs: [
      {
        id: "fixture_clip_output",
        url: "/dev/fixture-clip.webm",
        mimeType: "video/webm",
        // The real length of the recording, not the length that was requested.
        // A caption that disagrees with the file is exactly the kind of small
        // lie a fixture should not be teaching us to accept.
        durationMs: 3870,
        hue: 268,
        seed: 42,
        width: 640,
        height: 360,
      },
    ],
  },
];

export default function StudioPreviewPage() {
  const setModels = useStudioStore((state) => state.setModels);
  const setHistory = useStudioStore((state) => state.setHistory);
  const selectJob = useStudioStore((state) => state.selectJob);
  const setInstalled = useStudioStore((state) => state.setInstalled);

  useEffect(() => {
    const now = Date.now();

    setModels(FIXTURE_MODELS, false);
    setHistory(
      FIXTURE_HISTORY.map((job) => ({
        ...job,
        createdAt: now - 90_000,
        completedAt: now - 30_000,
      })),
    );
    selectJob("fixture_clip");

    // Marketplace content, seeded from the real catalogue so the composer's
    // integration can be looked at rather than only typechecked.
    //
    // Deliberately delayed. The workspace's own bootstrap calls
    // `loadInstalled()`, which in this environment returns an empty list a
    // moment later and would otherwise overwrite this. A preview that races its
    // own component is worse than one that waits.
    const timer = setTimeout(() => {
      setInstalled(
        mapInstalled(
          ["brand-launch-prompts", "film-stocks", "character-courier"].map(
            (slug) => {
              const item = CATALOGUE.find((entry) => entry.slug === slug)!;
              return {
                slug,
                kind: item.kind,
                title: item.title,
                snapshot: item.payload,
                installedAt: now,
              };
            },
          ),
        ),
      );
    }, 800);

    return () => clearTimeout(timer);
  }, [setModels, setHistory, selectJob, setInstalled]);

  return (
    <div className="flex h-dvh flex-col">
      <p className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs">
        <span className="font-medium">Preview route.</span>{" "}
        <span className="text-muted-foreground">
          The models and the clip below are fixtures, not provider output — this
          page exists so the studio can be exercised without a database.
        </span>
      </p>
      <div className="min-h-0 flex-1">
        <StudioWorkspace />
      </div>
    </div>
  );
}
