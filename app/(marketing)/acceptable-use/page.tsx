import type { Metadata } from "next";

import { LegalPage } from "@/features/marketing/components/legal-page";
import { SITE } from "@/features/marketing/content";

export const metadata: Metadata = {
  title: "Acceptable use",
  description:
    "What you may not generate with Atheos, and what happens if you do.",
  alternates: { canonical: `${SITE.domain}/acceptable-use` },
};

/**
 * Specific, because a vague policy is unenforceable and unhelpful.
 *
 * "Do not misuse the service" tells a user nothing about where the line is and
 * gives us no ground to stand on when we remove something. Each rule below
 * names a thing somebody might otherwise reasonably try.
 *
 * The enforcement section is deliberately honest about scale: pretending to
 * moderate around the clock would be a claim we cannot keep, and a victim of
 * something generated here deserves an accurate expectation of response time
 * rather than a reassuring one.
 */
export default function AcceptableUsePage() {
  return (
    <LegalPage title="Acceptable use" updated="13 August 2026">
      <p>
        Atheos generates images and video from text. That is useful and it is
        also easy to misuse, so this page is specific about where the line is.
      </p>

      <h2>Never</h2>
      <ul>
        <li>
          <strong>Sexual content involving minors</strong>, in any style,
          including drawn, stylised or &ldquo;aged-up&rdquo; depictions. This is
          reported to the authorities, not just removed.
        </li>
        <li>
          <strong>
            Intimate imagery of a real person without their consent.
          </strong>{" "}
          Including of yourself if you are under 18, and including anything
          built from a photograph of someone else.
        </li>
        <li>
          <strong>Content that impersonates a real person</strong> in order to
          deceive — a politician saying something they did not say, a public
          figure endorsing something they did not endorse, someone&rsquo;s face
          on a body that is not theirs.
        </li>
        <li>
          <strong>Material designed to cause real harm</strong>: instructions
          for weapons, credible threats, or content promoting self-harm.
        </li>
        <li>
          <strong>Fraud.</strong> Fake identity documents, fake receipts, fake
          screenshots of services you do not control, counterfeit branding.
        </li>
        <li>
          <strong>Harassment</strong> of a specific person.
        </li>
      </ul>

      <h2>Not without permission</h2>
      <ul>
        <li>
          <strong>The likeness of a real, identifiable person.</strong> Fine for
          yourself, or with their consent. Not fine for a stranger, a colleague
          or a celebrity.
        </li>
        <li>
          <strong>Trademarks and characters you do not own.</strong> Generating
          them may be legal where you are; publishing or selling them usually is
          not, and that part is your responsibility.
        </li>
      </ul>

      <h2>Rules about the service itself</h2>
      <ul>
        <li>
          Do not resell raw model access. Building a product <em>on</em> Atheos
          is welcome — reselling the API as if it were yours is not.
        </li>
        <li>
          Do not create multiple accounts to collect free credits repeatedly.
        </li>
        <li>
          Do not try to get around rate limits, or probe other people&rsquo;s
          data. If you find a way to, please tell us — we would rather hear it
          from you.
        </li>
      </ul>

      <h2>What we actually do about it</h2>
      <p>
        Honestly: we are a small team and there is no round-the-clock moderation
        team behind this. We review what is reported to us, and we act on the
        list above in order of harm — the first section immediately, the rest as
        we get to them.
      </p>
      <p>
        Depending on what we find we may remove content, revoke API keys, or
        close the account. For the first section we also report it. If we get it
        wrong, email us and we will reverse it and return the credits.
      </p>

      <h2>Reporting something</h2>
      <p>
        Email <a href="mailto:hello@atheos.io">hello@atheos.io</a> with a link
        or enough detail to find it. If it involves a minor or someone&rsquo;s
        intimate images, say so in the subject line and it goes to the top of
        the queue.
      </p>

      <h2>A note on the models</h2>
      <p>
        Atheos calls third-party models that carry their own safety filters. A
        prompt may be refused by the provider even when this page permits it —
        we do not control those filters, and a refusal on their side is not a
        judgement by us. If a legitimate prompt is being blocked, tell us and we
        will look at whether a different model suits it.
      </p>
    </LegalPage>
  );
}
