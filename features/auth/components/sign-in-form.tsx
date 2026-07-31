"use client";

import { useSignIn } from "@clerk/nextjs";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, InputField } from "@/components/ui/field";
import { OAuthButtons } from "@/features/auth/components/oauth-buttons";
import { PasswordField } from "@/features/auth/components/password-field";
import { toAuthErrorMessage, toFieldErrors } from "@/features/auth/lib/errors";

/**
 * Sign in.
 *
 * Custom flow so the screen is built from our design system. Clerk still does
 * everything that matters — the password is handed straight to
 * `signIn.password()` and verified on their servers.
 *
 * ## Clerk 7's signals API
 *
 * Two things differ from every older Clerk example, and both are easy to get
 * wrong:
 *
 * 1. **Errors are returned, not thrown.** `const { error } = await
 *    signIn.password(...)`. A `try/catch` alone catches nothing and the form
 *    silently does nothing on a wrong password. The `catch` here is only for
 *    network-level failures.
 *
 * 2. **`finalize()` establishes the session**, replacing `setActive`. Until it
 *    resolves there is no session, so navigating before it completes lands the
 *    user on a protected route that bounces them straight back here.
 *
 * ## The status check
 *
 * A successful `password()` call does not always mean "signed in" — MFA
 * accounts land on `needs_second_factor`. Treating any non-error result as
 * success is how a custom flow appears to sign someone in without a session.
 * The explicit branch makes adding MFA later fail loudly instead of silently.
 *
 * ## Redirect safety
 *
 * `redirect_url` comes from the middleware. It is validated to be a same-origin
 * relative path — accepting an absolute URL would make this an open redirect,
 * which is a real phishing vector on a login page.
 */
export function SignInForm() {
  const { signIn } = useSignIn();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // `//evil.com` is protocol-relative and would navigate off-site, so a
  // leading `//` is rejected alongside absolute URLs.
  const requested = searchParams.get("redirect_url");
  const redirectTo =
    requested && requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/profile";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError("");
    setFieldErrors({});

    try {
      const { error: signInError } = await signIn.password({
        identifier: email.trim(),
        password,
      });

      if (signInError) {
        setError(toAuthErrorMessage(signInError));
        setFieldErrors(toFieldErrors(signInError));
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
        router.push(redirectTo);
        return;
      }

      if (signIn.status === "needs_second_factor") {
        setError(
          "This account uses two-factor authentication, which is not wired up yet. Contact support to sign in.",
        );
        setSubmitting(false);
        return;
      }

      setError(
        `Additional verification is required (${signIn.status}). Please contact support.`,
      );
      setSubmitting(false);
    } catch (err) {
      // Only reached for transport-level failures — the API's own errors come
      // back in the resolved value above.
      setError(toAuthErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <OAuthButtons disabled={submitting} />

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

        <Field label="Email" error={fieldErrors.identifier} required>
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

        <div className="space-y-1.5">
          <PasswordField
            value={password}
            onChange={setPassword}
            error={fieldErrors.password}
            autoComplete="current-password"
          />
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        {/* Clerk mounts bot protection into this element. Omitting it makes
            sign-in fail with `captcha_invalid` on any instance that has bot
            protection switched on, with no hint that a missing div is why. */}
        <div id="clerk-captcha" />

        <Button
          type="submit"
          variant="gradient"
          size="lg"
          block
          loading={submitting}
          disabled={!email || !password}
        >
          Sign in
        </Button>
      </form>
    </div>
  );
}
