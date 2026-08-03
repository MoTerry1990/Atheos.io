"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A draggable divider between two panels.
 *
 * ## Why this is hand-rolled
 *
 * The libraries for this are good and they solve a harder problem than we have
 * — arbitrary nested grids, collapsible groups, conditional panels. The studio
 * has two dividers in a fixed three-column layout. A dependency for that is
 * more surface to keep current than the sixty lines it replaces.
 *
 * What the libraries *do* get right and hand-rolled versions usually do not is
 * the part that matters most here, so it is done properly:
 *
 * ## It is keyboard operable, and that is not decoration
 *
 * A separator draggable only by pointer is unusable to anyone navigating by
 * keyboard, and this one controls how much of the screen the prompt gets. It is
 * a real `role="separator"` with `aria-valuenow`, focusable, and moved with the
 * arrow keys — Home and End jump to the bounds.
 *
 * ## Pointer capture, not window listeners
 *
 * `setPointerCapture` keeps events flowing to the handle even when the pointer
 * leaves it, which is what stops a fast drag from detaching. Window-level
 * `mousemove` listeners are the usual approach and they leak when a component
 * unmounts mid-drag.
 *
 * ## Widths persist, because a workspace people rearrange should stay arranged
 *
 * Written to `localStorage` on release rather than on every frame — a write per
 * pointer move is thousands of synchronous serialisations during one drag.
 */

export interface ResizeHandleProps {
  /** Current size of the panel this handle controls, as a percentage. */
  value: number;
  onChange: (next: number) => void;
  /** Called once on release, for persistence. */
  onCommit?: (next: number) => void;
  min: number;
  max: number;
  /** Described to assistive tech: "Prompt panel width". */
  label: string;
  /** Which side of the handle the controlled panel sits on. */
  side?: "left" | "right";
  className?: string;
}

const STEP = 2;
const COARSE_STEP = 10;

export function ResizeHandle({
  value,
  onChange,
  onCommit,
  min,
  max,
  label,
  side = "left",
  className,
}: ResizeHandleProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const clamp = useCallback(
    (next: number) => Math.min(max, Math.max(min, next)),
    [min, max],
  );

  const move = useCallback(
    (clientX: number) => {
      const container = ref.current?.parentElement;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;

      const fromLeft = ((clientX - rect.left) / rect.width) * 100;
      onChange(clamp(side === "left" ? fromLeft : 100 - fromLeft));
    },
    [clamp, onChange, side],
  );

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={cn(
        // 12px wide with a 1px visual line inside it. The line is what a user
        // sees; the padding is what they can actually hit — a 1px target fails
        // WCAG 2.5.8 and is miserable regardless.
        "group relative w-3 shrink-0 cursor-col-resize touch-none select-none",
        "focus-visible:outline-none",
        className,
      )}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        move(event.clientX);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
        onCommit?.(value);
      }}
      onDoubleClick={() => {
        // Double-click resets to the midpoint of the allowed range — the
        // conventional escape hatch when a panel has been dragged somewhere
        // unusable.
        const reset = clamp((min + max) / 2);
        onChange(reset);
        onCommit?.(reset);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? COARSE_STEP : STEP;
        let next: number | null = null;

        if (event.key === "ArrowLeft") next = clamp(value - step);
        if (event.key === "ArrowRight") next = clamp(value + step);
        if (event.key === "Home") next = min;
        if (event.key === "End") next = max;

        if (next === null) return;
        event.preventDefault();
        onChange(next);
        onCommit?.(next);
      }}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors",
          "group-hover:bg-primary/50 group-focus-visible:bg-primary",
          dragging && "bg-primary",
        )}
      />
    </div>
  );
}

/**
 * A persisted panel size.
 *
 * Reads on mount rather than during render: `localStorage` is not available on
 * the server, and reading it during the first client render produces markup
 * that disagrees with the server's — a hydration mismatch React does not repair
 * silently. Starting from the default and correcting in an effect costs one
 * frame and is correct.
 */
export function usePanelSize(
  storageKey: string,
  defaultValue: number,
): [number, (next: number) => void, (next: number) => void] {
  const [size, setSize] = useState(defaultValue);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === null) return;

      const parsed = Number(stored);
      if (Number.isFinite(parsed)) setSize(parsed);
    } catch {
      // Private mode, or storage disabled. The default is a fine answer.
    }
  }, [storageKey]);

  const commit = useCallback(
    (next: number) => {
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // Losing a layout preference must never break the workspace.
      }
    },
    [storageKey],
  );

  return [size, setSize, commit];
}
