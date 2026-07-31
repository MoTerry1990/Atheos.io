import type { Metadata } from "next";

import { AuthShell } from "@/features/auth/components/auth-shell";
import { VerifyEmailForm } from "@/features/auth/components/verify-email-form";

export const metadata: Metadata = { title: "Verify email" };

export default function VerifyEmailPage() {
  return (
    <AuthShell
      title="Verify your email"
      description="Enter the six-digit code we sent you to finish setting up your account."
    >
      <VerifyEmailForm />
    </AuthShell>
  );
}
