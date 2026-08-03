"use client";

import { AlertCircle, Check, Loader2, Pencil } from "lucide-react";

import type { SaveState } from "@/features/projects/lib/use-autosave";
import { cn } from "@/lib/utils";

/**
 * What autosave is actually doing.
 *
 * The whole justification for removing the Save button is that this replaces
 * it, so it has to be truthful about all five states rather than showing a tick
 * as soon as a key is pressed. `error` in particular has to be visible and
 * stay visible — an autosaving form that fails silently is worse than a form
 * with a button, because the user has no reason to suspect anything.
 *
 * `aria-live="polite"` so a screen reader hears the outcome without being
 * interrupted mid-sentence on every keystroke.
 */
export function SaveIndicator({
  state,
  className,
}: {
  state: SaveState;
  className?: string;
}) {
  const content = {
    idle: null,
    dirty: {
      icon: Pencil,
      label: "Unsaved changes",
      tone: "text-muted-foreground",
    },
    saving: { icon: Loader2, label: "Saving…", tone: "text-muted-foreground" },
    saved: { icon: Check, label: "Saved", tone: "text-success" },
    error: {
      icon: AlertCircle,
      label: "Could not save — retrying",
      tone: "text-destructive",
    },
  }[state];

  return (
    <p
      aria-live="polite"
      className={cn(
        "flex h-5 items-center gap-1.5 text-2xs",
        content?.tone,
        className,
      )}
    >
      {content ? (
        <>
          <content.icon
            className={cn("size-3", state === "saving" && "animate-spin")}
            aria-hidden
          />
          {content.label}
        </>
      ) : null}
    </p>
  );
}
