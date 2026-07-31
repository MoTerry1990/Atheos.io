"use client";

import { Camera, Palette, X } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Control } from "@/features/studio/components/model-picker";
import {
  CAMERA_OPTIONS,
  STYLE_PRESETS,
  type CameraAxis,
} from "@/features/studio/data/presets";
import { useStudioStore } from "@/store/studio-store";
import { cn } from "@/lib/utils";

/**
 * Style presets and camera controls.
 *
 * ## Presets are chips, not a select
 *
 * They combine — "cinematic" and "analog" together is a real and useful
 * choice — so the control has to be multi-select. Chips also make the active
 * set visible at a glance, which a multi-select never does.
 *
 * Each chip carries its own hue, so the palette reads as a set of looks rather
 * than a wall of identical buttons.
 *
 * ## Camera controls are single-select per axis
 *
 * Two shot sizes in one prompt is a contradiction, so selecting a value in an
 * axis replaces the previous one. Clicking the active value clears it — the
 * axis is genuinely optional, and a control with no way back to "unset" is a
 * trap.
 *
 * Collapsed by default. Most generations never touch these, and an expanded
 * accordion of 25 chips would bury the prompt field the user actually came for.
 */
export function StyleAndCamera() {
  const presetIds = useStudioStore((state) => state.params.presetIds);
  const camera = useStudioStore((state) => state.params.camera);
  const togglePreset = useStudioStore((state) => state.togglePreset);
  const setCamera = useStudioStore((state) => state.setCamera);

  const activeCameraCount = Object.values(camera).filter(Boolean).length;

  return (
    <Accordion type="multiple" className="w-full">
      <AccordionItem value="style">
        <AccordionTrigger className="text-sm">
          <span className="flex items-center gap-2">
            <Palette className="size-4 text-muted-foreground" aria-hidden />
            Style presets
            {presetIds.length > 0 ? (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-2xs font-medium text-primary tabular-nums">
                {presetIds.length}
              </span>
            ) : null}
          </span>
        </AccordionTrigger>

        <AccordionContent>
          <div className="flex flex-wrap gap-2 pt-1">
            {STYLE_PRESETS.map((preset) => {
              const active = presetIds.includes(preset.id);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => togglePreset(preset.id)}
                  aria-pressed={active}
                  title={preset.fragment}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                    "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                    active
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: `oklch(0.7 0.18 ${preset.hue})`,
                      opacity: active ? 1 : 0.5,
                    }}
                  />
                  {preset.name}
                </button>
              );
            })}
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="camera">
        <AccordionTrigger className="text-sm">
          <span className="flex items-center gap-2">
            <Camera className="size-4 text-muted-foreground" aria-hidden />
            Camera
            {activeCameraCount > 0 ? (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-2xs font-medium text-primary tabular-nums">
                {activeCameraCount}
              </span>
            ) : null}
          </span>
        </AccordionTrigger>

        <AccordionContent>
          <div className="space-y-4 pt-1">
            {(Object.keys(CAMERA_OPTIONS) as CameraAxis[]).map((axis) => {
              const option = CAMERA_OPTIONS[axis];
              const selected = camera[axis];

              return (
                <Control
                  key={axis}
                  label={option.label}
                  hint={selected ? undefined : "Optional"}
                >
                  <div className="flex flex-wrap gap-1.5">
                    {option.values.map((value) => {
                      const active = selected === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          // Clicking the active value clears the axis. Without
                          // this there is no way back to "unset".
                          onClick={() => setCamera(axis, active ? null : value)}
                          aria-pressed={active}
                          className={cn(
                            "rounded-md border px-2 py-1 text-xs transition-colors",
                            "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                            active
                              ? "border-primary/40 bg-primary/10 text-foreground"
                              : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {value}
                          {active ? (
                            <X className="ml-1 inline size-3" aria-hidden />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </Control>
              );
            })}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
