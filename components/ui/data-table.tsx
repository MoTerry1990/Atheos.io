import type { ReactNode } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * DataTable — a table that survives a phone.
 *
 * Tables are the hardest component to make responsive, and the three usual
 * answers are all bad: horizontal scrolling hides columns behind a gesture
 * nobody discovers, squeezing produces unreadable four-character columns, and
 * dropping columns silently loses data.
 *
 * This does the fourth thing: **below `md` each row becomes a stacked card**
 * with label/value pairs. Every column stays visible, nothing is truncated, and
 * there is no hidden gesture. Above `md` it is a normal table.
 *
 * The cost is that each row's content renders twice in the markup, once per
 * layout. For the page sizes a UI table should ever show — tens of rows, not
 * thousands — that is the right trade.
 *
 * Presentational only. Sorting, filtering and selection are the caller's
 * business; baking them in here would fix a data-fetching strategy into a
 * display component.
 */

export interface DataTableColumn<T> {
  /** Stable key. Also the `<th>` scope target. */
  key: string;
  header: ReactNode;
  /** Cell renderer. Receives the row and its index. */
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  /** Hide on the mobile card layout — for purely decorative columns. */
  hideOnMobile?: boolean;
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Stable identity per row. Index keys break every animation and selection. */
  getRowId: (row: T, index: number) => string;
  /** Rendered in place of the table when there are no rows. */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  caption?: string;
  className?: string;
}

const alignment = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  empty,
  onRowClick,
  caption,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  return (
    <div className={cn("w-full", className)}>
      {/* ---- Table layout, md and up ---- */}
      <div className="hidden overflow-hidden rounded-xl border border-border md:block">
        <Table>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  scope="col"
                  className={cn(
                    "text-xs font-medium text-muted-foreground",
                    alignment[column.align ?? "left"],
                    column.className,
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow
                key={getRowId(row, index)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                // A clickable row must be reachable and activatable by keyboard,
                // otherwise the whole table is unusable without a mouse.
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? "button" : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                className={cn(
                  onRowClick &&
                    "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                )}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      "text-sm",
                      alignment[column.align ?? "left"],
                      column.className,
                    )}
                  >
                    {column.cell(row, index)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ---- Stacked card layout, below md ---- */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row, index) => (
          <li
            key={getRowId(row, index)}
            className={cn(
              "rounded-xl border border-border bg-card p-4",
              onRowClick && "cursor-pointer",
            )}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            <dl className="space-y-2">
              {columns
                .filter((column) => !column.hideOnMobile)
                .map((column) => (
                  <div
                    key={column.key}
                    className="flex items-start justify-between gap-4"
                  >
                    <dt className="shrink-0 text-xs font-medium text-muted-foreground">
                      {column.header}
                    </dt>
                    <dd className="min-w-0 text-right text-sm">
                      {column.cell(row, index)}
                    </dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
