import type { Metadata } from "next";

import { LegalPage } from "@/features/marketing/components/legal-page";
import { SITE } from "@/features/marketing/content";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "What Atheos promises during beta, what it does not, and who owns the output.",
  alternates: { canonical: `${SITE.domain}/terms` },
};

/**
 * Written for a product that is genuinely in beta.
 *
 * The temptation with terms is to promise nothing and disclaim everything. That
 * is enforceable and it is also a document that tells a prospective user their
 * work might vanish and nobody will care. The promises here are the ones we can
 * actually keep with what is deployed — refunds on provider failure, ownership
 * of output, no training on user content — and the gaps are named as gaps.
 */
export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="13 August 2026">
      <p>
        Using Atheos means agreeing to this. It is short because the product is
        small and new.
      </p>

      <h2>Atheos is in beta</h2>
      <p>
        That is not a disclaimer bolted on — it changes what you should expect:
      </p>
      <ul>
        <li>
          Features will change, and some will be removed. Anything described as
          coming soon is not built and may never be.
        </li>
        <li>
          There is <strong>no uptime guarantee</strong>. We run on the same
          infrastructure as everyone else and it has bad days.
        </li>
        <li>
          <strong>Keep your own copies of anything you care about.</strong> We
          take backups and we intend to keep your library forever. We are not
          yet in a position to promise it.
        </li>
      </ul>

      <h2>Your account</h2>
      <p>
        One account per person. You are responsible for what happens under it,
        including anything done with an API key you created — a key spends your
        credits exactly as you do, so treat it like a password and revoke it if
        it leaks.
      </p>
      <p>
        You must be old enough to enter a contract where you live. If you are
        under 18, do not sign up.
      </p>

      <h2>Credits</h2>
      <ul>
        <li>
          Credits pay for generations. The cost is shown <strong>before</strong>{" "}
          you press the button, never after.
        </li>
        <li>
          <strong>
            A generation that fails on the provider&rsquo;s side is refunded
            automatically.
          </strong>{" "}
          Not on request — automatically, in the same transaction that records
          the failure.
        </li>
        <li>
          A generation that <em>succeeds</em> but that you dislike is not
          refunded. The model ran and we were billed for it.
        </li>
        <li>
          Credits are not money and cannot be cashed out. Free credits may
          expire; purchased credits do not.
        </li>
      </ul>

      <h2>Who owns what you make</h2>
      <p>
        <strong>You do.</strong> Atheos claims no rights over your prompts or
        your output, and you may use them commercially.
      </p>
      <p>
        Two honest caveats. The underlying model providers have their own terms,
        and those apply to output made with their models. And in several
        countries, including the United States, purely AI-generated work may not
        be copyrightable by anyone — that is the law&rsquo;s position, not ours,
        and we cannot grant you rights the law does not recognise.
      </p>
      <p>
        We do not train models on your content. We do not train models at all.
      </p>

      <h2>What you may not do</h2>
      <p>
        The specifics are in the{" "}
        <a href="/acceptable-use">acceptable use policy</a>. In short: nothing
        illegal, nothing sexual involving minors, no impersonation of real
        people, and no reselling raw model access.
      </p>
      <p>
        We can suspend an account that breaks those rules. If we do it wrongly,
        email us and we will fix it and return the credits.
      </p>

      <h2>Payment</h2>
      <p>
        Billing is not live yet. When it is: subscriptions renew until
        cancelled, cancelling takes effect at the end of the period you have
        paid for, and we do not pro-rate refunds for a partially used month. If
        we charge you in error, tell us and we will refund it.
      </p>

      <h2>Ending it</h2>
      <p>
        You can delete your account at any time from settings. We can close an
        account for breaking these terms, and we will say why. If we shut Atheos
        down, we will give at least 30 days&rsquo; notice and a way to export
        your work.
      </p>

      <h2>Liability</h2>
      <p>
        Atheos is provided as it is. To the extent the law allows, we are not
        liable for indirect or consequential loss, and our total liability is
        capped at what you paid us in the previous twelve months — which for a
        free beta account is nothing.
      </p>
      <p>
        Nothing here limits liability we are not allowed to limit, such as for
        fraud.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We will email you before a material change takes effect. Questions to{" "}
        <a href="mailto:hello@atheos.io">hello@atheos.io</a>.
      </p>
    </LegalPage>
  );
}
