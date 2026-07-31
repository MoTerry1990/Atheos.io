import type { Metadata } from "next";

import { StudioWorkspace } from "@/features/studio/components/studio-workspace";

export const metadata: Metadata = { title: "Studio" };

/**
 * The studio route.
 *
 * A thin wrapper. The workspace is entirely client state — Sprint 5 builds the
 * interface and its state management, and there is nothing on the server to
 * fetch yet.
 *
 * That changes in Sprint 6: the job queue moves server-side, and this page will
 * fetch in-flight jobs so a reload can show what is actually running rather
 * than an empty queue.
 */
export default function StudioPage() {
  return <StudioWorkspace />;
}
