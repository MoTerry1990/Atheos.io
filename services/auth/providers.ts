import "server-only";

import { env } from "@/lib/env";

/**
 * Which social sign-in buttons to render.
 *
 * ## Why this is fetched rather than written down
 *
 * The list used to be a constant with Google and GitHub in it. Only Google was
 * ever enabled in the Clerk instance, so **the GitHub button had been failing
 * for every visitor who clicked it** — a dead end on the most important page in
 * the product, invisible because nobody clicks their own sign-in buttons.
 *
 * A hard-coded list is a claim about a *remote configuration*, and it goes
 * stale in the direction that breaks things. Clerk publishes what is actually
 * enabled, so this asks.
 *
 * The consequence worth knowing: turning on Apple, Microsoft or GitHub in the
 * Clerk dashboard makes the button appear here with **no code change and no
 * deploy** — at most one revalidation. Turning one off removes it just as
 * quietly, which is the behaviour you want when a provider's certificate
 * expires at two in the morning.
 *
 * ## Failure returns email-only
 *
 * If Clerk cannot be reached, there are no social buttons and the email form
 * still works. The alternative — rendering every button we know about — offers
 * somebody a route that is currently broken, which is worse than offering one
 * fewer route.
 */

/** Providers we have an icon and a label for, in the order they should appear. */
export const KNOWN_PROVIDERS = [
  "oauth_google",
  "oauth_apple",
  "oauth_microsoft",
  "oauth_github",
] as const;

export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

/**
 * Clerk's Frontend API host, decoded from the publishable key.
 *
 * The key is `pk_test_<base64 of "host$">`. Decoding it avoids a second
 * environment variable that could disagree with the first — there is exactly
 * one Clerk instance, and the key already names it.
 */
function frontendApiHost(): string | null {
  const key = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const encoded = key.replace(/^pk_(test|live)_/, "");

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const host = decoded.replace(/\$$/, "").trim();
    return host || null;
  } catch {
    return null;
  }
}

export async function enabledOAuthProviders(): Promise<KnownProvider[]> {
  const host = frontendApiHost();
  if (!host) return [];

  try {
    const response = await fetch(
      `https://${host}/v1/environment?__clerk_api_version=2025-04-10&_clerk_js_version=5`,
      {
        // An hour. Enabling a provider is a deliberate act in a dashboard, and
        // waiting up to an hour for the button is a fair trade against asking
        // Clerk on every render of the sign-in page.
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) return [];

    const body = (await response.json()) as {
      user_settings?: { social?: Record<string, { enabled?: boolean }> };
    };

    const social = body.user_settings?.social ?? {};

    // Filtered against KNOWN_PROVIDERS rather than returned wholesale: Clerk
    // supports dozens, and one we have no icon for would render as a blank
    // button.
    return KNOWN_PROVIDERS.filter((id) => social[id]?.enabled === true);
  } catch {
    return [];
  }
}
