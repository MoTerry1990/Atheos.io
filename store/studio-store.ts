import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  DEFAULT_MODEL_ID,
  findModel,
  resolutionOptions,
} from "@/features/studio/data/models";
import { STYLE_PRESETS } from "@/features/studio/data/presets";
import type {
  CameraSettings,
  PromptTemplate,
  ReferenceImage,
  StudioJob,
  StudioParams,
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
    modelId: DEFAULT_MODEL_ID,
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
  };
}

/**
 * Bring params into agreement with a model's declared capabilities.
 *
 * Pure, and exported, because the reconciliation rules are the part most worth
 * testing and the part most likely to be wrong.
 */
export function reconcileParams(params: StudioParams): StudioParams {
  const model = findModel(params.modelId);
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
export function assemblePrompt(params: StudioParams): string {
  const presetFragments = params.presetIds
    .map((id) => STYLE_PRESETS.find((preset) => preset.id === id)?.fragment)
    .filter(Boolean) as string[];

  const cameraFragments = Object.values(params.camera).filter(
    Boolean,
  ) as string[];

  return [params.prompt.trim(), ...cameraFragments, ...presetFragments]
    .filter(Boolean)
    .join(", ");
}

/** Credits a submission will cost. Shown before the button, not after. */
export function estimateCost(params: StudioParams): number {
  return findModel(params.modelId).creditCost * params.outputs;
}

interface StudioState {
  params: StudioParams;
  queue: StudioJob[];
  history: StudioJob[];
  /** Job whose result is in the preview panel. Null shows the empty state. */
  selectedJobId: string | null;

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
      params: defaultParams(),
      queue: [],
      history: [],
      selectedJobId: null,

      setParam: (key, value) =>
        set((state) => ({ params: { ...state.params, [key]: value } })),

      setModel: (modelId) =>
        set((state) => ({
          params: reconcileParams({ ...state.params, modelId }),
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

      applyTemplate: (template) =>
        set((state) => ({
          params: reconcileParams({
            ...state.params,
            prompt: template.prompt,
            negativePrompt: template.negativePrompt ?? "",
            presetIds: template.presetIds ?? [],
          }),
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
          params: reconcileParams({
            ...job.params,
            // References held object URLs from a previous session; those are
            // dead. Everything else restores cleanly.
            references: [],
          }),
        });
      },
    }),
    {
      name: "atheos:studio",
      version: 1,
      /**
       * Persist the composer and the history, never the queue.
       *
       * References are stripped too: their `url` is an object URL, which is
       * only valid for the document that created it. Restoring one produces an
       * image that silently fails to load — worse than not restoring it.
       */
      partialize: (state) => ({
        params: { ...state.params, references: [] },
        history: state.history,
      }),
    },
  ),
);
