"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Sidebar, SidebarDrawer } from "@/components/layout/sidebar";
import { ThemeToggle, TopBar } from "@/components/layout/top-bar";
import { Badge } from "@/components/ui/badge";
import type { NavSectionData } from "@/components/layout/nav";

/**
 * Shell for the gallery — which is itself a demonstration of `Sidebar`,
 * `SidebarDrawer` and `TopBar` working together.
 *
 * Documenting navigation by *using* it is the only honest way. A sidebar shown
 * as a static screenshot in a docs page has never had to survive a real route
 * change or a 375px viewport.
 */
export function GalleryShell({
  sections,
  children,
}: {
  sections: NavSectionData[];
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const brand = (
    <Link href="/design-system" className="flex items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-brand">
        <Sparkles className="size-4 text-white" strokeWidth={2} aria-hidden />
      </span>
      <span className="truncate font-semibold tracking-tight">Atheos</span>
    </Link>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar
        sections={sections}
        header={brand}
        footer={
          <div className="flex items-center justify-between gap-2 px-1">
            <Badge variant="brand" size="sm">
              Sprint 1
            </Badge>
            <ThemeToggle />
          </div>
        }
      />

      <SidebarDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        sections={sections}
        header={brand}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onMenuClick={() => setDrawerOpen(true)}
          actions={<ThemeToggle />}
        >
          <p className="truncate text-sm font-medium">Design System</p>
        </TopBar>

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
