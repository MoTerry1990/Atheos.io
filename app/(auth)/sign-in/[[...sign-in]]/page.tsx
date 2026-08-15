import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthShell } from "@/features/auth/components/auth-shell";
import { enabledOAuthProviders } from "@/services/auth/providers";
import { getUserId } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { Spinner } from "@/components/ui/loading";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Optional catch-all (`[[...sign-in]]`) so Clerk can append its own path
 * segments during multi-step flows — factor-one, factor-two, SSO callbacks —
 * without a 404. A plain `/sign-in` route breaks the moment MFA is enabled.
 *
 * `SignInForm` reads `useSearchParams` for the post-login redirect, which
 * requires a Suspense boundary or the whole route opts out of static rendering.
 */
export default async function SignInPage({
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
      title="Welcome back"
      description="Sign in to continue to your workspace."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link
            href="/sign-up"
            className="font-medium text-foreground transition-colors hover:text-primary"
          >
            Create one
          </Link>
        </>
      }
    >
      <Suspense
        fallback={
          <div className="flex justify-center py-8">
            <Spinner size="md" tone="brand" />
          </div>
        }
      >
        <SignInForm oauthProviders={oauthProviders} />
      </Suspense>
    </AuthShell>
  );
}
