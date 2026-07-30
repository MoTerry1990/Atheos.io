"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Theme provider.
 *
 * `attribute="class"` writes `.dark` onto <html>, which is what the
 * `@custom-variant dark` rule in `styles/globals.css` keys off.
 *
 * `disableTransitionOnChange` suppresses transitions for the instant the theme
 * flips. Without it, every element with a colour transition animates at once
 * and the switch looks like a bug rather than a choice.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
