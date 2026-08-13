"use client";

import { Camera, Palette, UserRound } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Chip, ChipGroup } from "@/features/studio/components/chip";
import { Control } from "@/features/studio/components/model-picker";
import {
  CAMERA_OPTIONS,
  STYLE_PRESETS,
  type CameraAxis,
} from "@/features/studio/data/presets";
import { useStudioStore } from "@/store/studio-store";

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
  const installed = useStudioStore((state) => state.installed);
  const setParam = useStudioStore((state) => state.setParam);
  const prompt = useStudioStore((state) => state.params.prompt);

  // Built-in presets and downloaded ones render as one list. Ids are namespaced
  // in `lib/installed.ts`, so a pack style called "cinematic" cannot silently
  // shadow the built-in one.
  const allPresets = [...STYLE_PRESETS, ...installed.styles];

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
          <ChipGroup className="pt-1">
            {allPresets.map((preset) => {
              const active = presetIds.includes(preset.id);
              return (
                <Chip
                  key={preset.id}
                  active={active}
                  onClick={() => togglePreset(preset.id)}
                  title={
                    "source" in preset && preset.source
                      ? `${preset.fragment}

From ${preset.source}`
                      : preset.fragment
                  }
                >
                  {/* Each preset carries its own hue, so the palette reads as
                      a set of looks rather than a wall of identical buttons. */}
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full transition-opacity"
                    style={{
                      backgroundColor: `oklch(0.7 0.18 ${preset.hue})`,
                      opacity: active ? 1 : 0.55,
                    }}
                  />
                  {preset.name}
                </Chip>
              );
            })}
          </ChipGroup>
        </AccordionContent>
      </AccordionItem>

      {/* Only when something is installed. An empty section teaching people
          that characters exist is the marketplace's job, not the composer's. */}
      {installed.characters.length > 0 ? (
        <AccordionItem value="characters">
          <AccordionTrigger className="text-sm">
            <span className="flex items-center gap-2">
              <UserRound className="size-4 text-muted-foreground" aria-hidden />
              Characters
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-2xs font-medium text-primary tabular-nums">
                {installed.characters.length}
              </span>
            </span>
          </AccordionTrigger>

          <AccordionContent>
            <div className="space-y-2 pt-1">
              {/* A character inserts its anchor text **into the prompt field**,
                  where it can be read and edited, rather than being appended
                  invisibly at submit like a preset. A described subject is
                  something people rewrite constantly — changing the hair, the
                  clothing, the age — and a fragment they cannot reach is a
                  fragment they cannot adjust. */}
              {installed.characters.map((character) => (
                <div
                  key={character.id}
                  className="rounded-lg border border-border p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium">{character.name}</p>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        setParam(
                          "prompt",
                          prompt.trim()
                            ? `${prompt.trim()}, ${character.anchor}`
                            : character.anchor,
                        )
                      }
                    >
                      Insert
                    </Button>
                  </div>
                  <p className="mt-1 line-clamp-3 text-2xs text-muted-foreground">
                    {character.anchor}
                  </p>
                  {character.seed !== undefined ? (
                    <button
                      type="button"
                      onClick={() => setParam("seed", character.seed ?? null)}
                      className="mt-1.5 text-2xs text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                    >
                      Use reference seed {character.seed}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      ) : null}

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
                  <ChipGroup>
                    {option.values.map((value) => {
                      const active = selected === value;
                      return (
                        <Chip
                          key={value}
                          shape="square"
                          active={active}
                          clearable
                          // Clicking the active value clears the axis. Without
                          // this there is no way back to "unset".
                          onClick={() => setCamera(axis, active ? null : value)}
                        >
                          {value}
                        </Chip>
                      );
                    })}
                  </ChipGroup>
                </Control>
              );
            })}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
