"use client";

import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Pagination.
 *
 * The interesting part is `buildPageRange`, which decides which page numbers to
 * show. Getting this wrong is why so many paginators either overflow on mobile
 * at page 400 or jump around as you click through them.
 *
 * Rules:
 *  - first and last page are always reachable
 *  - a fixed window of pages around the current one
 *  - gaps collapse to an ellipsis, and an ellipsis is never used to hide a
 *    single page (showing "… 7 …" wastes the same space as just showing 7)
 *  - the total number of slots is constant, so the control does not resize as
 *    the user pages through it
 */
export function buildPageRange(
  current: number,
  total: number,
  siblings = 1,
): (number | "gap")[] {
  // first + last + current + 2 gaps + siblings either side
  const slots = siblings * 2 + 5;

  if (total <= slots) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const left = Math.max(current - siblings, 1);
  const right = Math.min(current + siblings, total);

  const showLeftGap = left > 2;
  const showRightGap = right < total - 1;

  if (!showLeftGap && showRightGap) {
    const length = siblings * 2 + 3;
    return [...Array.from({ length }, (_, i) => i + 1), "gap", total];
  }

  if (showLeftGap && !showRightGap) {
    const length = siblings * 2 + 3;
    return [
      1,
      "gap",
      ...Array.from({ length }, (_, i) => total - length + 1 + i),
    ];
  }

  return [
    1,
    "gap",
    ...Array.from({ length: right - left + 1 }, (_, i) => left + i),
    "gap",
    total,
  ];
}

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Sibling pages either side of the current one. */
  siblings?: number;
  className?: string;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  siblings = 1,
  className,
}: PaginationProps) {
  // One page is not a pagination problem.
  if (totalPages <= 1) return null;

  const range = buildPageRange(page, totalPages, siblings);

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center justify-center gap-1", className)}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft />
      </Button>

      {/* Numbers are hidden on the narrowest screens — at that width they force
          either a wrap or a horizontal scroll. Prev/next plus the page counter
          below remain, which is enough to navigate. */}
      <ul className="hidden items-center gap-1 xs:flex">
        {range.map((entry, index) =>
          entry === "gap" ? (
            <li key={`gap-${index}`} aria-hidden>
              <span className="flex size-8 items-center justify-center text-muted-foreground">
                <MoreHorizontal className="size-4" />
              </span>
            </li>
          ) : (
            <li key={entry}>
              <Button
                variant={entry === page ? "default" : "ghost"}
                size="icon-sm"
                onClick={() => onPageChange(entry)}
                aria-label={`Page ${entry}`}
                aria-current={entry === page ? "page" : undefined}
                className="tabular-nums"
              >
                {entry}
              </Button>
            </li>
          ),
        )}
      </ul>

      <span className="px-2 text-sm text-muted-foreground tabular-nums xs:hidden">
        {page} / {totalPages}
      </span>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        <ChevronRight />
      </Button>
    </nav>
  );
}

/**
 * "Showing 1–20 of 340". Pair with `Pagination` — a page number alone does not
 * tell anyone how much is left.
 */
export function PaginationSummary({
  page,
  pageSize,
  total,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  className?: string;
}) {
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <p className={cn("text-sm text-muted-foreground tabular-nums", className)}>
      Showing {from}–{to} of {total}
    </p>
  );
}
