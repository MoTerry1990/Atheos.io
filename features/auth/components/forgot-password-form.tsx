"use client";

import { useSignIn } from "@clerk/nextjs";
import { AlertCircle, MailCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, InputField } from "@/components/ui/field";
import { toAuthErrorMessage } from "@/features/auth/lib/errors";

/**
 * Request a password-reset code.
 *
 * Two calls: `create({ identifier })` attaches the email to the attempt, then
 * `resetPasswordEmailCode.sendCode()` sends the code. `sendCode` takes no
 * arguments — it reads the identifier from the attempt, which is why the order
 * matters and why calling it first silently does nothing.
 *
 * ## Account enumeration
 *
 * The important decision on this screen is what happens when the email is *not*
 * registered. Saying so turns the form into an oracle: an attacker can test an
 * address list and learn who has an account here, which is useful for
 * credential stuffing and for targeted phishing.
 *
 * So a "not found" result shows the success state anyway. Someone who typo'd
 * their address simply never receives the email — the same experience as
 * mistyping into an address that does exist.
 *
 * This is deliberately a *different* choice from the sign-in form, which does
 * say when an account is not found. Sign-in already reveals account existence
 * through the password check, so hiding it there costs usability for no gain.
 * Here there is no such leak to begin with, so it is worth protecting.
 */
export function ForgotPasswordForm() {
  const { signIn } = useSignIn();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  function isNotFound(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "form_identifier_not_found"
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError("");

    try {
      const { error: createError } = await signIn.create({
        identifier: email.trim(),
      });

      if (createError) {
        // Unknown address: show success anyway. See the note above.
        if (isNotFound(createError)) {
          setSent(true);
        } else {
          setError(toAuthErrorMessage(createError));
        }
        setSubmitting(false);
        return;
      }

      const { error: sendError } =
        await signIn.resetPasswordEmailCode.sendCode();

      if (sendError && !isNotFound(sendError)) {
        setError(toAuthErrorMessage(sendError));
        setSubmitting(false);
        return;
      }

      setSent(true);
      setSubmitting(false);
    } catch (err) {
      setError(toAuthErrorMessage(err));
      setSubmitting(false);
    }
  }

  if (sent) {
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
              If an account exists for{" "}
              <span className="font-medium text-foreground">{email}</span>, we
              have sent a reset code to it.
            </p>
          </div>
        </div>

        <Button
          variant="gradient"
          size="lg"
          block
          onClick={() => router.push("/reset-password")}
        >
          Enter reset code
        </Button>

        <button
          type="button"
          onClick={() => {
            setSent(false);
            setEmail("");
          }}
          className="w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <Field
        label="Email"
        hint="We will send a six-digit code to this address."
        required
      >
        {(props) => (
          <InputField
            {...props}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@studio.com"
            autoComplete="email"
            autoFocus
          />
        )}
      </Field>

      <div id="clerk-captcha" />

      <Button
        type="submit"
        variant="gradient"
        size="lg"
        block
        loading={submitting}
        disabled={!email}
      >
        Send reset code
      </Button>
    </form>
  );
}
