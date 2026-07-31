import type { Metadata } from "next";
import type { ReactNode } from "react";

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

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
