"use client";

import {
  AlertCircle,
  Clapperboard,
  Download,
  Globe,
  ImageIcon,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state";
import { ProgressBar, Spinner } from "@/components/ui/loading";
import {
  OutputTile,
  downloadOutput,
  isVideoOutput,
} from "@/features/studio/components/output-tile";
import { OutputActions } from "@/features/studio/components/output-actions";
import { SaveToProject } from "@/features/studio/components/save-to-project";
import { PublishDialog } from "@/features/community/components/publish-dialog";
import { useCommunityApi } from "@/features/community/lib/api-context";
import type { StudioJob } from "@/features/studio/types";
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
/**
 * Wall-clock time since a job was submitted.
 *
 * Derived from `Date.now()` on every tick rather than counted up, because a
 * background tab throttles `setInterval` to roughly once a second at best and
 * pauses it outright when the tab is hidden. Counting ticks would show 40
 * seconds for a job that has been running for three minutes — a bug this
 * codebase has already made once, in the Sprint 5 studio runner.
 *
 * Mounted only while a job is running, so nothing ticks on an idle panel.
 */
/**
 * Publish the first output.
 *
 * The whole-post decision belongs to one asset, so this offers the first
 * output rather than the whole job — a four-image batch is four separate
 * decisions, and publishing them as one would be publishing three the user did
 * not look at.
 *
 * Whether a handle exists is checked lazily, when the dialog opens. Fetching it
 * on every preview render would be a request per generation for a button most
 * people never press.
 */
function PublishAction({ job }: { job: StudioJob }) {
  const api = useCommunityApi();
  const [open, setOpen] = useState(false);
  const [hasHandle, setHasHandle] = useState(true);

  const output = job.outputs[0];
  if (job.status !== "succeeded" || !output?.url) return null;

  return (
    <>
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          setOpen(true);
          api
            .loadMyProfile()
            .then((data) => setHasHandle(Boolean(data.profile)))
            // A failed check assumes a handle exists. The publish call itself
            // returns `handle_required` if not, so the worst case is one extra
            // round trip rather than a dialog that refuses somebody who is
            // perfectly able to publish.
            .catch(() => setHasHandle(true));
        }}
      >
        <Globe />
        Publish
      </Button>

      <PublishDialog
        open={open}
        onOpenChange={setOpen}
        assetId={output.id}
        hasHandle={hasHandle}
      />
    </>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.round((now - since) / 1000));
  const label =
    seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;

  return (
    <p className="text-2xs text-muted-foreground tabular-nums">
      {label} elapsed
    </p>
  );
}

export function PreviewPanel({
  /**
   * "Animate this", when the Director is available to run it.
   *
   * Optional because the preview panel is also mounted by `/studio-preview`,
   * which has no Director. An absent handler hides the button rather than
   * offering an action that would do nothing.
   */
  onAnimate,
}: {
  onAnimate?: (assetId?: string) => void | Promise<void>;
} = {}) {
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
  const isVideoJob = job.outputs.some(isVideoOutput);
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

          {/* Only for a still that actually exists.

              The old studio had no such action at all: "now make this image a
              video" was typed into the prompt box, which switched the modality
              and submitted a fresh text-to-video carrying the *image's* prompt
              and no picture. The button exists so the intent has somewhere to
              go that carries the asset with it. */}
          {onAnimate &&
          job.status === "succeeded" &&
          job.outputs[0]?.url &&
          job.outputs[0].mimeType.startsWith("image/") ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onAnimate(job.outputs[0].id)}
              title="Plan a video that starts from this picture"
            >
              <Clapperboard />
              Animate this
            </Button>
          ) : null}

          {job.outputs.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => job.outputs.forEach(downloadOutput)}
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
              {/* The only honest number available for a video model, and the
                  one that stops a two-minute wait feeling like a hang. A faked
                  percentage would be worse than none. */}
              <Elapsed since={job.createdAt} />
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
              <OutputTile key={output.id} output={output} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3 border-t p-3">
        {/* Derived operations live beside the result they act on — upscale,
            background removal and variations all need an existing image. */}
        <div className="flex flex-wrap items-center gap-2">
          <SaveToProject job={job} />
          <PublishAction job={job} />
          <OutputActions job={job} output={job.outputs[0] ?? null} />
        </div>

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
          {/* Shown only when a clip was actually produced, so an image job does
              not carry a duration it never had. The composer's default value
              would otherwise leak into every history entry. */}
          {isVideoJob ? (
            <>
              <span>{job.params.durationSeconds}s</span>
              {job.params.cameraMotion ? (
                <span>{job.params.cameraMotion}</span>
              ) : null}
            </>
          ) : null}
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
