"use client";

import { Menu, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SITE } from "@/features/marketing/content";
import { useCopy, useHref, useLocale } from "@/features/marketing/i18n";
import { LanguageSwitcher } from "@/features/marketing/components/language-switcher";
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
        <Link
          href={pathFor("home", locale)}
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-brand">
            <Sparkles
              className="size-4 text-white"
              strokeWidth={2}
              aria-hidden
            />
          </span>
          {SITE.name}
        </Link>

        <ul className="hidden flex-1 items-center gap-1 lg:flex">
          {copy.nav.map((link) => (
            <li key={link.href}>
              <a
                href={href(link.href)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {/* Hidden on the narrowest screens: at that width the header is
              already the wordmark plus two buttons plus a menu trigger, and a
              fourth control pushes the sign-up CTA off the row. It stays
              reachable in the mobile sheet below. */}
          <LanguageSwitcher className="hidden sm:flex" />

          {/* Sign-in is a link, not a route — authentication is Sprint 3. */}
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            asChild
          >
            <a href="#pricing">{copy.auth.signIn}</a>
          </Button>
          <Button variant="gradient" size="sm" asChild>
            <a href="#pricing">{copy.auth.signUp}</a>
          </Button>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="lg:hidden"
                aria-label="Open menu"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">
                Links to sections of this page
              </SheetDescription>

              <ul className="mt-8 space-y-1 px-2">
                {copy.nav.map((link) => (
                  <li key={link.href}>
                    <a
                      href={href(link.href)}
                      // Closing on navigation matters more here than in an app
                      // shell: these are anchors, so the page does not remount
                      // and nothing else would dismiss the sheet.
                      onClick={() => setOpen(false)}
                      className="block rounded-lg px-3 py-2.5 text-base font-medium text-foreground hover:bg-accent"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>

              {/* The switcher is hidden in the header below `sm`; this is where
                  it lives at that width. */}
              <div className="mt-6 border-t border-border px-5 pt-5 sm:hidden">
                <p className="text-xs font-medium text-muted-foreground">
                  {copy.language.label}
                </p>
                <LanguageSwitcher className="mt-2 w-fit" />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
