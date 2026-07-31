import { isClerkAPIResponseError } from "@clerk/nextjs/errors";

/**
 * Turning Clerk errors into something a person can act on.
 *
 * ## Two error shapes, not one
 *
 * Clerk 7's signals API (`useSignIn`/`useSignUp`) **returns** errors —
 * `const { error } = await signIn.password(...)` — rather than throwing them.
 * Older surfaces still throw `ClerkAPIResponseError`. Both reach this function,
 * so it normalises either into a single string.
 *
 * Getting this wrong is subtle and bad: `try/catch` around a signals call
 * catches nothing, the returned error is ignored, and the form silently does
 * nothing when a password is wrong.
 *
 * ## The override list
 *
 * Most of Clerk's `longMessage` strings are fine to show verbatim. These are the
 * ones that are not:
 *
 * - **Enumeration.** `form_identifier_not_found` on a password reset tells an
 *   attacker whether an address is registered. The forgot-password form
 *   swallows that code entirely rather than relying on wording.
 * - **Jargon.** "Identifier" is not a word users know. It is an email here.
 * - **Dead ends.** Some messages state a problem with no next step.
 *
 * Everything unrecognised falls through to Clerk's own copy. This is a targeted
 * override list, not a translation layer — a full one drifts silently.
 */

const OVERRIDES: Record<string, string> = {
  form_identifier_not_found: "No account found with that email address.",
  form_password_incorrect: "That password is not correct.",
  form_password_pwned:
    "This password has appeared in a known data breach. Please choose a different one.",
  form_password_length_too_short: "Passwords need to be at least 8 characters.",
  form_identifier_exists:
    "An account already exists with that email. Try signing in instead.",
  form_code_incorrect: "That code is not correct. Check it and try again.",
  verification_expired: "That code has expired. Request a new one.",
  verification_failed:
    "Too many incorrect attempts. Request a new code to continue.",
  session_exists: "You are already signed in.",
  captcha_invalid:
    "We could not verify that you are human. Refresh the page and try again.",
  form_param_format_invalid: "That does not look like a valid email address.",
  form_param_nil: "This field is required.",
  too_many_requests: "Too many attempts. Wait a moment and try again.",
};

const FALLBACK = "Something went wrong. Please try again.";

/** Narrow an unknown value to something with a string `code`. */
function hasCode(value: unknown): value is { code: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code: unknown }).code === "string"
  );
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === "string" ? found : undefined;
}

/** A message that is safe and useful to show a user. */
export function toAuthErrorMessage(error: unknown): string {
  if (!error) return FALLBACK;

  // Thrown shape: ClerkAPIResponseError, with an `errors` array.
  if (isClerkAPIResponseError(error)) {
    const first = error.errors[0];
    if (!first) return FALLBACK;
    return (
      OVERRIDES[first.code] ?? first.longMessage ?? first.message ?? FALLBACK
    );
  }

  // Returned shape: a single ClerkError from the signals API.
  if (hasCode(error)) {
    return (
      OVERRIDES[error.code] ??
      readString(error, "longMessage") ??
      readString(error, "message") ??
      FALLBACK
    );
  }

  // Some returned errors nest an `errors` array of their own.
  if (typeof error === "object" && error !== null && "errors" in error) {
    const list = (error as { errors: unknown }).errors;
    if (Array.isArray(list) && list.length > 0) {
      return toAuthErrorMessage(list[0]);
    }
  }

  // Never surface a raw exception: it can leak internals and is never
  // actionable for the person reading it.
  return FALLBACK;
}

/**
 * Field-level errors, keyed by the form field Clerk blames.
 *
 * Lets a password problem render under the password input instead of in a
 * banner at the top of the form.
 */
export function toFieldErrors(error: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!error) return fields;

  const collect = (item: unknown) => {
    const param =
      readString((item as { meta?: unknown })?.meta, "paramName") ??
      readString(item, "paramName");
    if (!param) return;
    fields[param] = toAuthErrorMessage(item);
  };

  if (isClerkAPIResponseError(error)) {
    error.errors.forEach(collect);
    return fields;
  }

  if (typeof error === "object" && error !== null && "errors" in error) {
    const list = (error as { errors: unknown }).errors;
    if (Array.isArray(list)) list.forEach(collect);
    return fields;
  }

  collect(error);
  return fields;
}
