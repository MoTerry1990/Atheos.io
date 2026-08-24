import type { GenerationDTO } from "@/features/studio/lib/dto";
import type { StudioJob, StudioParams } from "@/features/studio/types";
import { env } from "@/lib/env";

/**
 * Server generation → the shape the studio already renders.
 *
 * The reason this file is small is the reason Sprint 5 was worth doing: the
 * components were written against `StudioJob`, so replacing a local timer with
 * a real server pipeline needed a mapper, not a rewrite.
 *
 * ## Object keys become URLs here, and only here
 *
 * Assets store a **key**; the public hostname in front of the bucket is an
 * operational detail that will change. Resolving it at the edge of the client
 * means moving the CDN is a config change rather than a data migration.
 */
export function assetUrl(storageKey: string): string {
  const base = env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!base) return "";
  return `${base.replace(/\/$/, "")}/${storageKey.replace(/^\//, "")}`;
}

/**
 * Partial by design.
 *
 * Used both to seed a job and to patch one mid-flight, so it returns only what
 * the server actually knows. Overwriting the local `params` snapshot on every
 * poll would discard the settings the composer recorded at submit time.
 */
export function dtoToStudioJob(dto: GenerationDTO): Partial<StudioJob> & {
  id: string;
  status: StudioJob["status"];
} {
  const parameters = (dto.parameters ?? {}) as Partial<StudioParams> & {
    aspectRatio?: string;
    seed?: number;
    outputs?: number;
  };

  return {
    id: dto.id,
    status: dto.status,
    modelName: dto.modelId,
    creditCost: dto.creditCost,
    error: dto.error,
    createdAt: dto.createdAt,
    completedAt: dto.completedAt,
    // The server does not report a percentage — no provider we have integrated
    // gives a trustworthy one. Null renders the indeterminate bar, which is the
    // honest state, rather than a number invented to look busy.
    progress: dto.status === "succeeded" ? 1 : null,
    outputs: dto.outputs.map((output, index) => ({
      id: output.id,
      url: assetUrl(output.storageKey),
      mimeType: output.mimeType,
      durationMs: output.durationMs,
      // Retained so the preview can fall back to a gradient while an image
      // loads, and so a broken CDN does not produce an empty grey box.
      hue: (index * 53 + dto.id.charCodeAt(0) * 7) % 360,
      seed: parameters.seed ?? 0,
      width: output.width ?? 1024,
      height: output.height ?? 1024,
    })),
  };
}

/**
 * A complete `StudioJob` for history loaded from the server.
 *
 * `dtoToStudioJob` is intentionally partial — it patches a job we already hold.
 * History is different: these are generations from previous sessions, so the
 * params have to be reconstructed from the request stored alongside them.
 *
 * Anything the stored request did not record falls back to a sane default
 * rather than `undefined`. A history entry with a missing aspect ratio should
 * still render; it should not crash the panel.
 */
export function dtoToHistoryJob(dto: GenerationDTO): StudioJob {
  const stored = (dto.parameters ?? {}) as Record<string, unknown>;
  const patch = dtoToStudioJob(dto);

  const params: StudioParams = {
    // History predates the sequence work, and a stored job is a record of what
    // happened rather than something to re-plan. Every archived generation was
    // a single clip, so that is what it is restored as.
    sequenceMode: "continuous",
    modelId: dto.modelId,
    prompt: dto.prompt,
    negativePrompt: dto.negativePrompt ?? "",
    presetIds: [],
    camera: { shot: null, angle: null, lens: null, lighting: null },
    aspectRatio:
      typeof stored.aspectRatio === "string" ? stored.aspectRatio : "1:1",
    resolution: 1024,
    creativity: 0.5,
    seed: typeof stored.seed === "number" ? stored.seed : null,
    seedLocked: false,
    outputs: typeof stored.outputs === "number" ? stored.outputs : 1,
    references: [],
    durationSeconds:
      typeof stored.durationSeconds === "number" ? stored.durationSeconds : 5,
    cameraMotion:
      typeof stored.cameraMotion === "string" ? stored.cameraMotion : null,
  };

  return {
    id: dto.id,
    status: dto.status,
    params,
    modelName: dto.modelId,
    creditCost: dto.creditCost,
    progress: patch.progress ?? null,
    outputs: patch.outputs ?? [],
    error: dto.error,
    createdAt: dto.createdAt,
    completedAt: dto.completedAt,
  };
}
