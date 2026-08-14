import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/features/auth/components/auth-shell";
import { enabledOAuthProviders } from "@/services/auth/providers";
import { SignUpForm } from "@/features/auth/components/sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  // Asked of Clerk rather than hard-coded, so a button never appears for a
  // provider that is switched off. See services/auth/providers.ts.
  const oauthProviders = await enabledOAuthProviders();

  return (
    <AuthShell
      title="Create your account"
      description="Start with 200 credits a month, free. No card required."
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
