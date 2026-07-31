"use client";

import { UserButton } from "@clerk/nextjs";
import { Settings, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import type { NavSectionData } from "@/components/layout/nav";
import { Sidebar, SidebarDrawer } from "@/components/layout/sidebar";
import { ThemeToggle, TopBar } from "@/components/layout/top-bar";
import { SITE } from "@/features/marketing/content";

/**
 * The signed-in application shell.
 *
 * Reuses `Sidebar`, `SidebarDrawer` and `TopBar` from the Sprint 1 design
 * system rather than inventing app chrome — which is the entire reason the
 * design system was built first.
 *
 * The navigation is deliberately short. Sprint 3 is authentication, so there
 * are exactly two destinations. Generation, library and billing land in later
 * sprints and slot into the same structure without changing this file.
 *
 * `<UserButton>` is one of the few places Clerk renders its own UI here. It is
 * themed through the `appearance` config in `providers/clerk-provider.tsx`, and
 * it carries sign-out, account switching and Clerk's own security screens —
 * all of which would be a poor use of a sprint to rebuild.
 */

const NAV: NavSectionData[] = [
  {
    title: "Account",
    items: [
      { href: "/profile", label: "Profile", icon: UserRound },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AccountShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const brand = (
    <Link href="/profile" className="flex items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-brand">
        <Sparkles className="size-4 text-white" strokeWidth={2} aria-hidden />
      </span>
      <span className="truncate font-semibold tracking-tight">{SITE.name}</span>
    </Link>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar sections={NAV} header={brand} />

      <SidebarDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        sections={NAV}
        header={brand}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onMenuClick={() => setDrawerOpen(true)}
          actions={
            <>
              <ThemeToggle />
              {/* Sign-out destination is set once on ClerkProvider
                  (`afterSignOutUrl`) rather than per-button — Clerk 7 removed
                  the prop from UserButton. */}
              <UserButton appearance={{ elements: { avatarBox: "size-8" } }} />
            </>
          }
        >
          <span className="sr-only">Account</span>
        </TopBar>

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
