import { create } from "zustand";
import { persist } from "zustand/middleware";

import { findModelIn, resolutionOptions } from "@/features/studio/data/models";
import {
  EMPTY_INSTALLED,
  type InstalledContent,
} from "@/features/studio/lib/installed";
import { creditsFor } from "@/services/ai/pricing";
import { STYLE_PRESETS } from "@/features/studio/data/presets";
import type {
  CameraSettings,
  PromptTemplate,
  ReferenceImage,
  StudioJob,
  StudioModel,
  StudioParams,
  StylePreset,
} from "@/features/studio/types";

/**
 * Studio state.
 *
 * Sprint 5 is explicitly interface and state management, so this file is the
 * substance of it. Three concerns, deliberately kept apart:
 *
 *   params    what the composer is currently set to — persisted
 *   queue     jobs in flight — ephemeral, never persisted
 *   history   finished jobs — persisted, capped
 *
 * ## Why the queue is not persisted
 *
 * A queue restored from `localStorage` describes work that is not running. On
 * reload those jobs would sit at "running" forever, and the honest states —
 * cancelled, or re-queued — both require a server that knows what actually
 * happened. Sprint 6 moves the queue server-side, where it belongs; until then
 * it is correct for it to be as ephemeral as the tab.
 *
 * ## Capability reconciliation
 *
 * Switching models is the interesting state transition. Models genuinely differ
 * — Atlas Mini has no negative prompt, Helix Motion has no seed, aspect ratio
 * support varies — so `setModel` **repairs** the params rather than leaving
 * values that the new model would silently ignore. A UI that keeps showing 4
 * outputs after switching to a model that caps at 1 is lying about what will
 * happen when the button is pressed.
 */

const HISTORY_LIMIT = 60;

const DEFAULT_CAMERA: CameraSettings = {
  shot: null,
  angle: null,
  lens: null,
  lighting: null,
};

function defaultParams(): StudioParams {
  return {
    // Empty until the catalog loads from the server; `setModels` selects the
    // first available model. Hard-coding an id here would break the moment a
    // provider's line-up changed.
    modelId: "",
    prompt: "",
    negativePrompt: "",
    presetIds: [],
    camera: { ...DEFAULT_CAMERA },
    aspectRatio: "1:1",
    resolution: 1024,
    creativity: 0.5,
    seed: null,
    seedLocked: false,
    outputs: 1,
    references: [],
    durationSeconds: 5,
    cameraMotion: null,
  };
}

/**
 * Bring params into agreement with a model's declared capabilities.
 *
 * Pure, and exported, because the reconciliation rules are the part most worth
 * testing and the part most likely to be wrong.
 */
export function reconcileParams(
  params: StudioParams,
  models: StudioModel[],
): StudioParams {
  const model = findModelIn(models, params.modelId);
  // The catalog may name a model the previous session did not have.
  if (model.id && model.id !== params.modelId) {
    params = { ...params, modelId: model.id };
  }
  const caps = model.capabilities;
  const next = { ...params };

  if (!caps.supportsNegativePrompt) next.negativePrompt = "";
  if (!caps.supportsSeed) {
    next.seed = null;
    next.seedLocked = false;
  }
  if (!caps.supportsImageInput) next.references = [];

  if (!caps.aspectRatios.includes(next.aspectRatio)) {
    next.aspectRatio = caps.aspectRatios[0] ?? "1:1";
  }

  next.outputs = Math.min(Math.max(1, next.outputs), caps.maxOutputs);

  // Video: a duration the model does not offer would be silently rounded by the
  // provider, and the user billed for a clip they did not choose. Snap to the
  // nearest declared value instead, and say so by showing it selected.
  if (caps.durations?.length) {
    if (!caps.durations.includes(next.durationSeconds)) {
      next.durationSeconds = caps.durations.reduce((best, option) =>
        Math.abs(option - next.durationSeconds) <
        Math.abs(best - next.durationSeconds)
          ? option
          : best,
      );
    }
  }

  // A motion phrase the new model has never heard would be pasted into its
  // prompt and interpreted as scene description. Dropping it is the lesser
  // surprise, and the control disappears with it.
  if (next.cameraMotion && !caps.cameraMotions?.includes(next.cameraMotion)) {
    next.cameraMotion = null;
  }

  const allowed = resolutionOptions(model);
  if (!allowed.includes(next.resolution)) {
    // Nearest allowed value, not the first — someone who chose 2048 wants the
    // largest available on the new model, not the smallest.
    next.resolution = allowed.reduce((best, option) =>
      Math.abs(option - next.resolution) < Math.abs(best - next.resolution)
        ? option
        : best,
    );
  }

  return next;
}

/**
 * The prompt actually submitted: what was typed, plus preset and camera text.
 *
 * Exported so the composer can show it. Nothing is added to a user's prompt
 * without them being able to read it.
 */
export function assemblePrompt(
  params: StudioParams,
  /**
   * Styles from installed marketplace packs.
   *
   * Passed in rather than read from the store, so this stays a pure function of
   * its arguments — it is the one place a prompt is assembled, and a hidden
   * dependency on global state is how the composer's preview and the submitted
   * prompt end up disagreeing.
   *
   * Without it, a preset id from a pack resolves to nothing and its fragment is
   * silently dropped: the chip stays lit and the style never applies.
   */
  installedStyles: readonly StylePreset[] = [],
): string {
  const presetFragments = params.presetIds
    .map(
      (id) =>
        STYLE_PRESETS.find((preset) => preset.id === id)?.fragment ??
        installedStyles.find((preset) => preset.id === id)?.fragment,
    )
    .filter(Boolean) as string[];

  const cameraFragments = Object.values(params.camera).filter(
    Boolean,
  ) as string[];

  return [params.prompt.trim(), ...cameraFragments, ...presetFragments]
    .filter(Boolean)
    .join(", ");
}

/**
 * Credits a submission will cost. Shown before the button, not after.
 *
 * Delegates to `services/ai/pricing`, which the server also uses to charge. The
 * estimate and the invoice have to be the same function or they will eventually
 * be different numbers.
 */
export function estimateCost(
  params: StudioParams,
  models: StudioModel[],
): number {
  const model = findModelIn(models, params.modelId);
  return creditsFor(model, params.outputs, params.durationSeconds);
}

interface StudioState {
  /** Loaded from the server. Empty until the studio mounts. */
  models: StudioModel[];
  modelsLoaded: boolean;
  /** True when no real provider is configured — surfaced in the UI. */
  usingMockProvider: boolean;

  /**
   * Content from installed marketplace packs.
   *
   * Held here rather than fetched by each component that needs it: the prompt
   * editor, the style chips and the prompt assembler all read it, and three
   * independent fetches would be three chances to disagree about what is
   * installed.
   *
   * Never persisted. It is derived from server state, and a stale local copy
   * would offer a pack the user uninstalled on another device.
   */
  installed: InstalledContent;

  params: StudioParams;
  queue: StudioJob[];
  history: StudioJob[];
  /** Job whose result is in the preview panel. Null shows the empty state. */
  selectedJobId: string | null;

  setModels: (models: StudioModel[], usingMockProvider: boolean) => void;
  setInstalled: (installed: InstalledContent) => void;
  setHistory: (history: StudioJob[]) => void;
  /** Install the server's generations, split by whether they are still running. */
  hydrate: (jobs: StudioJob[]) => void;
  setParam: <K extends keyof StudioParams>(
    key: K,
    value: StudioParams[K],
  ) => void;
  setModel: (modelId: string) => void;
  togglePreset: (presetId: string) => void;
  setCamera: (axis: keyof CameraSettings, value: string | null) => void;
  addReference: (reference: ReferenceImage) => void;
  removeReference: (id: string) => void;
  setReferenceStrength: (id: string, strength: number) => void;
  /** Called when the upload to our storage settles, either way. */
  settleReference: (
    id: string,
    result: { remoteUrl: string } | { error: string },
  ) => void;
  applyTemplate: (template: PromptTemplate) => void;
  randomiseSeed: () => void;
  reset: () => void;

  enqueue: (job: StudioJob) => void;
  updateJob: (id: string, patch: Partial<StudioJob>) => void;
  completeJob: (id: string) => void;
  cancelJob: (id: string) => void;
  selectJob: (id: string | null) => void;
  clearHistory: () => void;
  /** Restore a past job's settings into the composer. */
  reuseParams: (jobId: string) => void;
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set, get) => ({
      models: [],
      modelsLoaded: false,
      usingMockProvider: false,
      installed: EMPTY_INSTALLED,
      params: defaultParams(),
      queue: [],
      history: [],
      selectedJobId: null,

      /**
       * Install the catalog and repair the persisted params against it.
       *
       * A user's stored `modelId` can name a model that no longer exists — a
       * provider was removed, or its credentials were rotated out. Reconciling
       * on load is what stops the composer showing a model the server will
       * reject.
       */
      setModels: (models, usingMockProvider) =>
        set((state) => ({
          models,
          modelsLoaded: true,
          usingMockProvider,
          params: reconcileParams(state.params, models),
        })),

      setInstalled: (installed) => set({ installed }),

      /** Replace history with the server's copy — it is the source of truth. */
      setHistory: (history) => set({ history }),

      /**
       * Install the server's generations on load.
       *
       * Splits on status rather than dropping everything into history, because
       * a job can still be running when the studio mounts. Video made this
       * unavoidable: a clip takes minutes, and the tab that started it is
       * routinely closed, reloaded or replaced before it finishes. Filing a
       * running job under "history" would show it as a finished generation with
       * no outputs — the interface asserting something false about work that is
       * still in progress.
       *
       * Unfinished jobs go back into the queue and the workspace resumes
       * polling them. Selection is left alone: this runs on mount, before
       * anything is selected, and stamping one here would override a deep link.
       */
      hydrate: (jobs) =>
        set({
          queue: jobs.filter(
            (job) => job.status === "queued" || job.status === "running",
          ),
          history: jobs.filter(
            (job) => job.status !== "queued" && job.status !== "running",
          ),
        }),

      setParam: (key, value) =>
        set((state) => ({ params: { ...state.params, [key]: value } })),

      setModel: (modelId) =>
        set((state) => ({
          params: reconcileParams({ ...state.params, modelId }, state.models),
        })),

      togglePreset: (presetId) =>
        set((state) => {
          const active = state.params.presetIds.includes(presetId);
          return {
            params: {
              ...state.params,
              presetIds: active
                ? state.params.presetIds.filter((id) => id !== presetId)
                : [...state.params.presetIds, presetId],
            },
          };
        }),

      setCamera: (axis, value) =>
        set((state) => ({
          params: {
            ...state.params,
            camera: { ...state.params.camera, [axis]: value },
          },
        })),

      addReference: (reference) =>
        set((state) => ({
          params: {
            ...state.params,
            references: [...state.params.references, reference],
          },
        })),

      removeReference: (id) =>
        set((state) => {
          const target = state.params.references.find((ref) => ref.id === id);
          // Object URLs are a memory allocation, not a string. Dropping the
          // reference without revoking leaks the whole image for the life of
          // the tab.
          if (target) URL.revokeObjectURL(target.url);

          return {
            params: {
              ...state.params,
              references: state.params.references.filter(
                (ref) => ref.id !== id,
              ),
            },
          };
        }),

      setReferenceStrength: (id, strength) =>
        set((state) => ({
          params: {
            ...state.params,
            references: state.params.references.map((ref) =>
              ref.id === id ? { ...ref, strength } : ref,
            ),
          },
        })),

      settleReference: (id, result) =>
        set((state) => ({
          params: {
            ...state.params,
            references: state.params.references.map((ref) =>
              ref.id === id
                ? "remoteUrl" in result
                  ? {
                      ...ref,
                      status: "ready" as const,
                      remoteUrl: result.remoteUrl,
                    }
                  : { ...ref, status: "failed" as const, error: result.error }
                : ref,
            ),
          },
        })),

      applyTemplate: (template) =>
        set((state) => ({
          params: reconcileParams(
            {
              ...state.params,
              prompt: template.prompt,
              negativePrompt: template.negativePrompt ?? "",
              presetIds: template.presetIds ?? [],
            },
            state.models,
          ),
        })),

      randomiseSeed: () =>
        set((state) => ({
          params: {
            ...state.params,
            seed: Math.floor(Math.random() * 2_147_483_647),
          },
        })),

      reset: () =>
        set((state) => {
          state.params.references.forEach((ref) =>
            URL.revokeObjectURL(ref.url),
          );
          return { params: defaultParams() };
        }),

      enqueue: (job) =>
        set((state) => ({
          queue: [job, ...state.queue],
          selectedJobId: job.id,
        })),

      updateJob: (id, patch) =>
        set((state) => ({
          queue: state.queue.map((job) =>
            job.id === id ? { ...job, ...patch } : job,
          ),
        })),

      completeJob: (id) =>
        set((state) => {
          const job = state.queue.find((entry) => entry.id === id);
          if (!job) return state;

          return {
            queue: state.queue.filter((entry) => entry.id !== id),
            history: [job, ...state.history].slice(0, HISTORY_LIMIT),
          };
        }),

      cancelJob: (id) =>
        set((state) => ({
          queue: state.queue.filter((job) => job.id !== id),
          selectedJobId:
            state.selectedJobId === id ? null : state.selectedJobId,
        })),

      selectJob: (id) => set({ selectedJobId: id }),

      clearHistory: () => set({ history: [], selectedJobId: null }),

      reuseParams: (jobId) => {
        const state = get();
        const job =
          state.history.find((entry) => entry.id === jobId) ??
          state.queue.find((entry) => entry.id === jobId);
        if (!job) return;

        set({
          params: reconcileParams(
            {
              ...job.params,
              // References held object URLs from a previous session; those are
              // dead. Everything else restores cleanly.
              references: [],
            },
            state.models,
          ),
        });
      },
    }),
    {
      name: "atheos:studio",
      // 3: params gained durationSeconds and cameraMotion. A v2 payload
      // restores without them, and `reconcileParams` cannot repair a field that
      // is absent rather than wrong - so the version bump discards it.
      version: 3,
      /**
       * Persist the composer only.
       *
       * History used to be persisted here. It is now owned by the server, and
       * keeping a local copy would mean two sources of truth that disagree the
       * moment a generation is deleted or finishes in another tab.
       *
       * References are stripped: their `url` is an object URL, valid only for
       * the document that created it. Restoring one produces an image that
       * silently fails to load — worse than not restoring it.
       *
       * The queue was never persisted; it describes work that is not running.
       */
      partialize: (state) => ({
        params: { ...state.params, references: [] },
      }),
    },
  ),
);
