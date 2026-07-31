import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthShell } from "@/features/auth/components/auth-shell";
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
export default function SignInPage() {
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
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
