"use client";

import { findModelIn } from "@/features/studio/data/models";
import { useStudioStore } from "@/store/studio-store";
import type { StudioModel } from "@/features/studio/types";

/**
 * The currently selected model.
 *
 * A hook rather than a bare lookup because the catalog is now loaded from the
 * server and lives in the store. Every composer control needs the selected
 * model's capabilities, and routing that through one hook means adding a
 * capability does not touch five components.
 *
 * Falls back to a placeholder while models are loading, so the composer renders
 * a coherent (if inert) shape rather than crashing on `undefined.capabilities`.
 */
export function useSelectedModel(): StudioModel {
  const models = useStudioStore((state) => state.models);
  const modelId = useStudioStore((state) => state.params.modelId);
  return findModelIn(models, modelId);
}

export function useModels(): StudioModel[] {
  return useStudioStore((state) => state.models);
}
