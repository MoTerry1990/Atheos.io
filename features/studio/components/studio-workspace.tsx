"use client";

import { Info, Settings2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CommandPalette,
  ShortcutSheet,
} from "@/features/studio/components/command-palette";
import { ModelPicker } from "@/features/studio/components/model-picker";
import {
  ModalityRail,
  ModalityUnavailable,
  type Modality,
} from "@/features/studio/components/modality-rail";
import {
  ResizeHandle,
  usePanelSize,
} from "@/features/studio/components/resizable";
import { useShortcuts, type Shortcut } from "@/features/studio/lib/shortcuts";
import { useSeedFromUrl } from "@/features/studio/lib/use-seed-from-url";
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
import { VideoSettings } from "@/features/studio/components/video-settings";
import { findModelIn } from "@/features/studio/data/models";
import {
  ApiError,
  loadStudio,
  pollUntilSettled,
  submitGeneration,
} from "@/features/studio/lib/api";
import { toStudioModel } from "@/features/studio/lib/dto";
import { mapInstalled } from "@/features/studio/lib/installed";
import { loadInstalled } from "@/features/marketplace/lib/api";
import {
  OPERATION_LABELS,
  operationFor,
  operationNote,
} from "@/features/studio/lib/operation";
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
import { OPERATIONS_REQUIRING_INPUT } from "@/services/ai/types";
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
function useStudioBootstrap(track: (generationId: string) => void) {
  const setModels = useStudioStore((state) => state.setModels);
  const hydrate = useStudioStore((state) => state.hydrate);
  const setInstalled = useStudioStore((state) => state.setInstalled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadStudio()
      .then((data) => {
        if (cancelled) return;
        setModels(data.models.map(toStudioModel), data.usingMockProvider);

        const jobs = data.generations.map(dtoToHistoryJob);
        hydrate(jobs);

        // Resume anything the server still considers unfinished. Polling is
        // what *advances* a generation — each GET asks the provider, stores the
        // outputs and settles the credits — so a job whose tab was closed is
        // genuinely stuck until someone polls it again. For an image that was a
        // few seconds of exposure; for a two-minute clip it is the normal case.
        jobs
          .filter((job) => job.status === "queued" || job.status === "running")
          .forEach((job) => track(job.id));
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Could not load the studio.",
        );
      });

    // Marketplace content is an enhancement, not a dependency. Fetched
    // separately and allowed to fail quietly: a studio that refuses to open
    // because a prompt pack could not be listed would be trading the whole
    // feature for one of its accessories.
    loadInstalled()
      .then((data) => {
        if (!cancelled) setInstalled(mapInstalled(data.installed));
      })
      .catch((cause) => {
        console.error("Could not load installed marketplace items", cause);
      });

    return () => {
      cancelled = true;
    };
  }, [setModels, hydrate, setInstalled, track]);

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
 * background worker, so a job whose tab is closed simply stops advancing until
 * someone looks at it again. That is a real limitation, not an oversight - a
 * scheduled reconciler is queued with the operational work.
 *
 * What Sprint 7 adds is **resumption**. `track` is separate from `generate` and
 * idempotent, so the bootstrap can re-attach to every unfinished job on mount.
 * With images this mattered rarely; a video clip takes minutes, so the tab that
 * started one being gone before it lands is the normal case, not the edge one.
 *
 * Abort controllers are keyed by job id so cancelling one does not stop the
 * others, and unmounting stops all of them.
 */
function useGenerationRunner() {
  const controllers = useRef(new Map<string, AbortController>());

  const params = useStudioStore((state) => state.params);
  const models = useStudioStore((state) => state.models);
  // Needed here as well as in the editor's preview: the two must assemble the
  // same string, and the preview reading installed styles while the submission
  // did not would silently send a different prompt than the one shown.
  const installedStyles = useStudioStore((state) => state.installed.styles);
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

  /**
   * Follow a generation to completion.
   *
   * Idempotent by design: the bootstrap calls it for every unfinished job, and
   * a second call for a job already being polled must not open a second poll
   * loop against the same id. Doubling the request rate on a two-minute video
   * job is the cheapest way to get rate-limited by our own provider.
   */
  const track = useCallback(
    (generationId: string) => {
      if (controllers.current.has(generationId)) return;

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

          // A timeout is not a failure. The job may well still be running on
          // the provider's side, and marking it failed here would contradict
          // what the server says the next time the studio loads — and imply a
          // refund that never happened.
          if (cause instanceof ApiError && cause.code === "timeout") {
            toast.warning("Still generating", cause.message);
            return;
          }

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
    },
    [updateJob, completeJob],
  );

  const generate = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      const model = findModelIn(models, params.modelId);
      const operation = operationFor(model, params);
      const video = model.modality === "VIDEO";

      // Only references that finished uploading. `remoteUrl` is what a provider
      // can actually fetch; an object URL would 404 on their side.
      const inputImageUrls = params.references
        .map((reference) => reference.remoteUrl)
        .filter((url): url is string => Boolean(url));

      const usesReference =
        operation === "image-to-image" || operation === "image-to-video";

      const { generationId } = await submitGeneration({
        operation,
        modelId: params.modelId,
        // The assembled prompt - what was typed plus the preset and camera
        // fragments the composer already shows. Camera *motion* is not in
        // here: the adapter appends it, and doing both would send it twice.
        prompt: assemblePrompt(params, installedStyles),
        negativePrompt: params.negativePrompt || undefined,
        aspectRatio: params.aspectRatio,
        seed: params.seed ?? undefined,
        outputs: params.outputs,
        ...(usesReference && inputImageUrls.length > 0
          ? {
              inputImageUrls,
              inputStrength: params.references[0]?.strength,
            }
          : {}),
        ...(video
          ? {
              durationSeconds: params.durationSeconds,
              cameraMotion: params.cameraMotion ?? undefined,
            }
          : {}),
      });

      const optimistic: StudioJob = {
        id: generationId,
        status: "queued",
        params: structuredClone(params),
        modelName: model.displayName,
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

      track(generationId);
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
  }, [submitting, params, models, installedStyles, enqueue, setParam, track]);

  return { generate, submitting, track };
}

/**
 * A quiet line naming what will happen.
 *
 * The operation is derived rather than chosen (see `lib/operation.ts`), which
 * is only a good design if the interface says what it derived. Otherwise the
 * user attaches a reference and has no way to tell whether it changed anything.
 */
function OperationSummary() {
  const params = useStudioStore((state) => state.params);
  const model = useSelectedModel();

  const note = operationNote(model, params);

  return (
    <div className="space-y-1.5">
      <p className="text-2xs tracking-wider text-muted-foreground uppercase">
        {OPERATION_LABELS[operationFor(model, params)]}
      </p>
      {note ? <p className="text-xs text-warning">{note}</p> : null}
    </div>
  );
}

function Composer() {
  return (
    <div className="space-y-6">
      <ModelPicker />
      <OperationSummary />
      <PromptEditor />
      <ReferenceUpload />
      <VideoSettings />
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

  // A reference still uploading has no URL to send, so submitting now would
  // silently drop it and produce a text-only result the user did not ask for.
  const uploading = params.references.some(
    (reference) => reference.status === "uploading",
  );

  // An operation that needs a source image needs one that actually reached
  // storage. Without this the request goes out with an empty `inputImageUrls`,
  // the server rejects it — correctly — and the user has learned nothing they
  // could not have been told before pressing the button.
  const needsSource = OPERATIONS_REQUIRING_INPUT.has(
    operationFor(model, params),
  );
  const hasSource = params.references.some(
    (reference) => reference.status === "ready",
  );

  const blocked = !params.prompt.trim()
    ? "Write a prompt first"
    : !model.id
      ? "Waiting for the model catalogue"
      : uploading
        ? "Waiting for your reference to finish uploading"
        : needsSource && !hasSource
          ? "This needs a reference image that uploaded successfully"
          : null;

  return (
    <div className="sticky bottom-0 space-y-2 border-t border-border bg-card/80 p-3 backdrop-blur-md">
      <Button
        variant="gradient"
        size="lg"
        block
        onClick={onGenerate}
        loading={submitting}
        disabled={Boolean(blocked)}
        title={blocked ?? undefined}
      >
        <Sparkles />
        Generate · {cost} credits
      </Button>

      <p className="text-center text-2xs text-muted-foreground">
        {blocked ??
          (queueLength > 0 ? `${queueLength} in queue` : "Nothing running")}
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
  // Order matters: the runner owns `track`, and the bootstrap needs it to
  // re-attach to jobs that were already running when this tab opened.
  const { generate, submitting, track } = useGenerationRunner();
  const { error } = useStudioBootstrap(track);

  // Picks up ?prompt= and ?modality= from the landing composer. Without it the
  // homepage promises the prompt travels and the studio arrives empty.
  useSeedFromUrl();
  const usingMock = useStudioStore((state) => state.usingMockProvider);
  const [view, setView] = useState<StudioView>("compose");

  // Sprint 22. The workspace's own UI state — deliberately local rather than in
  // the studio store: none of it describes a generation, and persisting a
  // palette's open flag across reloads would restore a modal nobody opened.
  const [modality, setModality] = useState<Modality>("image");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Column widths, persisted. See `resizable.tsx` for why these are read in an
  // effect rather than during render.
  const [composeWidth, setComposeWidth, commitComposeWidth] = usePanelSize(
    "atheos.studio.compose",
    26,
  );
  const [resultsWidth, setResultsWidth, commitResultsWidth] = usePanelSize(
    "atheos.studio.results",
    21,
  );

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

  /**
   * The shortcut registry.
   *
   * Memoised on its dependencies because `useShortcuts` rebinds its listener
   * whenever the array identity changes — a new array every render would
   * add and remove a document listener on every keystroke.
   */
  const shortcuts = useMemo<Shortcut[]>(
    () => [
      {
        key: "k",
        mod: true,
        label: "Open command palette",
        group: "Workspace",
        allowInInput: true,
        run: () => setPaletteOpen(true),
      },
      {
        key: "Enter",
        mod: true,
        label: "Generate",
        group: "Generate",
        // The one shortcut that must work *while typing* — a user finishes a
        // prompt and submits without leaving the field.
        allowInInput: true,
        run: () => {
          if (!submitting) void generate();
        },
      },
      {
        key: "/",
        label: "Focus the prompt",
        group: "Generate",
        run: () => {
          const prompt = document.querySelector<HTMLTextAreaElement>(
            "[data-studio-prompt]",
          );
          prompt?.focus();
        },
      },
      {
        key: "1",
        label: "Compose",
        group: "Navigate",
        run: () => setView("compose"),
      },
      {
        key: "2",
        label: "Preview",
        group: "Navigate",
        run: () => setView("preview"),
      },
      {
        key: "3",
        label: "Queue and history",
        group: "Navigate",
        run: () => setView("results"),
      },
      {
        key: "?",
        shift: true,
        label: "Show shortcuts",
        group: "Workspace",
        run: () => setShortcutsOpen(true),
      },
      {
        key: "Escape",
        label: "Close overlays",
        group: "Workspace",
        allowInInput: true,
        run: () => {
          setPaletteOpen(false);
          setShortcutsOpen(false);
        },
      },
    ],
    [generate, submitting],
  );

  useShortcuts(shortcuts);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The studio had no `h1` at all.

          Every other page has one; this is the product's core screen and the
          audit found it empty. A visible title would cost vertical space the
          three-column layout genuinely needs, so it is visually hidden — which
          is the correct use of `sr-only`: the heading exists for the document
          outline and for a screen reader's heading navigation, and the visual
          hierarchy is carried by the layout itself. */}
      <h1 className="sr-only">AI Studio</h1>

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

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={shortcuts.filter((s) => s.key !== "Escape")}
      />
      <ShortcutSheet
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        shortcuts={shortcuts}
      />

      <div className="flex min-h-0 flex-1">
        <ModalityRail
          value={modality}
          onChange={setModality}
          className="hidden p-2 lg:flex"
        />

        {/* Resizable above xl only. Below it the regions are tabbed, so a
            divider would be a control for a layout that is not on screen. */}
        <div
          className="grid min-h-0 flex-1 xl:flex"
          style={
            {
              "--compose": `${composeWidth}%`,
              "--results": `${resultsWidth}%`,
            } as React.CSSProperties
          }
        >
          <div
            className={cn(
              regionClass("compose"),
              "min-h-0 min-w-0 flex-col xl:w-[var(--compose)]",
            )}
          >
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 p-4">
                {/* Radix `Accordion.Header` renders an `h3`, so the composer's
                    sections landed directly under the page `h1` — a skipped
                    level Sprint 17's E2E caught on this exact route.

                    The fix is a real section heading rather than downgrading
                    the accordion: the composer *is* a section of the workspace,
                    and giving it the h2 it always implied makes the outline
                    read h1 → h2 → h3 without touching a shared primitive four
                    other pages depend on.

                    Hidden because the column is self-evidently the composer to
                    anyone who can see it. */}
                <h2 className="sr-only">Composer</h2>
                <ModalityUnavailable modality={modality} />
                <Composer />
              </div>
            </ScrollArea>
            <GenerateBar onGenerate={generate} submitting={submitting} />
          </div>

          <ResizeHandle
            value={composeWidth}
            onChange={setComposeWidth}
            onCommit={commitComposeWidth}
            min={18}
            max={40}
            label="Composer width"
            side="left"
            className="hidden xl:block"
          />

          <div
            className={cn(regionClass("preview"), "min-h-0 min-w-0 flex-1 p-4")}
          >
            <PreviewPanel />
          </div>

          <ResizeHandle
            value={resultsWidth}
            onChange={setResultsWidth}
            onCommit={commitResultsWidth}
            min={15}
            max={36}
            label="Results width"
            side="right"
            className="hidden xl:block"
          />

          <div
            className={cn(
              regionClass("results"),
              "min-h-0 min-w-0 flex-col xl:w-[var(--results)]",
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
    </div>
  );
}
