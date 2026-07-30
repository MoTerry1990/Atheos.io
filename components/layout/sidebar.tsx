"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";

import { Nav, type NavSectionData } from "@/components/layout/nav";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useUIStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";

/**
 * Sidebar.
 *
 * One navigation definition, two presentations:
 *
 *  - **≥ lg** a persistent rail that collapses from 16rem to icons-only. The
 *    collapsed width is preserved in `useUIStore`, so it survives a reload.
 *  - **< lg** a drawer. Not a squeezed sidebar — on a phone there is no room
 *    for permanent chrome, and the content is what the user came for.
 *
 * The drawer closes on navigation. Leaving it open after a route change is a
 * classic mobile bug: the user taps a link, the page changes underneath, and
 * the menu is still covering it.
 */

export interface SidebarProps {
  sections: NavSectionData[];
  /** Brand lockup at the top. */
  header?: ReactNode;
  /** Account controls, usage meter — pinned to the bottom. */
  footer?: ReactNode;
  className?: string;
}

function SidebarBody({
  sections,
  header,
  footer,
  collapsed,
  onNavigate,
}: SidebarProps & { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      {header ? (
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b px-4",
            collapsed && "justify-center px-2",
          )}
        >
          {header}
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 py-3">
        <Nav
          sections={sections}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </ScrollArea>

      {footer ? (
        <div className={cn("shrink-0 border-t p-3", collapsed && "px-2")}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/** Persistent rail. Hidden below `lg`, where `SidebarDrawer` takes over. */
export function Sidebar({ sections, header, footer, className }: SidebarProps) {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const collapsed = !sidebarOpen;

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        "relative hidden shrink-0 border-r bg-sidebar lg:flex lg:flex-col",
        "transition-[width] duration-240 ease-out-quart motion-reduce:transition-none",
        collapsed ? "w-[4.5rem]" : "w-64",
        className,
      )}
    >
      <SidebarBody
        sections={sections}
        header={header}
        footer={footer}
        collapsed={collapsed}
      />

      <Button
        variant="outline"
        size="icon-xs"
        onClick={toggleSidebar}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        // Straddles the border so it reads as a handle on the edge rather than
        // another item inside the nav.
        className="absolute top-16 -right-3 z-10 rounded-full bg-background shadow-sm"
      >
        {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </Button>
    </aside>
  );
}

/**
 * Mobile drawer. Controlled by the caller so the trigger can live in the top
 * bar, which is where a hamburger belongs.
 */
export function SidebarDrawer({
  open,
  onOpenChange,
  sections,
  header,
  footer,
}: SidebarProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 p-0 lg:hidden">
        {/* Radix requires a title and description on every dialog for
            accessibility. Both are visually hidden — the brand lockup in the
            header is the visible equivalent. */}
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Main site navigation
        </SheetDescription>

        <SidebarBody
          sections={sections}
          header={header}
          footer={footer}
          collapsed={false}
          onNavigate={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
