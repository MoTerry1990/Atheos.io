"use client";

import { AudioLines, ImageIcon, Type, Video } from "lucide-react";
import { motion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The modality rail — the left edge of the workspace.
 *
 * ## Four modalities, two of which do not work
 *
 * Image and video are real. **Audio and text are not**: `services/ai/engine.ts`
 * rejects both with `unsupported_operation`, because no adapter implements
 * either.
 *
 * They are shown anyway, and shown as **disabled with a reason**. The
 * alternative designs are both worse:
 *
 *   - *Hide them.* The product's own marketing says three modalities, and two
 *     voice packs sit in the marketplace. Hiding audio here makes the product
 *     look inconsistent with itself and gives a user no way to find out where
 *     it went.
 *   - *Show them as working.* A user selects Audio, writes a prompt, presses
 *     generate and gets an error. That is a worse minute than the one they
 *     would have had reading "not available yet".
 *
 * A disabled control that says why is the honest third option, and it is the
 * one the rest of this codebase already uses — the marketplace's voice packs
 * install and say they do nothing, for the same reason.
 *
 * ## The selection indicator is a shared layout animation
 *
 * `layoutId` means Framer Motion animates the pill *between* buttons rather
 * than cross-fading two of them. That is the difference between a selection
 * that moves and one that blinks, and it is a single prop rather than a
 * hand-written transition.
 */

export type Modality = "image" | "video" | "audio" | "text";

interface ModalityOption {
  id: Modality;
  label: string;
  icon: typeof ImageIcon;
  available: boolean;
  /** Shown in the tooltip when unavailable. Never vague. */
  unavailableReason?: string;
}

const MODALITIES: readonly ModalityOption[] = [
  { id: "image", label: "Image", icon: ImageIcon, available: true },
  { id: "video", label: "Video", icon: Video, available: true },
  {
    id: "audio",
    label: "Audio",
    icon: AudioLines,
    available: false,
    unavailableReason: "No provider generates audio yet.",
  },
  {
    id: "text",
    label: "Text",
    icon: Type,
    available: false,
    unavailableReason: "Text generation is not part of the studio.",
  },
];

export function ModalityRail({
  value,
  onChange,
  className,
}: {
  value: Modality;
  onChange: (next: Modality) => void;
  className?: string;
}) {
  return (
    // The rail owns its own provider rather than assuming an ancestor supplies
    // one. It does not: the studio preview route renders this component outside
    // the app shell, and the build failed on exactly that. A component that
    // needs a context should carry it — relying on a distant ancestor makes the
    // component unusable anywhere else, which is what a preview route is for.
    <TooltipProvider delayDuration={300}>
      <nav
        aria-label="Output type"
        className={cn(
          "flex shrink-0 gap-1 lg:flex-col",
          "border-border lg:border-r lg:pr-2",
          className,
        )}
      >
        {MODALITIES.map((modality) => {
          const Icon = modality.icon;
          const selected = value === modality.id;

          const button = (
            <button
              key={modality.id}
              type="button"
              // `aria-current` rather than `aria-selected`: this is navigation
              // between views, not a listbox, and `aria-selected` on a button
              // outside a composite widget is ignored by most screen readers.
              aria-current={selected ? "true" : undefined}
              aria-disabled={!modality.available}
              disabled={!modality.available}
              onClick={() => modality.available && onChange(modality.id)}
              className={cn(
                // 44px square: comfortably past WCAG 2.5.8's 24px, and this rail
                // is the primary navigation of the workspace.
                "relative grid size-11 place-items-center rounded-lg transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                selected
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
                !modality.available && "cursor-not-allowed opacity-40",
              )}
            >
              {selected ? (
                <motion.span
                  aria-hidden
                  layoutId="modality-indicator"
                  className="absolute inset-0 rounded-lg bg-accent"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              ) : null}

              <Icon className="relative size-5" aria-hidden />
              <span className="sr-only">
                {modality.label}
                {modality.available ? "" : " — not available"}
              </span>
            </button>
          );

          // A disabled button fires no pointer events, so a tooltip trigger
          // wrapping it directly never opens. The span is what receives them.
          return modality.available ? (
            <Tooltip key={modality.id}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="right">{modality.label}</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip key={modality.id}>
              <TooltipTrigger asChild>
                <span className="inline-flex">{button}</span>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-56">
                <span className="font-medium">{modality.label}</span>
                <br />
                {modality.unavailableReason}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}

/** Banner shown when a user lands on a modality that cannot run. */
export function ModalityUnavailable({ modality }: { modality: Modality }) {
  const option = MODALITIES.find((m) => m.id === modality);
  if (!option || option.available) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-4">
      <div className="flex items-center gap-2">
        <Badge variant="warning" size="sm">
          Not available
        </Badge>
        <p className="text-sm font-medium">{option.label} generation</p>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {option.unavailableReason} Nothing here is a placeholder for it — when a
        provider implements it, this panel becomes the composer.
      </p>
    </div>
  );
}
