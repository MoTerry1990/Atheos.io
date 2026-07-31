import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { ClerkProvider } from "@/providers/clerk-provider";
import { MotionProvider } from "@/providers/motion-provider";
import { ThemeProvider } from "@/providers/theme-provider";

/**
 * The composition root for every application-wide provider.
 *
 * Keeping this in one file means `app/layout.tsx` stays readable no matter how
 * many contexts accumulate, and there is exactly one place to look to answer
 * "what wraps my component tree, and in what order?".
 *
 * ## Order is load-bearing
 *
 * `ThemeProvider` → `ClerkProvider` → `MotionProvider`.
 *
 * Theme sits outermost because **Clerk reads the resolved theme** to build its
 * `appearance` palette. Nesting it the other way round leaves Clerk's own
 * surfaces — the user button, MFA prompts — in the wrong colour scheme until
 * they remount.
 *
 * Motion is innermost: nothing else depends on it, and it should wrap as little
 * as possible.
 *
 * The toaster lives inside all three so its portal inherits the theme.
 *
 * Deliberately *not* here yet:
 *
 *   QueryProvider   added when there is server state to poll — generation jobs.
 *                   React Server Components cover everything before that, and a
 *                   client cache with nothing to cache is just weight.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ClerkProvider>
        <MotionProvider>
          {children}
          <Toaster richColors closeButton position="bottom-right" />
        </MotionProvider>
      </ClerkProvider>
    </ThemeProvider>
  );
}
