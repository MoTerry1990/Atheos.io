import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Textarea — the shared multiline surface.
 *
 * ## Why the spacing changed
 *
 * This used to be `px-3 py-2 min-h-16 text-base`: twelve pixels of horizontal
 * padding on a four-line box. That is correct for a two-word form field and
 * wrong for everything Atheos actually asks people to write in it — a prompt, a
 * project description, a support message, a refund note. At twelve pixels the
 * text reads as pressed into the corner of a box it has outgrown, and the first
 * character sits close enough to the border to look like a rendering fault.
 *
 * `features/studio/components/prompt-field.tsx` solved this once for the studio
 * prompt and proved the numbers work. The same numbers now live here, so every
 * other multiline field in the product inherits them rather than each screen
 * re-deciding.
 *
 * The measurements, and what each is for:
 *
 * | | |
 * |---|---|
 * | 16px top and bottom | a line of text has room above and below it |
 * | 18px left and right | the first character is clearly inside the box |
 * | line-height 1.6 | inside the 1.55–1.65 band that reads as prose |
 * | 14px (16px on mobile) | below 16px, iOS Safari zooms the viewport on focus |
 *
 * ## The two reservations
 *
 * `overlayRight` and `overlayBottom` exist because something else can occupy
 * those edges, and text underneath it is unreadable.
 *
 * **Right:** Grammarly, LanguageTool and similar extensions inject a floating
 * button into the bottom-right of any textarea they attach to. We cannot
 * control that and should not try — disabling writing assistants to hide the
 * collision takes a tool away from the user to fix our layout. Reserving the
 * lane is ours to do.
 *
 * **Bottom:** a field with its own footer controls — counter, clear, expand —
 * needs the text to stop above them.
 *
 * Both are opt-in. A plain textarea reserves nothing and keeps its 18px.
 */

export interface TextareaProps extends React.ComponentProps<"textarea"> {
  /**
   * Reserve the right-hand lane for an injected writing-assistant button.
   *
   * 64px. It was 56, which cleared the badge itself but left a caret arriving
   * at the end of a long line sitting directly under it. The extra eight pixels
   * are the difference between "the button does not overlap the text" and "the
   * text is comfortably clear of the button".
   */
  overlayRight?: boolean;
  /** Reserve the lower band for editor controls rendered over the field. */
  overlayBottom?: boolean;
  /** Mirrors `aria-invalid` for callers that hold validity in state. */
  invalid?: boolean;
}

function Textarea({
  className,
  overlayRight,
  overlayBottom,
  invalid,
  ...props
}: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      aria-invalid={invalid || props["aria-invalid"]}
      className={cn(
        "block w-full rounded-md border border-input bg-transparent",
        "shadow-xs transition-[color,box-shadow] outline-none",

        // The spacing standard. Written as separate sides rather than `px`
        // plus an override: with both present the shorthand and the longhand
        // fight, and the studio prompt shipped with `padding-left: 0` for a
        // week because a class list said `px-[18px] pr-12`.
        "pt-4 pr-[18px] pb-4 pl-[18px]",
        overlayRight && "pr-16",
        overlayBottom && "pb-[58px]",

        "text-base leading-[1.6] text-foreground sm:text-sm",
        "placeholder:leading-[1.6] placeholder:text-muted-foreground",

        /**
         * Wrapping, and the two overflow axes set deliberately.
         *
         * `overflow-x-hidden` rather than the browser default: with
         * `overflow-wrap:anywhere` nothing should ever exceed the width, so a
         * horizontal scrollbar can only appear as a symptom of a layout bug —
         * and when it does appear it shifts the text under the caret. Vertical
         * stays `auto` so a long prompt scrolls inside its own box.
         *
         * `word-break: normal` alongside `overflow-wrap: anywhere`: the pair
         * breaks an unbreakable URL only when it has to, while leaving ordinary
         * words to break at their natural boundaries. `break-all` would hyphen-
         * lessly chop mid-word on every line.
         */
        "[overflow-wrap:anywhere] [word-break:normal] whitespace-pre-wrap",
        "overflow-x-hidden overflow-y-auto",
        // A stray `text-indent` from a reset would offset the first line only,
        // which reads as a rendering fault rather than a style.
        "indent-0",

        // Grows with content where supported, with a floor that keeps an empty
        // field from collapsing and a ceiling that stops it pushing the submit
        // button off the screen.
        "field-sizing-content max-h-[420px] min-h-24",

        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "read-only:cursor-default read-only:opacity-90",
        "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/30",
        "dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
