"use client";

import { Eraser, Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * The prompt field.
 *
 * ## Why this is not the shared `Textarea`
 *
 * `components/ui/textarea.tsx` is a form control: `px-3 py-2`, `min-h-16`. That
 * is correct for an email address and wrong for the thing this product is
 * fundamentally about. A creative prompt is a paragraph somebody writes, edits
 * and re-reads, and at twelve pixels of padding on a four-line box it reads as
 * an afterthought — text pressed into the corner of a field it has outgrown.
 *
 * So this is a deliberate editor surface rather than a variant of the form
 * control, and the shared component is left alone for the forms that want it.
 *
 * ## The right-hand gutter is for other people's software
 *
 * Grammarly, LanguageTool and similar inject a floating button into the
 * bottom-right of any textarea they attach to. We cannot control that and
 * should not try — but a prompt whose last words sit underneath somebody's
 * writing assistant is unreadable, and the fix is ours. `pr-12` reserves the
 * lane those buttons land in, and the footer controls deliberately sit *below*
 * the text area rather than floating inside it, so nothing important can end up
 * beneath an overlay we do not own.
 *
 * ## Height is measured, not guessed
 *
 * `field-sizing-content` would be simpler and is not supported widely enough to
 * rely on for the primary input of the product. The measured approach —
 * reset to `auto`, read `scrollHeight`, clamp — works everywhere and gives an
 * exact maximum, after which the box scrolls internally instead of pushing the
 * Create button off the screen.
 */

export type PromptModality = "IMAGE" | "VIDEO" | "AUDIO";

/**
 * Mode-specific guidance.
 *
 * The example is part of the placeholder and never enters the value — it
 * disappears the moment somebody types, which is what a placeholder is for.
 * Prefilling the field with an example instead would mean every user either
 * deletes it or accidentally generates somebody else's idea.
 */
const PLACEHOLDERS: Record<PromptModality, string> = {
  IMAGE:
    "Describe the image you want to create…\n\n" +
    "Example: A cinematic aerial drone photograph of a red convertible driving " +
    "along a coastal road beside a vivid blue ocean.",
  VIDEO:
    "Describe the scene, subject movement, and camera movement…\n\n" +
    "Example: A smooth aerial drone shot following a red convertible along a " +
    "coastal highway, with the ocean beside the road.",
  AUDIO: "Describe the sound, music, voice, mood, and duration…",
};

/** Below this, clearing is not worth a confirmation. */
const CONFIRM_CLEAR_ABOVE = 80;

const MIN_HEIGHT = 140;
const MAX_HEIGHT = 420;
const EXPANDED_MAX_HEIGHT = 720;

export function PromptField({
  value,
  onChange,
  modality,
  onSubmit,
  disabled,
  invalid,
  describedBy,
  footer,
  id = "studio-prompt",
}: {
  value: string;
  onChange: (value: string) => void;
  modality: PromptModality;
  /** Ctrl/Cmd + Enter. Omitted when there is nothing to submit to. */
  onSubmit?: () => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Extra controls for the footer — enhance, undo — supplied by the caller. */
  footer?: React.ReactNode;
  id?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  /**
   * True while an input-method editor is mid-composition.
   *
   * Typing Japanese, Chinese or Korean routes through a composition session
   * where Enter *commits the candidate* rather than ending the sentence. Firing
   * generate on that keystroke would submit a half-written prompt and charge
   * for it, so the shortcut stands down until composition ends.
   */
  const composing = useRef(false);

  const maxHeight = expanded ? EXPANDED_MAX_HEIGHT : MAX_HEIGHT;

  const resize = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    // Reset first: without it `scrollHeight` only ever grows, so the box can
    // never shrink back after text is deleted.
    node.style.height = "auto";
    const next = Math.min(Math.max(node.scrollHeight, MIN_HEIGHT), maxHeight);
    node.style.height = `${next}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxHeight]);

  // Re-measure on value or mode change, so pasted text and a switch between
  // expanded and normal both settle immediately rather than on next keystroke.
  useEffect(resize, [value, expanded, resize]);

  useEffect(() => {
    if (!confirmingClear) return;
    const timer = setTimeout(() => setConfirmingClear(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmingClear]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    /**
     * Escape blurs; it never clears.
     *
     * Losing a paragraph to a key people press to dismiss things is not
     * recoverable through the browser's undo once React has re-rendered, and
     * the prompt is the most expensive text in the product to retype.
     */
    if (event.key === "Escape") {
      event.currentTarget.blur();
      return;
    }

    if (event.key !== "Enter") return;
    if (!(event.metaKey || event.ctrlKey)) return;
    // `keyCode === 229` is the legacy signal some browsers still use for a
    // composing key event; `composing.current` covers the rest.
    if (composing.current || event.nativeEvent.isComposing) return;
    if (!onSubmit || disabled || value.trim() === "") return;

    event.preventDefault();
    onSubmit();
  }

  function clear() {
    if (value.length > CONFIRM_CLEAR_ABOVE && !confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    onChange("");
    setConfirmingClear(false);
    ref.current?.focus();
  }

  return (
    <div className="space-y-2">
      <div
        className={cn(
          // The editor surface. A container rather than styling on the textarea
          // itself, so the focus ring can wrap the footer too and the whole
          // thing reads as one object.
          "rounded-xl border bg-surface-sunken",
          "transition-colors motion-reduce:transition-none",
          // Focus-within, not focus: clicking the footer must not make the
          // editor look like it lost focus.
          "focus-within:border-brand focus-within:ring-brand/30 focus-within:ring-2",
          invalid ? "border-destructive" : "border-border",
          disabled && "opacity-60",
        )}
      >
        <Textarea
          ref={ref}
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          placeholder={PLACEHOLDERS[modality]}
          disabled={disabled}
          invalid={invalid}
          aria-describedby={describedBy}
          spellCheck
          data-studio-prompt
          style={{ minHeight: MIN_HEIGHT }}
          /**
           * The spacing, typography and wrapping now come from the shared
           * primitive rather than being restated here. This file proved the
           * numbers; `components/ui/textarea.tsx` owns them, so every other
           * multiline field in Atheos gets them too and this one cannot drift
           * away from the rest of the product.
           */
          overlayRight
          className={cn(
            // The container draws the border and the focus ring, so the control
            // itself has neither.
            "resize-none border-0 bg-transparent shadow-none",
            "focus-visible:border-0 focus-visible:ring-0",
            // Height is measured in `resize()` below, so the content-sizing and
            // the shared ceiling would both fight the explicit value.
            "[field-sizing:fixed] max-h-none min-h-0",
            /**
             * No `text-*` here on purpose.
             *
             * Tailwind's `text-{size}` sets a line-height too, so tailwind-merge
             * treats it as conflicting with `leading-*` and drops the shared
             * `leading-[1.6]` when a caller adds a size. The field silently fell
             * back to `text-sm`'s 1.43 — below the 1.55-1.65 band this whole
             * change exists to hold. The primitive's own responsive size is
             * already correct, so the caller says nothing.
             */
            "placeholder:text-muted-foreground/70",
          )}
        />

        {/* Footer inside the surface but below the text, never floating over
            it — the zone a browser extension claims is the bottom-right of the
            textarea, and nothing of ours may live there. */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1">
            {footer}

            {value.length > 0 ? (
              <Button
                type="button"
                size="xs"
                variant={confirmingClear ? "destructive" : "ghost"}
                onClick={clear}
                disabled={disabled}
              >
                <Eraser />
                {confirmingClear ? "Clear it?" : "Clear"}
              </Button>
            ) : null}

            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setExpanded((open) => !open)}
              aria-pressed={expanded}
            >
              {expanded ? <Minimize2 /> : <Maximize2 />}
              {expanded ? "Collapse" : "Expand"}
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-2xs text-muted-foreground sm:inline">
              {/* Written as the platform's own modifier rather than "Ctrl/Cmd",
                  which asks the reader to work out which one they are. */}
              <kbd className="font-sans">⌘</kbd>/
              <kbd className="font-sans">Ctrl</kbd> + Enter to generate
            </span>
            <span
              className="text-2xs text-muted-foreground tabular-nums"
              aria-live="off"
            >
              {value.length.toLocaleString("en-US")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export { PLACEHOLDERS as PROMPT_PLACEHOLDERS };
