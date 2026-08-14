import type { Metadata } from "next";

import { LegalPage } from "@/features/marketing/components/legal-page";
import { SITE } from "@/features/marketing/content";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What Atheos stores, who processes it, and how to get it deleted.",
  alternates: { canonical: `${SITE.domain}/privacy` },
};

/**
 * Every subprocessor named here is one the code actually calls.
 *
 * Checked against `lib/env.ts` and `services/`: Clerk for identity, Supabase
 * (AWS us-west-2) for the database, Cloudflare R2 for files, Replicate for
 * generation, Stripe for payment. Naming a processor we do not use, or omitting
 * one we do, is the specific way a privacy policy becomes a liability rather
 * than a protection.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="13 August 2026">
      <p>
        This describes what Atheos stores about you, which companies process it
        on our behalf, and how to get rid of it. It is written to be read rather
        than to be defensible.
      </p>

      <h2>What we store</h2>

      <h3>Your account</h3>
      <p>
        Your email address, and your name and profile picture if your sign-in
        provider gives us them. Identity is handled by <strong>Clerk</strong>;
        we keep a mirror row so your work can belong to something.{" "}
        <strong>We never see your password</strong> — Clerk holds it, and if you
        signed in with Google or GitHub there is no password to hold.
      </p>

      <h3>What you make</h3>
      <p>
        Your prompts, the settings you chose, and the images and videos that
        came out. Generated files are stored in our own object storage rather
        than left on a provider&rsquo;s temporary URL, so your library still
        works months later.
      </p>

      <h3>Your credits</h3>
      <p>
        Every credit movement is recorded in an append-only ledger — what was
        spent, on what, and what was refunded. This is deliberate: it is what
        lets us prove a failed generation was not charged to you.
      </p>

      <h3>What we do not store</h3>
      <ul>
        <li>
          <strong>Card numbers.</strong> If and when payments go live, Stripe
          handles them and we receive only the last four digits and the brand.
        </li>
        <li>
          <strong>Analytics or advertising trackers.</strong> There are none on
          this site. No Google Analytics, no pixels, no third-party cookies.
        </li>
      </ul>

      <h2>Who else processes it</h2>
      <p>
        Running this needs other companies. Each of these sees a specific slice
        and nothing more:
      </p>
      <ul>
        <li>
          <strong>Clerk</strong> — your identity, sign-in and password.
        </li>
        <li>
          <strong>Supabase</strong> — the database, hosted on AWS in Oregon,
          United States.
        </li>
        <li>
          <strong>Cloudflare R2</strong> — the files you generate.
        </li>
        <li>
          <strong>Replicate</strong> — receives your prompt and the settings in
          order to run the model. It does not receive your email or your name.
        </li>
        <li>
          <strong>Vercel</strong> — serves the site and keeps short-lived
          request logs.
        </li>
        <li>
          <strong>Stripe</strong> — payments, once billing is live. Not yet.
        </li>
      </ul>
      <p>
        Your data is stored in the <strong>United States</strong>. If you are in
        Peru, the European Union or the United Kingdom, that is an international
        transfer and you should know it before signing up.
      </p>

      <h2>What we do not do with it</h2>
      <ul>
        <li>
          <strong>
            We do not train models on your prompts or your output.
          </strong>{" "}
          We do not train models at all — we call other people&rsquo;s.
        </li>
        <li>
          <strong>We do not sell your data</strong>, and we do not share it with
          anyone beyond the processors listed above.
        </li>
        <li>
          <strong>Your work is private by default.</strong> Nothing you generate
          appears in the public gallery unless you publish it yourself, and you
          can unpublish it again.
        </li>
      </ul>
      <p>
        We can see your prompts and output when investigating a specific problem
        — a failed generation, a support question, a suspected abuse report. We
        do not browse them otherwise.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Your account and its contents stay until you delete them. Deleting your
        account removes your row, your assets and your projects. The credit
        ledger is kept in anonymised form, because financial records have to be
        reconcilable after the account they belonged to is gone.
      </p>

      <h2>What you can ask for</h2>
      <p>
        Export, correction or deletion of your data, or an explanation of what
        we hold. Email <a href="mailto:hello@atheos.io">hello@atheos.io</a> and
        we will do it. We are a small team in beta, so give us a few days rather
        than a few hours.
      </p>
      <p>
        Under Peru&rsquo;s Ley 29733 and the GDPR you have these rights whether
        or not we grant them in a document. This paragraph does not create them
        and cannot take them away.
      </p>

      <h2>Cookies</h2>
      <p>
        Only what is needed to keep you signed in and to remember your theme and
        language. No tracking cookies, which is why this site has no cookie
        banner — there is nothing to consent to.
      </p>

      <h2>Changes</h2>
      <p>
        If this changes in a way that affects what we do with your data, we will
        email you before it takes effect rather than quietly changing the date
        at the top.
      </p>
    </LegalPage>
  );
}
