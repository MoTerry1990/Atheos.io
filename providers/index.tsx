import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { MotionProvider } from "@/providers/motion-provider";
import { ThemeProvider } from "@/providers/theme-provider";

/**
 * The composition root for every application-wide provider.
 *
 * Keeping this in one file means `app/layout.tsx` stays readable no matter how
 * many contexts accumulate, and there is exactly one place to look to answer
 * "what wraps my component tree, and in what order?".
 *
 * Order matters. Theme sits outermost so that anything rendering during
 * hydration already knows which theme it is in — including the toaster, which
 * would otherwise flash the wrong colour scheme.
 *
 * Deliberately *not* here yet:
 *
 *   ClerkProvider   added in Sprint 1 with the auth surface, so that Sprint 0
 *                   builds without live Clerk credentials.
 *   QueryProvider   added when there is server state to poll — generation jobs.
 *                   React Server Components cover everything before that, and
 *                   a client cache with nothing to cache is just weight.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <MotionProvider>
        {children}
        <Toaster richColors closeButton position="bottom-right" />
      </MotionProvider>
    </ThemeProvider>
  );
}
