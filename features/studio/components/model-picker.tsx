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
import { STUDIO_MODELS, findModel } from "@/features/studio/data/models";
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
 */
const BADGES = {
  fastest: { label: "Fastest", variant: "info" as const },
  "highest-quality": { label: "Best quality", variant: "brand" as const },
  new: { label: "New", variant: "gradient" as const },
};

export function ModelPicker() {
  const modelId = useStudioStore((state) => state.params.modelId);
  const setModel = useStudioStore((state) => state.setModel);
  const current = findModel(modelId);

  const byModality = STUDIO_MODELS.reduce<Record<string, typeof STUDIO_MODELS>>(
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
              {current.creditCost} credits · ~{current.typicalSeconds}s
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
                    {model.creditCost}
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
