import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Primary actions, right-aligned on wide screens. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The heading block at the top of an application page.
 *
 * Exists so that title size, description colour and the title/action
 * relationship are decided once. Pages that hand-roll their own header are how
 * an interface ends up with four subtly different h1 sizes.
 *
 * Actions stack below the title on small screens rather than crowding it —
 * a button and a long title competing for one row is the most common way a
 * dashboard header breaks on mobile.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 pb-6 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1.5">
        <h1 className="text-2xl tracking-tight sm:text-3xl">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>

      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
