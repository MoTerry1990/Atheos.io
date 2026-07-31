import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/features/auth/components/auth-shell";
import { SignUpForm } from "@/features/auth/components/sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
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
      <SignUpForm />
    </AuthShell>
  );
}
