import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/features/auth/components/auth-shell";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email you signed up with and we will send you a code."
      footer={
        <>
          Remembered it?{" "}
          <Link
            href="/sign-in"
            className="font-medium text-foreground transition-colors hover:text-primary"
          >
            Back to sign in
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
