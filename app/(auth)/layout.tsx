import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ClerkProvider } from "@/providers/clerk-provider";

/**
 * Auth route group.
 *
 * No shared chrome — each screen supplies its own `AuthShell`. The group exists
 * for the shared metadata: **auth pages must never be indexed**. A sign-in page
 * in search results competes with the landing page for brand queries and sends
 * people who wanted to read about the product to a password prompt instead.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Clerk is mounted here rather than in the root layout. These routes need a
 * session; the landing page and the internal previews do not, and wrapping them
 * meant a Clerk initialisation failure broke hydration site-wide. See
 * `providers/index.tsx`.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <ClerkProvider>{children}</ClerkProvider>;
}
