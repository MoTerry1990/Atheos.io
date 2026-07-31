"use client";

import { StudioWorkspace } from "@/features/studio/components/studio-workspace";

/**
 * Studio preview.
 *
 * The production `StudioWorkspace`, outside the authenticated group so it can
 * be opened and exercised without a Clerk instance. Same pattern as
 * `/dashboard-preview`, and the same reason: an interface that has only been
 * typechecked has not been verified.
 *
 * This one needs no fixtures — the studio is pure client state, so it behaves
 * here exactly as it does at `/studio`. That is a property of the design, not a
 * coincidence: keeping the workspace free of server data is what makes it
 * testable in isolation.
 *
 * `noindex` via the `(dev)` layout, and excluded from Clerk's middleware
 * matcher so the development handshake does not intercept it.
 */
export default function StudioPreviewPage() {
  return (
    <div className="h-dvh">
      <StudioWorkspace />
    </div>
  );
}
