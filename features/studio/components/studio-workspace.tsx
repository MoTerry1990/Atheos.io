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
  createJob,
  runJob,
  type RunnerHandle,
} from "@/features/studio/lib/local-runner";
import { estimateCost, useStudioStore } from "@/store/studio-store";
import { cn } from "@/lib/utils";

/**
 * The studio.
 *
 * Three regions: compose, preview, results. On `xl` they sit side by side; on
 * anything narrower the composer and results become tabs, because a
 * three-column layout squeezed onto a laptop gives all three too little room to
 * be usable.
 *
 * ## No provider is connected, and the interface says so
 *
 * Sprint 5 is interface and state management only. The banner is not a
 * placeholder to delete later — it is the honest statement of what this screen
 * currently does, and it stays until a provider is actually wired.
 */

/**
 * Owns the running jobs.
 *
 * Handles are kept in a ref rather than state: they are not rendered, and
 * putting them in state would re-render the whole studio on every progress
 * tick. The cleanup is what matters — cancelling on unmount stops timers that
 * would otherwise keep writing into a store whose component has gone.
 */
function useJobRunner() {
  const runners = useRef(new Map<string, RunnerHandle>());
  const enqueue = useStudioStore((state) => state.enqueue);
  const updateJob = useStudioStore((state) => state.updateJob);
  const completeJob = useStudioStore((state) => state.completeJob);
  const params = useStudioStore((state) => state.params);
  const setParam = useStudioStore((state) => state.setParam);

  useEffect(() => {
    const active = runners.current;
    return () => {
      active.forEach((handle) => handle.cancel());
      active.clear();
    };
  }, []);

  return useCallback(() => {
    const job = createJob(params);
    enqueue(job);

    // An unlocked seed changes every run. Rolling it here — rather than inside the
    // runner — keeps the composer honest about what the next submission will
    // use.
    if (!params.seedLocked && params.seed !== null) {
      setParam("seed", Math.floor(Math.random() * 2_147_483_647));
    }

    const handle = runJob(job, {
      onUpdate: (patch) => updateJob(job.id, patch),
      onSettled: () => {
        completeJob(job.id);
        runners.current.delete(job.id);
      },
    });

    runners.current.set(job.id, handle);
  }, [params, enqueue, updateJob, completeJob, setParam]);
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

function GenerateBar({ onGenerate }: { onGenerate: () => void }) {
  const params = useStudioStore((state) => state.params);
  const queueLength = useStudioStore((state) => state.queue.length);

  const cost = estimateCost(params);
  const ready = params.prompt.trim().length > 0;

  return (
    <div className="sticky bottom-0 space-y-2 border-t border-border bg-card/80 p-3 backdrop-blur-md">
      <Button
        variant="gradient"
        size="lg"
        block
        onClick={onGenerate}
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
  const generate = useJobRunner();
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
      <div className="flex items-start gap-2.5 border-b border-warning/30 bg-warning/10 px-4 py-2.5">
        <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p className="text-xs">
          <span className="font-medium">No AI provider is connected.</span>{" "}
          <span className="text-muted-foreground">
            This is the studio interface and its state management. Results are
            procedural placeholders, not model output — providers arrive in
            Sprint 6.
          </span>
        </p>
      </div>

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
          <GenerateBar onGenerate={generate} />
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
