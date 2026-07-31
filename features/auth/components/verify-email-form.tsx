"use client";

import { useSignUp } from "@clerk/nextjs";
import { AlertCircle, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { OtpInput } from "@/features/auth/components/otp-input";
import { toAuthErrorMessage } from "@/features/auth/lib/errors";

/**
 * Standalone email verification.
 *
 * This route exists for one specific and very common situation: someone signs
 * up on a laptop, opens the email on their phone, and taps through. They arrive
 * with no sign-up state in that browser.
 *
 * Rather than showing a code box that can never succeed, the component checks
 * for a live attempt and, if there is none, explains why and offers a way
 * forward. A verification screen that silently fails is among the worst dead
 * ends in any product, because the user has already done their part.
 *
 * The happy path — verifying in the same tab — is handled inline by
 * `SignUpForm` and never loads this page.
 */
export function VerifyEmailForm() {
  const { signUp } = useSignUp();
  const router = useRouter();

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resent, setResent] = useState(false);

  const pendingEmail = signUp.emailAddress;
  const hasAttempt = Boolean(signUp.id) && Boolean(pendingEmail);

  async function verify(codeValue: string) {
    if (submitting) return;

    setSubmitting(true);
    setError("");

    try {
      const { error: verifyError } = await signUp.verifications.verifyEmailCode(
        { code: codeValue },
      );

      if (verifyError) {
        setError(toAuthErrorMessage(verifyError));
        setCode("");
        setSubmitting(false);
        return;
      }

      if (signUp.status === "complete") {
        const { error: finalizeError } = await signUp.finalize();
        if (finalizeError) {
          setError(toAuthErrorMessage(finalizeError));
          setSubmitting(false);
          return;
        }
        router.push("/profile");
        return;
      }

      setError(
        `Sign-up is incomplete (${signUp.status}). Please contact support.`,
      );
      setSubmitting(false);
    } catch (err) {
      setError(toAuthErrorMessage(err));
      setCode("");
      setSubmitting(false);
    }
  }

  async function resend() {
    setError("");
    const { error: sendError } = await signUp.verifications.sendEmailCode();
    if (sendError) {
      setError(toAuthErrorMessage(sendError));
      return;
    }
    setResent(true);
    setTimeout(() => setResent(false), 4000);
  }

  if (!hasAttempt) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-surface-sunken p-4 text-sm">
          <p className="font-medium">No sign-up in progress</p>
          <p className="mt-1 text-muted-foreground">
            Verification codes are tied to the browser that started the sign-up.
            If you began on another device, finish there — or start again here.
          </p>
        </div>
        <Button variant="gradient" size="lg" block asChild>
          <Link href="/sign-up">Create an account</Link>
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already verified?{" "}
          <Link
            href="/sign-in"
            className="text-foreground transition-colors hover:text-primary"
          >
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-sunken p-4">
        <MailCheck
          className="mt-0.5 size-5 shrink-0 text-primary"
          aria-hidden
        />
        <div className="text-sm">
          <p className="font-medium">Check your email</p>
          <p className="mt-0.5 text-muted-foreground">
            We sent a six-digit code to{" "}
            <span className="font-medium text-foreground">{pendingEmail}</span>.
          </p>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <OtpInput
        value={code}
        onChange={setCode}
        onComplete={verify}
        disabled={submitting}
      />

      <Button
        variant="gradient"
        size="lg"
        block
        loading={submitting}
        disabled={code.length !== 6}
        onClick={() => verify(code)}
      >
        Verify email
      </Button>

      <button
        type="button"
        onClick={resend}
        className="w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {resent ? "Code sent" : "Resend code"}
      </button>
    </div>
  );
}
