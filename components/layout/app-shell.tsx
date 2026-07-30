import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface AppShellProps {
  children: ReactNode;
  /** Persistent navigation rail. Rendered only when provided. */
  sidebar?: ReactNode;
  /** Sticky top bar. */
  header?: ReactNode;
  className?: string;
}

/**
 * The application chrome: optional sidebar, optional sticky header, scrolling
 * content region.
 *
 * The layout is a fixed-height flex frame with a single internal scroll
 * container, rather than letting the document scroll. That is what keeps the
 * sidebar and header pinned while an asset grid scrolls behind them, and it is
 * far easier to reason about than a page full of `position: sticky`.
 *
 * `min-h-0` on the scrolling column is load-bearing, not decoration: a flex
 * child defaults to `min-height: auto`, which refuses to shrink below its
 * content and silently breaks the scroll container.
 */
export function AppShell({
  children,
  sidebar,
  header,
  className,
}: AppShellProps) {
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {sidebar ? (
        <aside className="hidden w-64 shrink-0 border-r border-border bg-sidebar lg:block">
          {sidebar}
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {header ? (
          <header className="sticky top-0 z-40 shrink-0 border-b border-border bg-background/80 backdrop-blur-md">
            {header}
          </header>
        ) : null}

        <main className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
          {children}
        </main>
      </div>
    </div>
  );
}
