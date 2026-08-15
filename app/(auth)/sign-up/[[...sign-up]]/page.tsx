import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/features/auth/components/auth-shell";
import { enabledOAuthProviders } from "@/services/auth/providers";
import { getUserId } from "@/lib/auth";
// Read, not written twice: this said 200 while the grant was 100, which is a
// promise the product does not keep on the page that makes it.
import { SIGNUP_GRANT } from "@/services/billing/catalogue";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/features/auth/components/sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /**
   * Already signed in — bounce, but bounce where they were going.
   *
   * Clerk rejects a second sign-in with "You are already signed in", which
   * renders as a red error under a form the visitor cannot use. It reads as a
   * broken account rather than a redundant visit.
   *
   * Honouring `redirect_url` here is what lets the marketing site link at
   * `/sign-up?redirect_url=/studio` unconditionally, for signed-in and
   * signed-out visitors alike. The alternative — asking Clerk who the visitor
   * is on the landing page — means a `ClerkProvider` around the marketing
   * tree and its JavaScript on every homepage visit, on the page whose whole
   * point is being fast.
   *
   * Only same-origin relative paths are followed. `//evil.com` is
   * protocol-relative and would navigate off-site, so a leading `//` is
   * rejected along with anything that is not a path.
   */
  if (await getUserId()) {
    const target = (await searchParams).redirect_url;
    const safe =
      typeof target === "string" &&
      target.startsWith("/") &&
      !target.startsWith("//")
        ? target
        : "/dashboard";

    redirect(safe);
  }

  // Asked of Clerk rather than hard-coded, so a button never appears for a
  // provider that is switched off. See services/auth/providers.ts.
  const oauthProviders = await enabledOAuthProviders();

  return (
    <AuthShell
      title="Create your account"
      description={`Start with ${SIGNUP_GRANT} credits a month, free. No card required.`}
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="font-medium text-foreground transition-colors hover:text-primary"
          >
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm oauthProviders={oauthProviders} />
    </AuthShell>
  );
}
