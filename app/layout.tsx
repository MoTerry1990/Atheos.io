import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { env } from "@/lib/env";
import { Providers } from "@/providers";

import "@/styles/globals.css";

/**
 * Fonts are self-hosted by `next/font` at build time — no runtime request to
 * Google, no third-party connection on first paint, and no layout shift,
 * because the metrics are known before the browser asks for the file.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  // Every relative URL in metadata resolves against this. Without it, Open
  // Graph images silently break in production.
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
  title: {
    default: "Atheos — AI Creative Platform",
    template: "%s · Atheos",
  },
  description:
    "Generate images, video, audio and creative assets across multiple AI providers from one interface.",
  applicationName: "Atheos",
  robots: {
    // Sprint 0 has nothing worth indexing, and an unfinished product sitting in
    // search results is harder to undo than to prevent.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Do not cap zoom below 5 — pinch-to-zoom is an accessibility feature, and
  // `maximumScale: 1` is a WCAG failure.
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning is required by next-themes: it writes the theme
    // class onto <html> before React hydrates, so server and client markup
    // legitimately differ on this one element. Scoped here and nowhere else.
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-dvh antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
