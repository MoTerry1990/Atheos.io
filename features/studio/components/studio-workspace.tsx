"use client";

import { Info, Settings2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ModelPicker } from "@/features/studio/components/model-picker";
import {
  AdvancedSettings,
  OutputSettings,
} from "@/features/studio/components/output-settings";
import { PreviewPanel } from "@/features/studio/components/preview-panel";
import { PromptEditor } from "@/features/studio/components/prompt-editor";
import {
  HistoryPanel,
  QueuePanel,
} from "@/features/studio/components/queue-and-history";
import { ReferenceUpload } from "@/features/studio/components/reference-upload";
import { StyleAndCamera } from "@/features/studio/components/style-and-camera";
import {
  ApiError,
  loadStudio,
  pollUntilSettled,
  submitGeneration,
} from "@/features/studio/lib/api";
import { toStudioModel } from "@/features/studio/lib/dto";
import {
  dtoToHistoryJob,
  dtoToStudioJob,
} from "@/features/studio/lib/job-mapper";
import { useSelectedModel } from "@/features/studio/lib/use-model";
import {
  assemblePrompt,
  estimateCost,
  useStudioStore,
} from "@/store/studio-store";
import type { StudioJob } from "@/features/studio/types";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * The studio.
 *
 * Three regions: compose, preview, results. On `xl` they sit side by side; on
 * anything narrower the composer and results become tabs, because a
 * three-column layout squeezed onto a laptop gives all three too little room to
 * be usable.
 *
 * ## The banner reflects configuration, not a hard-coded caveat
 *
 * When no provider credentials are present the registry falls back to the mock
 * provider, and the banner says so. Configure `REPLICATE_API_TOKEN` or
 * `OPENAI_API_KEY` and it disappears on its own — nothing here needs editing,
 * which is what stops it rotting into a lie.
 */

/**
 * Loads the catalog and this user history when the studio mounts.
 *
 * The server owns both. Persisting a local copy of history would give two
 * sources of truth that disagree the moment a generation finishes in another
 * tab or is deleted.
 */
function useStudioBootstrap() {
  const setModels = useStudioStore((state) => state.setModels);
  const setHistory = useStudioStore((state) => state.setHistory);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadStudio()
      .then((data) => {
        if (cancelled) return;
        setModels(data.models.map(toStudioModel), data.usingMockProvider);
        setHistory(data.generations.map(dtoToHistoryJob));
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Could not load the studio.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [setModels, setHistory]);

  return { error };
}

/**
 * Submits a generation and polls it to completion.
 *
 * This replaced `local-runner.ts`, which drove a fake lifecycle on timers so
 * the interface could be built before a provider existed. The components did
 * not change - they consume `StudioJob`, and that contract survived the swap,
 * which is the whole reason it was defined first.
 *
 * ## The client is the job runner, for now
 *
 * Polling is what advances a generation: each GET asks the provider, copies
 * outputs into storage on success, and refunds on failure. There is no
 * background worker, so closing the tab mid-generation leaves the job at
 * RUNNING until the user returns. That is a real limitation, not an oversight -
 * a scheduled reconciler is queued with the operational work.
 *
 * Abort controllers are keyed by job id so cancelling one does not stop the
 * others, and unmounting stops all of them.
 */
function useGenerationRunner() {
  const controllers = useRef(new Map<string, AbortController>());

  const params = useStudioStore((state) => state.params);
  const models = useStudioStore((state) => state.models);
  const enqueue = useStudioStore((state) => state.enqueue);
  const updateJob = useStudioStore((state) => state.updateJob);
  const completeJob = useStudioStore((state) => state.completeJob);
  const setParam = useStudioStore((state) => state.setParam);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const active = controllers.current;
    return () => {
      active.forEach((controller) => controller.abort());
      active.clear();
    };
  }, []);

  const generate = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      const { generationId } = await submitGeneration({
        operation: "text-to-image",
        modelId: params.modelId,
        // The assembled prompt - what was typed plus the preset and camera
        // fragments the composer already shows.
        prompt: assemblePrompt(params),
        negativePrompt: params.negativePrompt || undefined,
        aspectRatio: params.aspectRatio,
        seed: params.seed ?? undefined,
        outputs: params.outputs,
      });

      const optimistic: StudioJob = {
        id: generationId,
        status: "queued",
        params: structuredClone(params),
        modelName:
          models.find((model) => model.id === params.modelId)?.displayName ??
          "",
        creditCost: estimateCost(params, models),
        progress: 0,
        outputs: [],
        error: null,
        createdAt: Date.now(),
        completedAt: null,
      };
      enqueue(optimistic);

      // Roll an unlocked seed so the next run differs, and so the composer is
      // honest about what it will send.
      if (!params.seedLocked && params.seed !== null) {
        setParam("seed", Math.floor(Math.random() * 2_147_483_647));
      }

      const controller = new AbortController();
      controllers.current.set(generationId, controller);

      pollUntilSettled(generationId, {
        signal: controller.signal,
        onUpdate: (dto) => updateJob(generationId, dtoToStudioJob(dto)),
      })
        .then((dto) => {
          updateJob(generationId, dtoToStudioJob(dto));
          completeJob(generationId);
          if (dto.status === "failed") {
            toast.error("Generation failed", {
              description: dto.error ?? undefined,
            });
          }
        })
        .catch((cause) => {
          if (cause instanceof ApiError && cause.code === "aborted") return;
          updateJob(generationId, {
            status: "failed",
            error:
              cause instanceof ApiError ? cause.message : "Polling failed.",
          });
          completeJob(generationId);
        })
        .finally(() => {
          controllers.current.delete(generationId);
        });
    } catch (cause) {
      toast.error("Could not generate", {
        description:
          cause instanceof ApiError
            ? cause.message
            : "Could not start that generation.",
      });
    } finally {
      setSubmitting(false);
    }
  }, [submitting, params, models, enqueue, updateJob, completeJob, setParam]);

  return { generate, submitting };
}

function Composer() {
  return (
    <div className="space-y-6">
      <ModelPicker />
      <PromptEditor />
      <ReferenceUpload />
      <StyleAndCamera />

      <Accordion type="multiple" defaultValue={["output"]}>
        <AccordionItem value="output">
          <AccordionTrigger className="text-sm">
            <span className="flex items-center gap-2">
              <Sparkles className="size-4 text-muted-foreground" aria-hidden />
              Output
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="pt-1">
              <OutputSettings />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="advanced">
          <AccordionTrigger className="text-sm">
            <span className="flex items-center gap-2">
              <Settings2 className="size-4 text-muted-foreground" aria-hidden />
              Advanced
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="pt-1">
              <AdvancedSettings />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function GenerateBar({
  onGenerate,
  submitting,
}: {
  onGenerate: () => void;
  submitting: boolean;
}) {
  const params = useStudioStore((state) => state.params);
  const models = useStudioStore((state) => state.models);
  const queueLength = useStudioStore((state) => state.queue.length);
  const model = useSelectedModel();

  const cost = estimateCost(params, models);
  const ready = params.prompt.trim().length > 0 && Boolean(model.id);

  return (
    <div className="sticky bottom-0 space-y-2 border-t border-border bg-card/80 p-3 backdrop-blur-md">
      <Button
        variant="gradient"
        size="lg"
        block
        onClick={onGenerate}
        loading={submitting}
        disabled={!ready}
        title={ready ? undefined : "Write a prompt first"}
      >
        <Sparkles />
        Generate · {cost} credits
      </Button>

      <p className="text-center text-2xs text-muted-foreground">
        {queueLength > 0 ? `${queueLength} in queue` : "Nothing running"}
      </p>
    </div>
  );
}

type StudioView = "compose" | "preview" | "results";

const VIEWS: { id: StudioView; label: string }[] = [
  { id: "compose", label: "Compose" },
  { id: "preview", label: "Preview" },
  { id: "results", label: "Results" },
];

export function StudioWorkspace() {
  const { error } = useStudioBootstrap();
  const { generate, submitting } = useGenerationRunner();
  const usingMock = useStudioStore((state) => state.usingMockProvider);
  const [view, setView] = useState<StudioView>("compose");

  /**
   * One tree, two layouts.
   *
   * The obvious implementation renders a three-column layout *and* a tabbed
   * layout, hiding one with CSS. That mounts every panel twice: two prompt
   * textareas bound to the same store value, two model pickers, double the
   * subscriptions and double the client work — and the duplicate that happens
   * to be hidden still runs every effect.
   *
   * Instead each region is rendered once and its visibility is driven by
   * `view` below `xl`, while `xl:` classes force all three visible above it.
   */
  const regionClass = (id: StudioView) =>
    cn(view === id ? "flex" : "hidden", "xl:flex");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Reflects what is actually configured rather than a hard-coded
          disclaimer. With real provider credentials present this disappears. */}
      {usingMock ? (
        <div className="flex items-start gap-2.5 border-b border-warning/30 bg-warning/10 px-4 py-2.5">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p className="text-xs">
            <span className="font-medium">Mock provider active.</span>{" "}
            <span className="text-muted-foreground">
              No provider credentials are configured, so results are placeholder
              images rather than model output. The pipeline itself is real —
              credits are spent, refunded on failure, and results are stored.
              Set REPLICATE_API_TOKEN or OPENAI_API_KEY to generate for real.
            </span>
          </p>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs"
        >
          {error}
        </div>
      ) : null}

      {/* Tab bar, below xl only. Above it all three regions are visible. */}
      <div className="flex gap-1 border-b px-4 py-2 xl:hidden">
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setView(entry.id)}
            aria-pressed={view === entry.id}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
              view === entry.id
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[22rem_1fr_18rem]">
        <div
          className={cn(
            regionClass("compose"),
            "min-h-0 min-w-0 flex-col xl:border-r",
          )}
        >
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-4">
              <Composer />
            </div>
          </ScrollArea>
          <GenerateBar onGenerate={generate} submitting={submitting} />
        </div>

        <div className={cn(regionClass("preview"), "min-h-0 min-w-0 p-4")}>
          <PreviewPanel />
        </div>

        <div
          className={cn(
            regionClass("results"),
            "min-h-0 min-w-0 flex-col xl:border-l",
          )}
        >
          <ScrollArea className="h-full">
            <div className="space-y-6 p-4">
              <QueuePanel />
              <HistoryPanel />
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
