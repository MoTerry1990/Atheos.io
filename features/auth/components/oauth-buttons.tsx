"use client";

import { useSignIn } from "@clerk/nextjs";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toAuthErrorMessage } from "@/features/auth/lib/errors";

/**
 * Social sign-in.
 *
 * A redirect flow rather than a popup: popups are blocked by default on iOS
 * Safari and inside in-app browsers, which together are a large share of mobile
 * traffic. Redirects work everywhere.
 *
 * The same buttons serve sign-in and sign-up — Clerk creates the account if it
 * does not exist. Presenting them as separate paths would be a distinction
 * without a difference, and a user who signed up with Google six months ago
 * does not remember which button they used.
 *
 * `redirectCallbackUrl` is where the provider returns to (our `/sso-callback`
 * page); `redirectUrl` is where the user ends up once the session exists. Both
 * must be absolute — the provider redirects from its own origin, so a relative
 * path has nothing to resolve against.
 *
 * Provider logos are inline SVG. Loading them from a CDN would add a
 * third-party request to the most security-sensitive page in the product.
 */

const PROVIDERS = [
  {
    strategy: "oauth_google" as const,
    label: "Google",
    icon: (
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.19 14.97 0 12 0A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.29 9.14 4.75 12 4.75z"
        />
      </svg>
    ),
  },
  {
    strategy: "oauth_apple" as const,
    label: "Apple",
    icon: (
      <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
        <path d="M17.05 12.54c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.19-1.72-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.87-.76-1.48.02-2.84.86-3.6 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.25 2.74 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.08 2.65-2.14.83-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.5zM14.9 5.6c.6-.74 1.01-1.76.9-2.78-.87.04-1.93.58-2.56 1.31-.56.65-1.05 1.69-.92 2.69.97.07 1.96-.49 2.58-1.22z" />
      </svg>
    ),
  },
  {
    strategy: "oauth_microsoft" as const,
    label: "Microsoft",
    icon: (
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
        <path fill="#F25022" d="M2 2h9.4v9.4H2z" />
        <path fill="#7FBA00" d="M12.6 2H22v9.4h-9.4z" />
        <path fill="#00A4EF" d="M2 12.6h9.4V22H2z" />
        <path fill="#FFB900" d="M12.6 12.6H22V22h-9.4z" />
      </svg>
    ),
  },
  {
    strategy: "oauth_github" as const,
    label: "GitHub",
    icon: (
      <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
        <path d="M12 .3a12 12 0 0 0-3.79 23.4c.6.11.82-.26.82-.58v-2.23c-3.34.72-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.64-5.48 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .3z" />
      </svg>
    ),
  },
];

export function OAuthButtons({
  disabled,
  enabled,
}: {
  disabled?: boolean;
  /**
   * Strategies Clerk reports as enabled, resolved on the server — see
   * `services/auth/providers.ts`. Rendering the full catalogue instead would
   * put buttons on screen that fail on click, which is how the GitHub button
   * came to be broken for every visitor who tried it.
   */
  enabled: readonly string[];
}) {
  const { signIn } = useSignIn();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function authenticate(
    strategy: (typeof PROVIDERS)[number]["strategy"],
  ) {
    setPending(strategy);
    setError("");

    try {
      /**
       * `window.location.origin`, not `env.NEXT_PUBLIC_APP_URL`.
       *
       * Importing `@/lib/env` from a client component pulled the entire Zod
       * schema into the browser bundle — and with it the *names* of every
       * credential Atheos holds, `REPLICATE_API_TOKEN` and `OPENAI_API_KEY`
       * among them. No values: server vars are undefined on the client. But
       * the names alone tell a reader which vendors run the product, which is
       * exactly what the public model contract exists to withhold.
       *
       * The origin is also the more correct answer. This runs in a browser
       * that is already on the site, so it is right on every preview
       * deployment and every custom domain, where a single configured URL
       * would send the user somewhere else to finish signing in.
       */
      const origin = window.location.origin;

      const { error: ssoError } = await signIn.sso({
        strategy,
        redirectUrl: `${origin}/profile`,
        redirectCallbackUrl: `${origin}/sso-callback`,
      });

      if (ssoError) {
        setError(toAuthErrorMessage(ssoError));
        setPending(null);
      }
      // On success the browser navigates away, so there is no success branch.
    } catch (err) {
      setError(toAuthErrorMessage(err));
      setPending(null);
    }
  }

  // Ordered by the catalogue, not by what Clerk happened to return, so the
  // buttons do not reshuffle between renders.
  const available = PROVIDERS.filter((provider) =>
    enabled.includes(provider.strategy),
  );

  if (available.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* One per row below `sm`, and one per row throughout when there are
          three or more — Higgsfield's stacked layout, which reads faster than a
          grid when the labels differ in length. */}
      <div
        className={
          available.length === 2 ? "grid gap-2 sm:grid-cols-2" : "grid gap-2"
        }
      >
        {available.map((provider) => (
          <Button
            key={provider.strategy}
            type="button"
            variant="outline"
            block
            disabled={disabled || pending !== null}
            loading={pending === provider.strategy}
            onClick={() => authenticate(provider.strategy)}
          >
            {pending === provider.strategy ? null : provider.icon}
            {provider.label}
          </Button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3 py-1">
        <div className="rule-fade flex-1" />
        <span className="text-2xs tracking-wider text-muted-foreground uppercase">
          or
        </span>
        <div className="rule-fade flex-1" />
      </div>
    </div>
  );
}
