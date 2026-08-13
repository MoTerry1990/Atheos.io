"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The composer's selectable token.
 *
 * Five controls in the composer were each drawing their own version of the
 * same button — duration, camera motion, camera axes, resolution, style
 * presets — with slightly different padding, radius and hover behaviour. They
 * sit within a few hundred pixels of each other, so the differences read as
 * sloppiness rather than as variety.
 *
 * ## An unselected chip is a surface, not an outline
 *
 * The previous version drew a 1px border on the panel's own background. A grid
 * of hairline rectangles on a dark panel reads as unfinished — there is no
 * material, only an edge, and nothing to suggest the thing is pressable before
 * the cursor reaches it. Each chip now sits on `surface-sunken` with a softened
 * border, lifts a pixel on hover, and takes a real shadow. The selected state
 * is the brand tint plus a small glow, which is legible at a glance across a
 * wrap of a dozen options — the thing a chip cloud has to get right.
 *
 * ## Nothing changes width when selected
 *
 * The camera-motion chips used to grow an icon when active, so clicking one
 * reflowed the whole wrap and moved every other chip out from under the
 * cursor. Selection is carried entirely by colour, border and shadow, all of
 * which are free. A trailing `X` on the clearable variants is rendered at all
 * times and only becomes visible when selected, so the box never resizes.
 */

export type ChipShape = "pill" | "square";

interface ChipProps {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
  shape?: ChipShape;
  /** Renders a clear affordance once selected, without reserving it late. */
  clearable?: boolean;
  title?: string;
  className?: string;
  /** Digits that must not jitter as the value changes. */
  numeric?: boolean;
}

export function Chip({
  children,
  active,
  onClick,
  shape = "pill",
  clearable = false,
  title,
  className,
  numeric = false,
}: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "group relative inline-flex items-center gap-1.5 border text-xs font-medium select-none",
        "transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out",
        "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        // 32px tall at both shapes — a real target on a touch screen, and tall
        // enough that a wrap of them has rhythm rather than looking cramped.
        shape === "pill"
          ? "rounded-full px-3 py-1.5"
          : "rounded-lg px-2.5 py-1.5",
        numeric && "tabular-nums",
        active
          ? "border-primary/50 bg-primary/12 text-foreground glow-brand-sm"
          : cn(
              // A tint of the *text* colour, not a named surface. The surface
              // tokens are absolute: `surface-sunken` is near-black, which is
              // darker than the panel these sit on in dark mode, so a chip
              // filled with it reads as a hole punched in the panel rather
              // than as a raised control. A foreground tint lightens on dark
              // and darkens on light, which is the behaviour a chip needs in
              // both themes without branching on one.
              "border-border bg-foreground/[0.05] text-muted-foreground",
              "hover:-translate-y-px hover:border-foreground/20 hover:bg-foreground/10",
              "hover:text-foreground hover:elevation-raised",
              "active:translate-y-0 active:elevation-flat",
            ),
        className,
      )}
    >
      {children}
      {clearable ? <ClearGlyph visible={active} /> : null}
    </button>
  );
}

/**
 * Always in the layout, only sometimes visible — see the note above about the
 * wrap reflowing under the cursor.
 */
function ClearGlyph({ visible }: { visible: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "-mr-0.5 inline-flex size-3 shrink-0 items-center justify-center transition-opacity",
        visible ? "opacity-60 group-hover:opacity-100" : "opacity-0",
      )}
    >
      <svg viewBox="0 0 12 12" className="size-full" fill="none">
        <path
          d="M3 3l6 6M9 3l-6 6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/**
 * Consistent spacing for a wrap of chips.
 *
 * A named container rather than `flex flex-wrap gap-2` repeated at five call
 * sites, which is how the gaps drifted between 1.5 and 2 in the first place.
 */
export function ChipGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>{children}</div>
  );
}
