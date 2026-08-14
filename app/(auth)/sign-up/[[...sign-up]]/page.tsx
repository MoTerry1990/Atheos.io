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

export default async function SignUpPage() {
  // Already signed in. Clerk rejects a second sign-in attempt with "You are
  // already signed in", which renders as a red error under a form the user
  // cannot use — it reads as a broken account rather than as a redundant
  // visit. Bounce them to the workspace instead.
  if (await getUserId()) redirect("/dashboard");

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
