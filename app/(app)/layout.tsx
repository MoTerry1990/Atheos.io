import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AccountShell } from "@/features/account/components/account-shell";
import { requireUserId } from "@/lib/auth";

/**
 * Protected application layout.
 *
 * `requireUserId()` runs here even though the middleware already blocks
 * unauthenticated requests to these routes. That is not redundant — it is
 * defence in depth. The middleware guard is a regex over pathnames, and regexes
 * get edited; this check is local to the code that depends on it and cannot be
 * bypassed by a matcher typo.
 *
 * Because it awaits `auth()`, every route in this group is dynamic. That is
 * correct: a page rendered for a specific signed-in user must never be cached
 * and served to another one.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUserId();

  return <AccountShell>{children}</AccountShell>;
}
