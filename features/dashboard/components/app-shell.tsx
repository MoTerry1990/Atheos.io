"use client";

import { UserButton } from "@clerk/nextjs";
import {
  AtSign,
  Coins,
  Compass,
  Images,
  LayoutDashboard,
  Layers,
  Search,
  Store,
  Wand2,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import type { NavSectionData } from "@/components/layout/nav";
import { Sidebar, SidebarDrawer } from "@/components/layout/sidebar";
import { ThemeToggle, TopBar } from "@/components/layout/top-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotificationsMenu } from "@/features/dashboard/components/notifications-menu";
import type { NotificationItem } from "@/features/dashboard/types";
import { SITE } from "@/features/marketing/content";

/**
 * The signed-in application shell.
 *
 * Built entirely from Sprint 1 primitives — `Sidebar`, `SidebarDrawer`,
 * `TopBar`, `NavSection`. Nothing here re-implements chrome, which is what the
 * design system was built first to make possible.
 *
 * ## Navigation reflects what exists
 *
 * Library is still marked `disabled` rather than hidden. Showing a destination
 * that does not work yet is honest — the product's shape is visible, and a
 * disabled item with a tooltip is clearer than a nav that mysteriously grows
 * between releases. Hiding it would make the app look thinner than it is;
 * linking it would 404. Projects graduated in Sprint 8 and is now a real link.
 *
 * ## The credit pill is a link, not an indicator
 *
 * It is the fastest route to "why am I out of credits", so it goes where the
 * eye already is. Hidden below `sm`, where the top bar has room for the
 * hamburger, the bell and the avatar and nothing else.
 */

/**
 * Appended only for admins.
 *
 * A section rather than an item in Account: it is a different *mode*, not a
 * setting, and the audit log records what is done there. Until now `/admin`
 * existed with nothing linking to it, so reaching it meant knowing the URL —
 * which is security by obscurity where there is already a real check.
 */
const ADMIN_SECTION: NavSectionData = {
  title: "Admin",
  items: [{ href: "/admin", label: "Admin", icon: ShieldCheck }],
};

const NAV: NavSectionData[] = [
  {
    title: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/studio", label: "Studio", icon: Wand2 },
      { href: "/projects", label: "Projects", icon: Layers },
      { href: "/marketplace", label: "Marketplace", icon: Store },
      { href: "/explore", label: "Explore", icon: Compass },
      { href: "/dashboard", label: "Library", icon: Images, disabled: true },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/profile", label: "Profile", icon: UserRound },
      { href: "/settings/profile", label: "Public profile", icon: AtSign },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AppShell({
  children,
  notifications,
  creditBalance,
  isAdmin = false,
}: {
  children: ReactNode;
  /**
   * Resolved on the server. Hiding the link is a convenience, never the
   * control — `app/(admin)/layout.tsx` 404s regardless of what the nav shows.
   */
  isAdmin?: boolean;
  notifications: NotificationItem[];
  creditBalance: number;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-brand">
        <Sparkles className="size-4 text-white" strokeWidth={2} aria-hidden />
      </span>
      <span className="truncate font-semibold tracking-tight">{SITE.name}</span>
    </Link>
  );

  const sections = isAdmin ? [...NAV, ADMIN_SECTION] : NAV;

  const sidebarFooter = (
    // Points at billing now that it exists. This pill is the fastest route to
    // "why am I out of credits", and until Sprint 9 it landed on Settings,
    // which could not answer that.
    <Link
      href="/settings/billing"
      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60"
    >
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Coins className="size-3.5" aria-hidden />
        Credits
      </span>
      <Badge variant="brand" size="sm" className="tabular-nums">
        {creditBalance.toLocaleString("en-US")}
      </Badge>
    </Link>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar sections={sections} header={brand} footer={sidebarFooter} />

      <SidebarDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        sections={sections}
        header={brand}
        footer={sidebarFooter}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onMenuClick={() => setDrawerOpen(true)}
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                className="hidden text-muted-foreground sm:inline-flex"
                asChild
              >
                <Link href="/settings/billing">
                  <Coins />
                  <span className="tabular-nums">
                    {creditBalance.toLocaleString("en-US")}
                  </span>
                </Link>
              </Button>

              <NotificationsMenu notifications={notifications} />
              <ThemeToggle />
              <UserButton appearance={{ elements: { avatarBox: "size-8" } }} />
            </>
          }
        >
          {/* Search is a placeholder control, and says so rather than opening
              an empty palette. It becomes a command menu in Sprint 5, once
              there are assets and projects worth searching. */}
          <button
            type="button"
            disabled
            className="hidden w-full max-w-xs items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-1.5 text-sm text-muted-foreground md:flex"
            title="Search arrives with the asset library"
          >
            <Search className="size-3.5" aria-hidden />
            <span>Search…</span>
          </button>
          <span className="sr-only">Workspace</span>
        </TopBar>

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
