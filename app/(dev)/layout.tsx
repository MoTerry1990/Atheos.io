import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { env } from "@/lib/env";

/**
 * Internal tooling route group.
 *
 * Everything under `(dev)` — the design-system gallery, the eight preview
 * routes — is documentation and verification surface, not product.
 *
 * ## They no longer ship to production
 *
 * They used to, and Sprints 14, 15 and 21 all filed that as a High-severity
 * issue without closing it. The reasoning for keeping them was that "a preview
 * which only exists on localhost stops being checked" — true, and it was the
 * wrong trade. `/admin-preview` renders the complete admin interface with the
 * authorisation gate bypassed. The data is fixtures, so nothing leaks, but it
 * publishes the design of every internal tool to anyone who requests the URL,
 * on a product whose entire admin surface otherwise answers 404 specifically so
 * that its existence does not leak.
 *
 * `metadata.robots` was never sufficient. `noindex` asks a crawler not to list
 * a page; it does not stop a person opening it.
 *
 * ## Why a flag rather than deleting them
 *
 * The original reasoning is still half right: these routes are how every sprint
 * since 4 has verified the product without a database, and the E2E suite asserts
 * against all eight of them. Deleting them would delete the test surface.
 *
 * So they are **off by default and explicitly enabled** where they are needed —
 * a preview deployment, or the Playwright run, which sets the flag in
 * `playwright.config.ts`. Production simply does not set it, and every route
 * here becomes a genuine 404 rather than a page asking politely not to be
 * indexed.
 *
 * Development is unaffected: `NODE_ENV` is not `production`, so the guard does
 * not apply and `npm run dev` behaves as it always has.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DevLayout({ children }: { children: ReactNode }) {
  const enabled =
    env.NODE_ENV !== "production" || env.ENABLE_DEV_PREVIEWS === "1";

  // `notFound()` rather than a redirect: a redirect confirms the route exists.
  if (!enabled) notFound();

  return <>{children}</>;
}
