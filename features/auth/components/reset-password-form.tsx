"use client";

import { useSignIn } from "@clerk/nextjs";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { OtpInput } from "@/features/auth/components/otp-input";
import { PasswordField } from "@/features/auth/components/password-field";
import { toAuthErrorMessage, toFieldErrors } from "@/features/auth/lib/errors";

/**
 * Enter the reset code and choose a new password.
 *
 * Three calls in order: `verifyCode` proves control of the mailbox,
 * `submitPassword` sets the new one, `finalize` establishes the session. They
 * are separate so a wrong code fails before the user's chosen password is sent
 * anywhere.
 *
 * ## Resuming
 *
 * The attempt lives in Clerk's client state. Opening this page directly without
 * having requested a code leaves `status` as something other than
 * `needs_first_factor`, and there is nothing to verify against — so we say so
 * and send them back, rather than showing a form that cannot succeed.
 *
 * ## Signing in afterwards
 *
 * `finalize` signs them straight in. Making someone who just proved control of
 * their email retype the password they chose ten seconds ago is friction with
 * no security benefit.
 *
 * `signOutOfOtherSessions` is on: a password reset is the standard response to
 * a suspected compromise, and leaving the attacker's session alive would defeat
 * the point.
 */
export function ResetPasswordForm() {
  const { signIn } = useSignIn();
  const router = useRouter();

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);

  const noAttempt =
    signIn.status !== null && signIn.status !== "needs_first_factor";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError("");
    setFieldErrors({});

    try {
      // Skip re-verifying if a previous attempt already accepted the code and
      // only the password step failed.
      if (!verified) {
        const { error: verifyError } =
          await signIn.resetPasswordEmailCode.verifyCode({ code });

        if (verifyError) {
          setError(toAuthErrorMessage(verifyError));
          setCode("");
          setSubmitting(false);
          return;
        }
        setVerified(true);
      }

      const { error: passwordError } =
        await signIn.resetPasswordEmailCode.submitPassword({
          password,
          signOutOfOtherSessions: true,
        });

      if (passwordError) {
        setError(toAuthErrorMessage(passwordError));
        setFieldErrors(toFieldErrors(passwordError));
        setSubmitting(false);
        return;
      }

      if (signIn.status === "complete") {
        const { error: finalizeError } = await signIn.finalize();
        if (finalizeError) {
          setError(toAuthErrorMessage(finalizeError));
          setSubmitting(false);
          return;
        }
        router.push("/profile");
        return;
      }

      if (signIn.status === "needs_second_factor") {
        setError(
          "This account uses two-factor authentication, which is not wired up yet. Contact support.",
        );
        setSubmitting(false);
        return;
      }

      setError(`Reset is incomplete (${signIn.status}). Please try again.`);
      setSubmitting(false);
    } catch (err) {
      setError(toAuthErrorMessage(err));
      setSubmitting(false);
    }
  }

  if (noAttempt) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-surface-sunken p-4 text-sm">
          <p className="font-medium">No reset in progress</p>
          <p className="mt-1 text-muted-foreground">
            Reset codes are tied to a request. Start again and we will send you
            a fresh one.
          </p>
        </div>
        <Button variant="gradient" size="lg" block asChild>
          <Link href="/forgot-password">Request a reset code</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-medium">Reset code</p>
        <OtpInput
          value={code}
          onChange={setCode}
          disabled={submitting || verified}
        />
      </div>

      <PasswordField
        label="New password"
        value={password}
        onChange={setPassword}
        error={fieldErrors.password}
        autoComplete="new-password"
        showStrength
      />

      <Button
        type="submit"
        variant="gradient"
        size="lg"
        block
        loading={submitting}
        disabled={code.length !== 6 || password.length < 8}
      >
        Reset password and sign in
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Didn&apos;t get a code?{" "}
        <Link
          href="/forgot-password"
          className="text-foreground transition-colors hover:text-primary"
        >
          Send another
        </Link>
      </p>
    </form>
  );
}
