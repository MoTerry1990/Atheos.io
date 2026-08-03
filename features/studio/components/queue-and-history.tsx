"use client";

import { AnimatePresence, motion } from "motion/react";
import { History, Layers, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/state";
import { ApiError, cancelGeneration } from "@/features/studio/lib/api";
import { useStudioStore } from "@/store/studio-store";
import { formatRelativeTime } from "@/utils/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Queue and history.
 *
 * Two lists of the same thing at different stages, so they share a row
 * component and a selection model. Clicking either puts it in the preview.
 *
 * ## Neither list is persisted locally any more
 *
 * Both come from the server on mount, split by status. That replaced a
 * persisted queue, which described work that was not running — on reload those
 * jobs sat at "running" forever, a state the interface had to lie about. Asking
 * the server means a reload learns what actually happened, and anything still
 * unfinished is picked back up by the workspace's poller rather than stranded.
 *
 * ## Exit animations
 *
 * `AnimatePresence` on the queue matters more than it looks: a job leaves the
 * queue the instant it finishes, and without an exit the list snaps and the row
 * the user was reading vanishes mid-sentence. The exit gives the eye somewhere
 * to follow.
 */

function StatusDot({ status }: { status: string }) {
  return (
    <Badge
      variant={
        status === "succeeded"
          ? "success"
          : status === "failed"
            ? "danger"
            : "info"
      }
      size="sm"
      dot
      pulse={status === "running" || status === "queued"}
    >
      {status}
    </Badge>
  );
}

export function QueuePanel() {
  const queue = useStudioStore((state) => state.queue);
  const selectedJobId = useStudioStore((state) => state.selectedJobId);
  const selectJob = useStudioStore((state) => state.selectJob);
  const cancelJob = useStudioStore((state) => state.cancelJob);

  /**
   * Cancel on the server, then locally.
   *
   * Dropping the row without telling the server would leave a generation
   * running that nobody is watching — the provider still bills us for it, and
   * the user's credits are never refunded because nothing settles the job. The
   * DELETE does both.
   *
   * The row is removed regardless of the outcome: a cancel that failed because
   * the job had already finished is not something to make the user act on, and
   * the next load reconciles against the server anyway.
   */
  async function cancel(id: string) {
    try {
      await cancelGeneration(id);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status !== 404) {
        toast.error("Could not cancel", { description: cause.message });
      }
    } finally {
      cancelJob(id);
    }
  }

  return (
    <section aria-labelledby="queue-heading" className="space-y-3">
      <h2
        id="queue-heading"
        className="flex items-center gap-2 text-sm font-medium"
      >
        <Layers className="size-4 text-muted-foreground" aria-hidden />
        Queue
        {queue.length > 0 ? (
          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-2xs font-medium text-primary tabular-nums">
            {queue.length}
          </span>
        ) : null}
      </h2>

      {queue.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Nothing running.
        </p>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {queue.map((job) => (
              <motion.li
                key={job.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
              >
                <button
                  type="button"
                  onClick={() => selectJob(job.id)}
                  className={cn(
                    "w-full rounded-lg border p-2.5 text-left transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                    selectedJobId === job.id
                      ? "border-primary/40 bg-primary/5"
                      : "border-border hover:border-border/80",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <StatusDot status={job.status} />
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        void cancel(job.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          void cancel(job.id);
                        }
                      }}
                      aria-label="Cancel job"
                      className="-m-1 shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <X className="size-3.5" />
                    </span>
                  </div>

                  <p className="mt-1.5 line-clamp-2 text-xs">
                    {job.params.prompt || "No prompt"}
                  </p>

                  <div className="mt-2 space-y-1">
                    <ProgressBar
                      size="sm"
                      value={
                        job.progress === null ? undefined : job.progress * 100
                      }
                      label={`Progress for ${job.modelName}`}
                    />
                    {/* When the queue is picked back up after a reload, the
                        start time is the only thing that distinguishes a job
                        submitted moments ago from one that has been running
                        since before this tab existed. */}
                    <p className="text-2xs text-muted-foreground">
                      started {formatRelativeTime(job.createdAt)}
                    </p>
                  </div>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

export function HistoryPanel() {
  const history = useStudioStore((state) => state.history);
  const selectedJobId = useStudioStore((state) => state.selectedJobId);
  const selectJob = useStudioStore((state) => state.selectJob);
  const clearHistory = useStudioStore((state) => state.clearHistory);

  return (
    <section aria-labelledby="history-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2
          id="history-heading"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <History className="size-4 text-muted-foreground" aria-hidden />
          History
        </h2>

        {history.length > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={clearHistory}
            className="text-muted-foreground"
          >
            <Trash2 />
            Clear
          </Button>
        ) : null}
      </div>

      {history.length === 0 ? (
        <div className="rounded-lg border border-border">
          <EmptyState
            title="No history yet"
            description="Finished generations collect here."
            className="min-h-32 py-6"
          />
        </div>
      ) : (
        <ul className="space-y-2">
          {history.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                onClick={() => selectJob(job.id)}
                className={cn(
                  "flex w-full gap-2.5 rounded-lg border p-2 text-left transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                  selectedJobId === job.id
                    ? "border-primary/40 bg-primary/5"
                    : "border-border hover:border-border/80",
                )}
              >
                <span
                  aria-hidden
                  className="size-11 shrink-0 overflow-hidden rounded-md"
                  style={
                    job.outputs[0]
                      ? {
                          backgroundColor: "oklch(0.16 0.02 300)",
                          backgroundImage: `radial-gradient(130% 130% at 30% 25%, oklch(0.7 0.2 ${job.outputs[0].hue} / 0.85), transparent 70%)`,
                        }
                      : { backgroundColor: "var(--muted)" }
                  }
                />

                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-xs">
                    {job.params.prompt || "No prompt"}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground">
                    <StatusDot status={job.status} />
                    <time dateTime={new Date(job.createdAt).toISOString()}>
                      {formatRelativeTime(job.createdAt)}
                    </time>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
