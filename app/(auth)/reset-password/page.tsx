import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/features/auth/components/auth-shell";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Choose a new password"
      description="Enter the code we emailed you and pick a new password."
      footer={
        <>
          Need help?{" "}
          <Link
            href="/sign-in"
            className="font-medium text-foreground transition-colors hover:text-primary"
          >
            Back to sign in
          </Link>
        </>
      }
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
