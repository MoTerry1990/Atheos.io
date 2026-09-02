import type { Metadata } from "next";

import { LegalPage } from "@/features/marketing/components/legal-page";
import { SITE } from "@/features/marketing/content";

export const metadata: Metadata = {
  title: "Content details",
  description:
    "How the video and images on this site were made, and what happened to them before they were published.",
  alternates: { canonical: `${SITE.domain}/content-details` },
};

/**
 * The disclosure the file could not carry.
 *
 * ## Why a page rather than metadata
 *
 * The hero's master arrives from the model with a C2PA manifest and a SynthID
 * watermark. A C2PA manifest is signed over the exact bytes it describes, so
 * **any** re-encode invalidates it — and a 44 MB master cannot be the file a
 * visitor downloads. Publishing therefore means choosing between a manifest
 * nobody can load and a page nobody has to.
 *
 * This is that page. It is not a replacement for C2PA and does not claim to
 * be: a manifest is verifiable and prose is not. What it does is make sure the
 * *claim* survives even though the cryptography did not, which is the part a
 * viewer is actually owed.
 *
 * ## Why it is written plainly
 *
 * The temptation with a disclosure is to make it thorough enough to be
 * unreadable, which discharges the obligation on paper and nothing in
 * practice. Short sentences, no hedging, and the one number that matters — the
 * master is kept, and it is 44 MB.
 */
export default function ContentDetailsPage() {
  return (
    <LegalPage title="Content details" updated="2 September 2026">
      <p>
        The video and images on this site were generated with Atheos. Nothing
        here is stock footage, and nothing here was taken from anywhere else.
      </p>

      <h2>The video on the home page</h2>
      <p>
        It is <strong>AI-generated</strong>. What you see is a web-optimised
        copy: the original is 1920×1080, eight seconds, and 44 MB, which is far
        too large to send to a browser. The published copy is the same picture
        and the same length, compressed to about 6 MB so the page loads.
      </p>
      <p>
        It has a real soundtrack. It starts muted because browsers do not allow
        sound to start on its own, and because a page that makes noise uninvited
        is a page people close. The <em>Hear audio</em> button turns it on, and
        nothing else does.
      </p>

      <h2>What compression cost</h2>
      <p>
        The original carries content credentials — a cryptographic record,
        signed by the model that made it, saying what it is. That signature
        covers the exact file, so compressing the video breaks it. The published
        copy therefore{" "}
        <strong>cannot be verified with a content-credentials checker</strong>,
        and we do not claim it can.
      </p>
      <p>
        The original is kept, unmodified, with its credentials intact. Both
        files are recorded by checksum internally, so the published copy can
        always be traced back to the original it came from.
      </p>
      <p>
        The original also carries an invisible watermark in the picture itself,
        which is designed to survive compression. We have no way to test that
        here, so we neither claim it survived nor claim it did not.
      </p>

      <h2>Why we bother saying this</h2>
      <p>
        Because the alternative is a marketing page that looks like a car
        advertisement and never mentions that no car was filmed. Knowing which
        you are looking at should not depend on whether you thought to check.
      </p>
    </LegalPage>
  );
}
