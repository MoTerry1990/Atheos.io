import Link from "next/link";

import { BrandLink } from "@/components/layout/brand-link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { ThemeToggle } from "@/components/layout/top-bar";
import { getUserId } from "@/lib/auth";

/**
 * The public community shell.
 *
 * ## Its own group, outside `(app)`
 *
 * `app/(app)/layout.tsx` calls `requireUserId()`, which redirects. These pages
 * must load signed out — a shared link to a post is the main way anybody
 * arrives, and bouncing them to sign-in first is how a community fails to
 * become one.
 *
 * The header adapts rather than the routes forking: signed in gets a link back
 * into the app, signed out gets sign-in. That is the only difference, and it is
 * one component rather than two page trees.
 */
export default async function CommunityLayout({
  children,
}: {
  children: ReactNode;
}) {
  const userId = await getUserId();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <Container size="lg" className="flex h-14 items-center gap-3">
          {/* Home, not `/explore` — this header renders *on* Explore, so the
              logo used to be a link to the current page. */}
          <BrandLink size="sm" />

          <nav className="ml-2 flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/explore">Explore</Link>
            </Button>
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            {userId ? (
              <Button size="sm" asChild>
                <Link href="/dashboard">Open Atheos</Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/sign-in">Sign in</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link href="/sign-up">Get started</Link>
                </Button>
              </>
            )}
          </div>
        </Container>
      </header>

      <main className="flex-1 py-8">
        <Container size="lg">{children}</Container>
      </main>
    </div>
  );
}
