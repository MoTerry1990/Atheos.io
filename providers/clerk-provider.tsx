"use client";

import { ClerkProvider as BaseClerkProvider } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";

import { CLERK_PUBLISHABLE_KEY } from "@/lib/public-env";

/**
 * Clerk, themed to the design system.
 *
 * Most of the auth UI in this app is custom — `features/auth` drives
 * `useSignIn`/`useSignUp` directly so the screens are ours. But Clerk still
 * renders some surfaces itself (`<UserButton>`, MFA and reverification prompts,
 * the account-deletion confirmation), and those have to match everything else
 * or the seams show at exactly the moment a user is deciding whether to trust
 * the product with a password.
 *
 * The `appearance` object maps Clerk's slots onto our CSS variables. Reading
 * the resolved theme is deliberate: Clerk's variables are resolved once at
 * mount, so passing raw `var(--...)` strings would leave its popovers in the
 * wrong palette after a theme switch until remount.
 */
export function ClerkProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  return (
    <BaseClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      // Where Clerk sends people when it handles a redirect itself. These must
      // agree with the middleware's public-route list or users bounce between
      // the two.
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      // Global sign-out destination. UserButton no longer takes its own.
      afterSignOutUrl="/"
      signInFallbackRedirectUrl="/profile"
      signUpFallbackRedirectUrl="/profile"
      appearance={{
        // Only the variables that survive across Clerk's appearance revisions
        // are set here. Everything else is styled through `elements`, which
        // takes Tailwind classes — so Clerk's surfaces read the *same design
        // tokens* as the rest of the app rather than a duplicated hex palette
        // that has to be kept in sync by hand.
        variables: {
          colorPrimary: dark ? "#a78bfa" : "#7c3aed",
          borderRadius: "0.625rem",
          fontFamily: "var(--font-geist-sans)",
        },
        elements: {
          card: "bg-card text-card-foreground border border-border shadow-none",
          headerTitle: "text-foreground",
          headerSubtitle: "text-muted-foreground",
          socialButtonsBlockButton:
            "border-border bg-background text-foreground hover:bg-accent",
          dividerLine: "bg-border",
          dividerText: "text-muted-foreground",
          formFieldLabel: "text-foreground",
          formFieldInput:
            "bg-background border-input text-foreground rounded-lg",
          formButtonPrimary:
            "bg-primary text-primary-foreground hover:bg-primary/90 normal-case",
          footerActionText: "text-muted-foreground",
          footerActionLink: "text-primary hover:text-primary/80",
          modalContent: "bg-card",
          userButtonPopoverCard: "bg-popover border-border",
          userButtonPopoverActionButton: "text-foreground hover:bg-accent",
        },
      }}
    >
      {children}
    </BaseClerkProvider>
  );
}
