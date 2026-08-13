"use client";

import { Video } from "lucide-react";

import { Chip, ChipGroup } from "@/features/studio/components/chip";
import { Control } from "@/features/studio/components/model-picker";
import { useSelectedModel } from "@/features/studio/lib/use-model";
import { creditsFor } from "@/services/ai/pricing";
import { useStudioStore } from "@/store/studio-store";

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
/**
 * Capitalised for display only.
 *
 * The catalogue stores these lowercase because the raw value is appended to
 * the prompt, where "Slow Push In" would read as an odd shout. A chip cloud of
 * uncapitalised fragments looks like placeholder data, so the transform is
 * applied at the point of display and nowhere else.
 */
function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

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
    <div className="space-y-5 rounded-xl border border-border bg-card/60 p-5">
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
          <ChipGroup>
            {durations.map((seconds) => (
              <Chip
                key={seconds}
                numeric
                active={durationSeconds === seconds}
                onClick={() => setParam("durationSeconds", seconds)}
              >
                {seconds}s
              </Chip>
            ))}
          </ChipGroup>
        </Control>
      ) : null}

      {motions.length > 0 ? (
        <Control
          label="Camera motion"
          hint={cameraMotion ? undefined : "Optional"}
        >
          <ChipGroup>
            {motions.map((motion) => {
              const active = cameraMotion === motion;
              return (
                <Chip
                  key={motion}
                  active={active}
                  clearable
                  // Clicking the active value clears it. The model has its own
                  // idea of how the shot should move when we say nothing, and
                  // there has to be a way back to that.
                  onClick={() =>
                    setParam("cameraMotion", active ? null : motion)
                  }
                >
                  {sentenceCase(motion)}
                </Chip>
              );
            })}
          </ChipGroup>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Added to the prompt when the clip is generated. Video models read
            motion as description, not as a setting.
          </p>
        </Control>
      ) : null}
    </div>
  );
}
