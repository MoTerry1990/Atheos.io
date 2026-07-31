"use client";

import {
  AlertCircle,
  Download,
  ImageIcon,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state";
import { ProgressBar, Spinner } from "@/components/ui/loading";
import {
  OutputTile,
  downloadOutput,
} from "@/features/studio/components/output-tile";
import { useStudioStore } from "@/store/studio-store";
import { cn } from "@/lib/utils";

/**
 * The preview panel.
 *
 * Shows whichever job is selected — running, failed, or finished. Four distinct
 * states, all of which a user will meet:
 *
 *   nothing selected  the first thing anyone sees
 *   running           with progress where the model reports it
 *   failed            with the reason and a way to retry
 *   succeeded         the outputs
 *
 * ## The failed state carries the refund line
 *
 * "Your credits have not been charged" is the first thing someone wants to know
 * when a generation fails, and burying it turns a recoverable moment into a
 * support ticket. It sits with the error rather than in a toast that has
 * already gone.
 *
 * ## Metadata is shown, not hidden behind a hover
 *
 * The prompt, model, seed and settings that produced a result are what make it
 * reproducible. On a tool for iterating, that is the point of the panel.
 */
export function PreviewPanel() {
  const selectedJobId = useStudioStore((state) => state.selectedJobId);
  const queue = useStudioStore((state) => state.queue);
  const history = useStudioStore((state) => state.history);
  const reuseParams = useStudioStore((state) => state.reuseParams);

  const job =
    queue.find((entry) => entry.id === selectedJobId) ??
    history.find((entry) => entry.id === selectedJobId) ??
    null;

  if (!job) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center rounded-xl border border-border">
        <EmptyState
          icon={ImageIcon}
          title="Nothing selected"
          description="Write a prompt and generate, or pick something from your history to see it here."
        />
      </div>
    );
  }

  const isRunning = job.status === "queued" || job.status === "running";
  const gridColumns =
    job.outputs.length === 1
      ? "grid-cols-1"
      : job.outputs.length === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : "grid-cols-2";

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant={
              job.status === "succeeded"
                ? "success"
                : job.status === "failed"
                  ? "danger"
                  : "info"
            }
            size="sm"
            dot
            pulse={isRunning}
          >
            {job.status}
          </Badge>
          <span className="truncate text-xs text-muted-foreground">
            {job.modelName}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => reuseParams(job.id)}
            title="Load these settings into the composer"
          >
            <RotateCcw />
            Reuse settings
          </Button>

          {job.outputs.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                job.outputs.forEach((output) =>
                  downloadOutput(output, job.id.slice(-6)),
                )
              }
            >
              <Download />
              {job.outputs.length > 1
                ? `Download ${job.outputs.length}`
                : "Download"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isRunning ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-4 text-center">
            <Spinner size="lg" tone="brand" label="Generating" />
            <div className="w-full max-w-xs space-y-2">
              <ProgressBar
                value={job.progress === null ? undefined : job.progress * 100}
                label="Generation progress"
              />
              <p className="text-xs text-muted-foreground">
                {job.status === "queued"
                  ? "Queued…"
                  : job.progress === null
                    ? "Working — this model does not report progress."
                    : `${Math.round(job.progress * 100)}%`}
              </p>
            </div>
          </div>
        ) : job.status === "failed" ? (
          <div
            role="alert"
            className="flex h-full min-h-64 flex-col items-center justify-center gap-3 text-center"
          >
            <div className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertCircle className="size-6" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium">Generation failed</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-balance text-muted-foreground">
                {job.error}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => reuseParams(job.id)}
            >
              <RotateCcw />
              Load settings and retry
            </Button>
          </div>
        ) : (
          <div className={cn("grid gap-3", gridColumns)}>
            {job.outputs.map((output) => (
              <OutputTile
                key={output.id}
                output={output}
                label={job.id.slice(-6)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t p-3">
        <p className="flex items-center gap-1.5 text-2xs font-medium tracking-wider text-muted-foreground uppercase">
          <Sparkles className="size-3" aria-hidden />
          Settings used
        </p>
        <p className="line-clamp-3 text-xs leading-relaxed">
          {job.params.prompt || (
            <span className="text-muted-foreground">No prompt</span>
          )}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground tabular-nums">
          <span>{job.params.aspectRatio}</span>
          <span>{job.params.resolution}px</span>
          <span>creativity {Math.round(job.params.creativity * 100)}%</span>
          {job.params.seed !== null ? (
            <span>seed {job.params.seed}</span>
          ) : null}
          <span>{job.creditCost} credits</span>
        </div>
      </div>
    </div>
  );
}
