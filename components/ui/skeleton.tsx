import { type VariantProps, cva } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Skeleton.
 *
 * A skeleton is a **promise about the layout that is coming**. If the real
 * content lands at a different size, the page jumps and the skeleton has made
 * things worse than a spinner would have. So: match the real dimensions, and
 * when a list length is unknown, show a plausible few rather than a screenful.
 *
 * `shimmer` sweeps a highlight across the surface and reads as "data in
 * flight"; `pulse` just breathes. Shimmer for content, pulse for chrome.
 */
const skeletonVariants = cva("rounded-md", {
  variants: {
    animation: {
      shimmer: "skeleton",
      pulse: "animate-pulse bg-muted",
      none: "bg-muted",
    },
  },
  defaultVariants: { animation: "shimmer" },
});

export interface SkeletonProps
  extends ComponentProps<"div">, VariantProps<typeof skeletonVariants> {}

function Skeleton({ className, animation, ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      // Decorative: the loading state is announced by the `aria-busy` region
      // that contains it, so the individual bars are noise to a screen reader.
      aria-hidden
      className={cn(skeletonVariants({ animation }), className)}
      {...props}
    />
  );
}

/**
 * Lines of text. The last line is short, because real paragraphs end mid-line
 * and a block of equal-length bars reads as a table, not prose.
 */
function SkeletonText({
  lines = 3,
  className,
  ...props
}: SkeletonProps & { lines?: number }) {
  return (
    <div className={cn("space-y-2", className)} {...props}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4", i === lines - 1 && lines > 1 && "w-3/5")}
        />
      ))}
    </div>
  );
}

/** Matches the Card layout: media, title, two lines, footer. */
function SkeletonCard({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn("space-y-4 rounded-xl border bg-card p-6", className)}
      {...props}
    >
      <Skeleton className="aspect-video w-full rounded-lg" />
      <Skeleton className="h-5 w-2/3" />
      <SkeletonText lines={2} />
    </div>
  );
}

/** An asset grid mid-load. Square tiles, because that is what the library is. */
function SkeletonGrid({
  count = 8,
  className,
  ...props
}: SkeletonProps & { count?: number }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4",
        className,
      )}
      {...props}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="aspect-square w-full rounded-lg" />
      ))}
    </div>
  );
}

/** Table rows. Column widths vary so it reads as tabular data, not a block. */
function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
  ...props
}: SkeletonProps & { rows?: number; columns?: number }) {
  const widths = ["w-full", "w-4/5", "w-3/5", "w-2/3", "w-1/2"];

  return (
    <div className={cn("space-y-3", className)} {...props}>
      <div className="flex gap-4 border-b pb-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" animation="pulse" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 py-1">
          {Array.from({ length: columns }).map((_, c) => (
            <div key={c} className="flex-1">
              <Skeleton
                className={cn("h-4", widths[(r + c) % widths.length])}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonGrid,
  SkeletonTable,
  skeletonVariants,
};
