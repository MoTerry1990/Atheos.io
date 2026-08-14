import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { SequenceWorkspace } from "@/features/sequences/components/sequence-workspace";
import { requireUser } from "@/lib/auth";

/**
 * Sequences — long-form video.
 *
 * Its own route rather than a mode inside the studio: the studio is built
 * around one prompt and one result, and a sequence is N of each with a cut
 * order between them. Folding it in would have meant a second meaning for
 * every control on that page.
 */
export const metadata: Metadata = {
  title: "Sequences",
  description: "Assemble a longer video from many generated clips.",
};

export default async function SequencesPage() {
  await requireUser();

  return (
    <Container>
      <PageHeader
        title="Sequences"
        description="No model generates more than 12 seconds at once. Write the shots, and each one continues from the last frame of the one before it — then Atheos assembles them into a single video."
      />
      <SequenceWorkspace />
    </Container>
  );
}
