import type { Metadata } from "next";
import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The design system gallery is internal documentation, not product surface.
 *
 * It is excluded from search indexing. It is *not* excluded from the production
 * build, deliberately: a component gallery that only exists locally stops being
 * checked, and a reviewer with a deploy preview URL is the whole point.
 */
export const metadata: Metadata = {
  title: "Design System",
  robots: { index: false, follow: false },
};

export default function DesignSystemLayout({
  children,
}: {
  children: ReactNode;
}) {
  // One provider at the root: a TooltipProvider per tooltip resets the shared
  // open/close delay, so hovering across a toolbar re-triggers the full delay
  // on every item instead of showing instantly after the first.
  return <TooltipProvider delayDuration={300}>{children}</TooltipProvider>;
}
