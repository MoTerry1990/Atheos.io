"use client";

import { Menu } from "lucide-react";
import Link from "next/link";

import { BrandLink } from "@/components/layout/brand-link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useCopy, useHref, useLocale } from "@/features/marketing/i18n";
import { pathFor } from "@/features/marketing/i18n/locales";
import { cn } from "@/lib/utils";

/**
 * Marketing navigation.
 *
 * Transparent over the hero, then a frosted bar once the page scrolls. That
 * transition is what makes the header feel like part of the composition rather
 * than a strip bolted on top of it.
 *
 * The scroll listener is passive and only flips a boolean at one threshold, so
 * it does not fight the compositor. The naive version — reading `scrollY` into
 * state on every frame — re-renders the header sixty times a second and is the
 * usual reason a landing page stutters while scrolling.
 */
export function SiteHeader() {
  const copy = useCopy();
  const locale = useLocale();
  const href = useHref();

  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll(); // account for a restored scroll position on reload
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300 ease-out-quart",
        scrolled
          ? "border-b border-border/60 bg-background/70 backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 w-full max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8"
      >
        {/* `/` in English, `/es` in Spanish — the only brand link that has
            ever had a locale to respect, and the only one that was already
            correct. It shares `BrandLink` now so it cannot drift back. */}
        <BrandLink href={pathFor("home", locale)} />

        {/* Centred rather than left-aligned against the wordmark: four items
            in the middle of a wide bar reads as navigation, four items pushed
            up against the logo reads as a continuation of it. */}
        <ul className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 lg:flex">
          {copy.nav.map((link) => (
            <li key={link.href}>
              {/* Real routes now, so `Link` — the previous anchors were all
                  same-page and did not need one. `href()` still runs so a
                  Spanish visitor stays on the Spanish side of the site. */}
              <Link
                href={href(link.href)}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground",
                  "transition-colors hover:bg-accent/50 hover:text-foreground",
                  "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                )}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            asChild
          >
            <Link href="/sign-in">{copy.auth.signIn}</Link>
          </Button>
          {/* Straight at the studio, through sign-up.
          
              `/sign-up` bounces an already-signed-in visitor to `redirect_url`,
              so one href is correct for both states — see the auth pages. The
              alternative was asking Clerk who the visitor is *here*, which
              means a ClerkProvider around the marketing tree and its
              JavaScript on every landing-page visit. */}
          {/* 44px on touch. This measured 98×32 at 375px — the primary
              conversion control on the page, at two-thirds the target size a
              thumb needs, and the only always-visible button up here besides
              the menu (which is already `size-11`). `sm:` hands it back to the
              compact height on a pointer. `min-h-`, not `h-`, for the same
              cascade reason documented in `home-composer.tsx`. */}
          <Button
            variant="gradient"
            size="sm"
            className="min-h-11 sm:min-h-9"
            asChild
          >
            <Link href="/sign-up?redirect_url=%2Fstudio">
              {copy.auth.signUp}
            </Link>
          </Button>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                // 44x44, the one control on this page that is only ever
                // touched. `size="icon-sm"` renders a 32px box, which is
                // fine for a mouse and below the WCAG target-size minimum for
                // a thumb — on the element that opens all of the navigation.
                // `-mr-2` keeps the larger hit area from pushing the header's
                // right edge outward.
                className="-mr-2 size-11 lg:hidden"
                aria-label="Open menu"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">
                Site navigation and account links
              </SheetDescription>

              <ul className="mt-8 space-y-1 px-2">
                {copy.nav.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={href(link.href)}
                      // Closed explicitly on navigation. Radix dismisses the
                      // sheet on Escape and on an outside click, and restores
                      // body scroll on both, but a route change inside it is
                      // neither of those.
                      onClick={() => setOpen(false)}
                      className={cn(
                        "block rounded-lg px-3 py-2.5 text-base font-medium text-foreground",
                        "hover:bg-accent",
                        "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                      )}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>

              {/* Sign-in is hidden in the header below `sm`, so without this
                  a phone visitor who already has an account has no way in from
                  the homepage — the only auth control they can see is the one
                  that makes a new account. */}
              <div className="mt-6 space-y-2 border-t border-border px-5 pt-5 sm:hidden">
                <Button variant="outline" block asChild>
                  <Link href="/sign-in" onClick={() => setOpen(false)}>
                    {copy.auth.signIn}
                  </Link>
                </Button>
                <Button variant="gradient" block asChild>
                  <Link
                    href="/sign-up?redirect_url=%2Fstudio"
                    onClick={() => setOpen(false)}
                  >
                    {copy.auth.signUp}
                  </Link>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
