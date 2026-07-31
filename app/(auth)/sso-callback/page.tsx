import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

import { Spinner } from "@/components/ui/loading";

/**
 * OAuth landing point.
 *
 * The provider redirects here with a code in the URL.
 * `AuthenticateWithRedirectCallback` exchanges it for a session and then
 * forwards on — it renders nothing, so the spinner is the entire visible page.
 *
 * The two URL props are not interchangeable:
 *
 *   `signInFallbackRedirectUrl`  existing user, session established
 *   `signUpFallbackRedirectUrl`  first time through this provider, account created
 *
 * Both point at `/profile` today, but they are the hook for sending new users
 * through onboarding later without touching the sign-in path.
 *
 * This route is public in the middleware. It has to be: the user has no session
 * yet at the moment they arrive, which is the entire point of the callback.
 */
export default function SSOCallbackPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <Spinner size="lg" tone="brand" label="Completing sign-in" />
      <p className="text-sm text-muted-foreground">Completing sign-in…</p>

      <AuthenticateWithRedirectCallback
        signInFallbackRedirectUrl="/profile"
        signUpFallbackRedirectUrl="/profile"
      />
    </main>
  );
}
