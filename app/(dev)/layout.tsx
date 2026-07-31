import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Internal tooling route group.
 *
 * Everything under `(dev)` — the design-system gallery, the dashboard preview —
 * is documentation and verification surface, not product. The one thing they
 * share is that **none of them may be indexed**: they would compete with the
 * real pages for brand queries and show fixture data to strangers.
 *
 * Setting it once on the group means a new preview route inherits the rule by
 * existing here, rather than by someone remembering. Same principle as the
 * protected layout: make the safe behaviour the default.
 *
 * These routes stay in the production build deliberately. A preview that only
 * exists on localhost stops being checked, and a reviewer with a deploy preview
 * URL is most of the value.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DevLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
