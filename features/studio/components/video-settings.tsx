"use client";

import { Film, Video } from "lucide-react";

import { Control } from "@/features/studio/components/model-picker";
import { useSelectedModel } from "@/features/studio/lib/use-model";
import { creditsFor } from "@/services/ai/pricing";
import { useStudioStore } from "@/store/studio-store";
import { cn } from "@/lib/utils";

/**
 * Duration and camera motion.
 *
 * Rendered only for video models — every control here comes from capabilities
 * the model declares, so an image model has nothing to draw and the section
 * disappears rather than sitting there disabled.
 *
 * ## Duration is a set of buttons, not a slider
 *
 * Video models accept specific clip lengths, not a range. A slider from 1 to 10
 * on a model that produces 5s or 10s clips is an interface that lies four
 * fifths of the time: every intermediate position is silently rounded, and the
 * user is billed for a clip they did not choose. Buttons can only express what
 * the model can actually do.
 *
 * ## Camera motion is separate from the camera controls above
 *
 * `StyleAndCamera` describes a *fixed frame* — shot size, angle, lens,
 * lighting — and applies to stills and clips alike. This describes how that
 * frame moves, which only means something for video. They are two different
 * questions and merging them would put "wide shot" and "pan left" in the same
 * single-select, where choosing one would clear the other for no reason.
 */
export function VideoSettings() {
  const model = useSelectedModel();
  const durationSeconds = useStudioStore(
    (state) => state.params.durationSeconds,
  );
  const cameraMotion = useStudioStore((state) => state.params.cameraMotion);
  const setParam = useStudioStore((state) => state.setParam);

  if (model.modality !== "VIDEO") return null;

  const durations = model.capabilities.durations ?? [];
  const motions = model.capabilities.cameraMotions ?? [];

  return (
    <div className="space-y-5 rounded-xl border border-border bg-card/50 p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Video className="size-4 text-muted-foreground" aria-hidden />
        Video
      </p>

      {durations.length > 0 ? (
        <Control
          label="Duration"
          // Cost is on the label because duration is the control that changes
          // it most: doubling the clip doubles the bill, and finding that out
          // at the Generate button is finding out too late.
          hint={`${creditsFor(model, 1, durationSeconds)} credits`}
        >
          <div className="flex flex-wrap gap-1.5">
            {durations.map((seconds) => {
              const active = durationSeconds === seconds;
              return (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => setParam("durationSeconds", seconds)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs tabular-nums transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                    active
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {seconds}s
                </button>
              );
            })}
          </div>
        </Control>
      ) : null}

      {motions.length > 0 ? (
        <Control
          label="Camera motion"
          hint={cameraMotion ? undefined : "Optional"}
        >
          <div className="flex flex-wrap gap-1.5">
            {motions.map((motion) => {
              const active = cameraMotion === motion;
              return (
                <button
                  key={motion}
                  type="button"
                  // Clicking the active value clears it. The model has its own
                  // idea of how the shot should move when we say nothing, and
                  // there has to be a way back to that.
                  onClick={() =>
                    setParam("cameraMotion", active ? null : motion)
                  }
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                    active
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {active ? (
                    <Film className="size-3 shrink-0" aria-hidden />
                  ) : null}
                  {motion}
                </button>
              );
            })}
          </div>

          <p className="text-2xs text-muted-foreground">
            Added to the prompt when the clip is generated. Video models read
            motion as description, not as a setting.
          </p>
        </Control>
      ) : null}
    </div>
  );
}
