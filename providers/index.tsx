import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { MotionProvider } from "@/providers/motion-provider";
import { ThemeProvider } from "@/providers/theme-provider";

/**
 * Application-wide providers.
 *
 * Keeping this in one file means `app/layout.tsx` stays readable no matter how
 * many contexts accumulate, and there is exactly one place to look to answer
 * "what wraps my component tree, and in what order?".
 *
 * Theme sits outermost so anything rendering during hydration already knows
 * which theme it is in — including the toaster, which would otherwise flash the
 * wrong colour scheme. Motion is innermost: nothing depends on it, so it should
 * wrap as little as possible.
 *
 * ## Why ClerkProvider is NOT here
 *
 * It used to be, and that was wrong twice over.
 *
 * **Correctness.** `ClerkProvider` initialises against a real Clerk instance and
 * throws if it cannot reach one. From the root layout it wraps *every* route,
 * so a failure took down hydration on pages that have nothing to do with
 * authentication — the landing page and the internal previews included. The
 * symptom was subtle and expensive to diagnose: server-rendered HTML looked
 * perfect, but no effect ever ran, so every animation sat frozen at its initial
 * value.
 *
 * **Weight.** It also shipped Clerk's client bundle to the marketing site,
 * which has no session, no user button, and only plain links to `/sign-in`.
 *
 * It now lives in `app/(auth)/layout.tsx` and `app/(app)/layout.tsx` — the two
 * groups that actually need a session. See `providers/clerk-provider.tsx`.
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
