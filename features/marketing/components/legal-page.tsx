import type { ReactNode } from "react";

import { Section } from "@/features/marketing/components/section";

/**
 * The frame every legal document renders in.
 *
 * ## Why these are hand-written rather than generated
 *
 * A generated privacy policy describes a generic SaaS. This one has to describe
 * *this* system — Clerk holds the identity, Supabase in us-west-2 holds the
 * database, R2 holds the files, Replicate sees the prompts — because a policy
 * that names the wrong subprocessors is worse than none: it is a written,
 * signed, incorrect statement about where somebody's data went.
 *
 * Everything in these documents is checked against the code. Where the answer
 * is "we have not built that yet", they say so.
 *
 * ## They are not a substitute for a lawyer
 *
 * Said plainly on the page itself rather than only here. These are accurate
 * descriptions of the system written by the people who built it, which is the
 * right *input* to a lawyer's review and not a replacement for one. Atheos is
 * in beta; before it charges anybody, these need a professional read — Peru's
 * Ley 29733 and the GDPR both apply to a product with these users.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** ISO date. Rendered as written — a policy with a vague date is not a policy. */
  updated: string;
  children: ReactNode;
}) {
  return (
    <Section>
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated {updated}
        </p>

        <div className="mt-6 rounded-xl border border-border bg-surface-sunken p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Atheos is in beta. This document is written by the people who built
            the system and describes what it actually does — it has not been
            reviewed by a lawyer. If you are relying on it for anything that
            matters, tell us and we will get you a reviewed version.
          </p>
        </div>

        {/* `prose`-style spacing done with a child selector rather than a
            typography plugin: three documents do not justify the dependency. */}
        <div
          className={[
            "mt-10 space-y-6 text-sm leading-relaxed text-muted-foreground",
            "[&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground",
            "[&_h3]:mt-6 [&_h3]:font-medium [&_h3]:text-foreground",
            "[&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5",
            "[&_strong]:font-medium [&_strong]:text-foreground",
            "[&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline",
          ].join(" ")}
        >
          {children}
        </div>
      </div>
    </Section>
  );
}
