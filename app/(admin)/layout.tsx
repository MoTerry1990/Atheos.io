import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { ThemeToggle } from "@/components/layout/top-bar";
import { ClerkProvider } from "@/providers/clerk-provider";
import { isAdmin } from "@/services/admin/auth";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Staff tooling. Its own group, deliberately.
 *
 * ## Why not inside `(app)`
 *
 * That layout calls `requireUserId()`, which **redirects**. A signed-out
 * visitor hitting `/admin` would get a 307 — the same as `/studio` — while a
 * URL that does not exist gets a 404. That difference is enough to confirm the
 * route is real, and it contradicted the rule every admin API route follows:
 * absence is 404, never 403 and never a redirect.
 *
 * Here, `isAdmin()` returns false for signed-out and signed-in-non-admin
 * alike, and both get `notFound()`. `/admin` is now indistinguishable from a
 * typo, which is the whole point.
 *
 * ## The chrome is separate too
 *
 * No sidebar, no credit pill, no notifications. This is not the product — it is
 * a tool for looking at other people's use of it, and the visual difference is
 * a useful reminder of which one you are in.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!(await isAdmin())) notFound();

  return (
    <ClerkProvider>
      <div className="flex min-h-dvh flex-col">
        <header className="border-b border-border bg-surface-sunken">
          <Container size="xl" className="flex h-14 items-center gap-3">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-warning" aria-hidden />
              Atheos admin
            </span>

            <div className="ml-auto flex items-center gap-1.5">
              <ThemeToggle />
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard">Back to the app</Link>
              </Button>
            </div>
          </Container>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </ClerkProvider>
  );
}
