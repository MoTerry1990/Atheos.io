"use client";

import { Dice5, Lock, LockOpen, RectangleHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import { Control } from "@/features/studio/components/model-picker";
import {
  dimensionsFor,
  resolutionOptions,
} from "@/features/studio/data/models";
import { useSelectedModel } from "@/features/studio/lib/use-model";
import { ASPECT_RATIO_LABELS } from "@/features/studio/data/presets";
import { useStudioStore } from "@/store/studio-store";
import { cn } from "@/lib/utils";

/**
 * Aspect ratio, size, outputs, creativity and seed.
 *
 * Every control here is rendered from the selected model's declared
 * capabilities. That is the Sprint 0 provider seam paying off: this component
 * does not know which vendor it is configuring, only what the chosen model says
 * it accepts.
 */

/**
 * Aspect ratio, drawn to scale.
 *
 * The swatch is the actual proportion, which is faster to read than "16:9" and
 * removes the moment of translation between a label and a shape.
 */
function AspectRatioPicker() {
  const params = useStudioStore((state) => state.params);
  const setParam = useStudioStore((state) => state.setParam);
  const model = useSelectedModel();

  return (
    <Control label="Aspect ratio">
      <div className="flex flex-wrap gap-2">
        {model.capabilities.aspectRatios.map((ratio) => {
          const [w, h] = ratio.split(":").map(Number);
          const active = params.aspectRatio === ratio;
          const scale = 22 / Math.max(w, h);

          return (
            <button
              key={ratio}
              type="button"
              onClick={() => setParam("aspectRatio", ratio)}
              aria-pressed={active}
              title={ASPECT_RATIO_LABELS[ratio] ?? ratio}
              className={cn(
                "flex min-w-[4.25rem] flex-col items-center gap-1.5 rounded-lg border px-2 py-2 transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                active
                  ? "border-primary/40 bg-primary/10"
                  : "border-border hover:border-border/80",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "rounded-[3px] border",
                  active
                    ? "border-primary bg-primary/20"
                    : "border-muted-foreground/50",
                )}
                style={{ width: w * scale, height: h * scale }}
              />
              <span
                className={cn(
                  "text-2xs tabular-nums",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {ratio}
              </span>
            </button>
          );
        })}
      </div>
    </Control>
  );
}

function SizePicker() {
  const params = useStudioStore((state) => state.params);
  const setParam = useStudioStore((state) => state.setParam);
  const model = useSelectedModel();

  const options = resolutionOptions(model);
  const { width, height } = dimensionsFor(
    params.aspectRatio,
    params.resolution,
  );

  return (
    <Control label="Size" hint={`${width} × ${height}`}>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = params.resolution === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setParam("resolution", option)}
              aria-pressed={active}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs tabular-nums transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                active
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {option}px
            </button>
          );
        })}
      </div>
    </Control>
  );
}

/**
 * Creativity.
 *
 * Presented as creativity, stored as creativity, translated to guidance scale
 * at submit. Providers express this parameter inverted — as how *strictly* to
 * follow the prompt — and asking a user to reason in terms of "guidance scale
 * 7.5" is asking them to learn an implementation detail of diffusion sampling.
 *
 * The end labels do the real work. A bare 0–1 slider communicates nothing about
 * which direction is which.
 */
function CreativitySlider() {
  const creativity = useStudioStore((state) => state.params.creativity);
  const setParam = useStudioStore((state) => state.setParam);

  return (
    <Control label="Creativity" hint={`${Math.round(creativity * 100)}%`}>
      <div className="space-y-1.5">
        <Slider
          value={[creativity]}
          onValueChange={([value]) => setParam("creativity", value)}
          min={0}
          max={1}
          step={0.05}
          aria-label="Creativity"
        />
        <div className="flex justify-between text-2xs text-muted-foreground">
          <span>Follow the prompt closely</span>
          <span>Interpret freely</span>
        </div>
      </div>
    </Control>
  );
}

/**
 * Seed.
 *
 * The lock is the whole feature. An unlocked seed changes every run, which is
 * what you want while exploring; a locked one holds it steady so a single
 * parameter can be changed in isolation. Without the lock, comparing two
 * settings is impossible because two variables moved.
 */
function SeedControl() {
  const params = useStudioStore((state) => state.params);
  const setParam = useStudioStore((state) => state.setParam);
  const randomiseSeed = useStudioStore((state) => state.randomiseSeed);
  const model = useSelectedModel();

  if (!model.capabilities.supportsSeed) {
    return (
      <p className="text-xs text-muted-foreground">
        {model.displayName} does not expose a seed.
      </p>
    );
  }

  return (
    <Control
      label="Seed"
      hint={params.seedLocked ? "Locked" : "Random each run"}
    >
      <div className="flex gap-2">
        <InputField
          value={params.seed ?? ""}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "");
            setParam("seed", digits ? Number(digits) : null);
          }}
          placeholder="Random"
          inputMode="numeric"
          aria-label="Seed"
          className="font-mono tabular-nums"
        />
        <Button
          variant="outline"
          size="icon"
          onClick={randomiseSeed}
          aria-label="Randomise seed"
          title="Randomise seed"
        >
          <Dice5 />
        </Button>
        <Button
          variant={params.seedLocked ? "glow" : "outline"}
          size="icon"
          onClick={() => setParam("seedLocked", !params.seedLocked)}
          aria-pressed={params.seedLocked}
          aria-label={params.seedLocked ? "Unlock seed" : "Lock seed"}
          title={
            params.seedLocked
              ? "Seed stays the same between runs"
              : "Seed changes each run"
          }
        >
          {params.seedLocked ? <Lock /> : <LockOpen />}
        </Button>
      </div>
    </Control>
  );
}

function OutputCount() {
  const params = useStudioStore((state) => state.params);
  const setParam = useStudioStore((state) => state.setParam);
  const model = useSelectedModel();
  const max = model.capabilities.maxOutputs;

  if (max <= 1) return null;

  return (
    <Control
      label="Outputs"
      hint={`${params.outputs} × ${model.creditCost} credits`}
    >
      <div className="flex gap-1.5">
        {Array.from({ length: max }, (_, index) => index + 1).map((count) => {
          const active = params.outputs === count;
          return (
            <button
              key={count}
              type="button"
              onClick={() => setParam("outputs", count)}
              aria-pressed={active}
              className={cn(
                "size-9 rounded-md border text-sm tabular-nums transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                active
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {count}
            </button>
          );
        })}
      </div>
    </Control>
  );
}

export function OutputSettings() {
  return (
    <div className="space-y-5">
      <AspectRatioPicker />
      <SizePicker />
      <OutputCount />
    </div>
  );
}

export function AdvancedSettings() {
  return (
    <div className="space-y-5">
      <CreativitySlider />
      <SeedControl />
    </div>
  );
}

export { RectangleHorizontal };
