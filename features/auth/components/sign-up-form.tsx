"use client";

import { useSignUp } from "@clerk/nextjs";
import { AlertCircle, MailCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, InputField } from "@/components/ui/field";
import { OAuthButtons } from "@/features/auth/components/oauth-buttons";
import { OtpInput } from "@/features/auth/components/otp-input";
import { PasswordField } from "@/features/auth/components/password-field";
import { toAuthErrorMessage, toFieldErrors } from "@/features/auth/lib/errors";

/**
 * Sign up, including email verification.
 *
 * ## Why verification is a step, not a route
 *
 * Both phases share one sign-up attempt held in Clerk's client state. Splitting
 * them across routes means a reload mid-flow can land on a verification screen
 * with no attempt to attach the code to — a dead end whose only escape is
 * starting over. Keeping it a step makes that impossible.
 *
 * `/verify-email` still exists for people who close the tab and come back from
 * the email; it resumes the same attempt if one is still live.
 *
 * ## The CAPTCHA element
 *
 * `<div id="clerk-captcha" />` must be in the DOM *before* `create()` runs —
 * Clerk mounts bot protection there. Without it, instances with bot protection
 * enabled fail every sign-up with `captcha_invalid`, and the error gives no
 * clue that a missing div is the cause.
 *
 * Errors are **returned** by the signals API, not thrown, so every call checks
 * its `error` field rather than relying on `try/catch`.
 */
export function SignUpForm() {
  const { signUp } = useSignUp();
  const router = useRouter();

  const [step, setStep] = useState<"details" | "verify">("details");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [resent, setResent] = useState(false);

  async function handleDetails(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError("");
    setFieldErrors({});

    try {
      const { error: createError } = await signUp.create({
        emailAddress: email.trim(),
        password,
        // Clerk rejects empty strings for optional fields, so omit rather than
        // send "".
        ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
      });

      if (createError) {
        setError(toAuthErrorMessage(createError));
        setFieldErrors(toFieldErrors(createError));
        setSubmitting(false);
        return;
      }

      const { error: sendError } = await signUp.verifications.sendEmailCode();
      if (sendError) {
        setError(toAuthErrorMessage(sendError));
        setSubmitting(false);
        return;
      }

      setStep("verify");
      setSubmitting(false);
    } catch (err) {
      setError(toAuthErrorMessage(err));
      setSubmitting(false);
    }
  }

  async function handleVerify(codeValue: string) {
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
        // The Clerk webhook creates our database row asynchronously, so the
        // profile page has to tolerate arriving before that row exists.
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

  if (step === "verify") {
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
              <span className="font-medium text-foreground">{email}</span>.
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
          onComplete={handleVerify}
          disabled={submitting}
        />

        <Button
          variant="gradient"
          size="lg"
          block
          loading={submitting}
          disabled={code.length !== 6}
          onClick={() => handleVerify(code)}
        >
          Verify email
        </Button>

        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={resend}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {resent ? "Code sent" : "Resend code"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("details");
              setCode("");
              setError("");
            }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <OAuthButtons disabled={submitting} />

      <form onSubmit={handleDetails} className="space-y-4">
        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        <Field label="First name" hint="Optional — used to address you.">
          {(props) => (
            <InputField
              {...props}
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              placeholder="Alex"
              autoComplete="given-name"
            />
          )}
        </Field>

        <Field label="Email" error={fieldErrors.email_address} required>
          {(props) => (
            <InputField
              {...props}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@studio.com"
              autoComplete="email"
            />
          )}
        </Field>

        <PasswordField
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          autoComplete="new-password"
          showStrength
        />

        <div id="clerk-captcha" />

        <Button
          type="submit"
          variant="gradient"
          size="lg"
          block
          loading={submitting}
          disabled={!email || !password}
        >
          Create account
        </Button>

        <p className="text-xs text-muted-foreground">
          By creating an account you agree to our Terms and Privacy Policy.
        </p>
      </form>
    </div>
  );
}
