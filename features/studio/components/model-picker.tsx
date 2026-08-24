"use client";

import { Check, ChevronDown, Clock, Coins } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useModels, useSelectedModel } from "@/features/studio/lib/use-model";
import { creditsFor } from "@/services/ai/pricing";
import { useStudioStore } from "@/store/studio-store";
import { cn } from "@/lib/utils";

/**
 * Model selection.
 *
 * Cost and typical duration are on every row, because they are the two things
 * that actually decide the choice. A picker that shows only names makes the
 * user discover the price after they have committed, which is the wrong order.
 *
 * Grouped by modality: image and video models are not alternatives to each
 * other, and an undifferentiated list invites picking a three-minute video
 * model for a quick image draft.
 *
 * Switching models runs `reconcileParams` in the store, which repairs any
 * setting the new model cannot honour. Without that, the composer keeps
 * displaying values that will be silently ignored at submit.
 *
 * ## Every price here is the price of *this* generation
 *
 * The rows used to show `model.creditCost`, which is the price at the model's
 * **base duration** for a single output. The Generate button showed
 * `creditsFor(model, outputs, durationSeconds)`. For a video at any other
 * duration those are different numbers, and the studio displayed 90 in the
 * picker and 135 on the button for one unchanged request.
 *
 * Both now call `creditsFor` with the composer's actual parameters — the same
 * function the server charges with. A price the user reads before choosing and
 * a price they are charged after have to come from one place or they will
 * eventually disagree, and the picker is exactly where a wrong one does the
 * most damage: it is what the choice is made on.
 */
const BADGES = {
  fastest: { label: "Fastest", variant: "info" as const },
  "highest-quality": { label: "Best quality", variant: "brand" as const },
  new: { label: "New", variant: "gradient" as const },
};

export function ModelPicker() {
  const modelId = useStudioStore((state) => state.params.modelId);
  const setModel = useStudioStore((state) => state.setModel);
  const models = useModels();
  const current = useSelectedModel();

  /**
   * Outputs and duration, so every row prices the request being made.
   *
   * Read from the store rather than passed in: the picker sits beside the
   * controls that set them, and threading them through the tree would make it
   * possible to render a stale price.
   */
  const outputs = useStudioStore((state) => state.params.outputs);
  const durationSeconds = useStudioStore(
    (state) => state.params.durationSeconds,
  );

  const priceOf = (model: (typeof models)[number]) =>
    creditsFor(model, outputs, durationSeconds);

  const byModality = models.reduce<Record<string, typeof models>>(
    (groups, model) => {
      (groups[model.modality] ??= []).push(model);
      return groups;
    },
    {},
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-auto w-full justify-between py-2.5"
        >
          <span className="flex min-w-0 flex-col items-start">
            <span className="flex items-center gap-2 text-sm font-medium">
              {current.displayName}
              {current.badge ? (
                <Badge variant={BADGES[current.badge].variant} size="sm">
                  {BADGES[current.badge].label}
                </Badge>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">
              {priceOf(current)} credits · ~{current.typicalSeconds}s
            </span>
          </span>
          <ChevronDown className="shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[min(24rem,90vw)]">
        {Object.entries(byModality).map(([modality, models], groupIndex) => (
          <div key={modality}>
            {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-2xs tracking-wider uppercase">
              {modality.toLowerCase()}
            </DropdownMenuLabel>

            {models.map((model) => (
              <DropdownMenuItem
                key={model.id}
                onClick={() => setModel(model.id)}
                className="flex-col items-start gap-1 py-2.5"
              >
                <span className="flex w-full items-center gap-2">
                  <span className="text-sm font-medium">
                    {model.displayName}
                  </span>
                  {model.badge ? (
                    <Badge variant={BADGES[model.badge].variant} size="sm">
                      {BADGES[model.badge].label}
                    </Badge>
                  ) : null}
                  {model.id === modelId ? (
                    <Check
                      className="ml-auto size-4 text-primary"
                      aria-hidden
                    />
                  ) : null}
                </span>

                <span className="text-xs text-wrap text-muted-foreground">
                  {model.description}
                </span>

                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Coins className="size-3" aria-hidden />
                    {priceOf(model)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" aria-hidden />~
                    {model.typicalSeconds}s
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Small labelled section wrapper used throughout the composer. */
export function Control({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        {hint ? (
          <p className="text-xs text-muted-foreground tabular-nums">{hint}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
