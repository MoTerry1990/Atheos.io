import type { Metadata } from "next";
import type { ReactNode } from "react";

import { isAdmin } from "@/services/admin/auth";
import { AppShell } from "@/features/dashboard/components/app-shell";
import { ClerkProvider } from "@/providers/clerk-provider";
import { requireUserId } from "@/lib/auth";
import { getShellSummary } from "@/services/dashboard";

/**
 * Protected application layout.
 *
 * `requireUserId()` is the authorisation gate — the resource-based model
 * established in Sprint 3, not a middleware matcher. Every route in this group
 * inherits it by being here, rather than by someone remembering to add a
 * pattern somewhere else.
 *
 * Because it awaits `auth()`, every route in this group is dynamic. That is
 * correct: a page rendered for one signed-in user must never be cached and
 * served to another.
 *
 * The shell summary is fetched here rather than per-page so the credit pill and
 * notification bell are present on profile and settings too, not only on the
 * dashboard.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUserId();

  const { creditBalance, notifications } = await getShellSummary();

  return (
    // Clerk is scoped to this group rather than the root layout — UserButton
    // and session hooks live here, and nothing outside needs them.
    <ClerkProvider>
      <AppShell
        creditBalance={creditBalance}
        notifications={notifications}
        isAdmin={await isAdmin()}
      >
        {children}
      </AppShell>
    </ClerkProvider>
  );
}
