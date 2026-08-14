import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { provisionUser } from "@/services/users/provision";
import { resolveApiKey } from "@/services/api-keys";
// Prisma 7 names generated model types with a `Model` suffix.
import type { UserModel } from "@/lib/generated/prisma/models";

/**
 * Server-side auth. **This is the authorisation gate**, not a second opinion.
 *
 * Clerk 7 deprecated middleware-based protection because a pathname matcher is
 * a model of the route tree, and models drift — parallel routes, intercepting
 * routes and rewrites all resolve in ways a regex does not see. So the check
 * lives with the resource instead of in `middleware.ts`.
 *
 * The rule for this codebase: **every server function that reads or writes user
 * data calls `requireUser()` or `requireUserId()` itself.** Not "the layout
 * handles it" — layouts do not run for Server Actions or route handlers, which
 * are directly addressable over HTTP.
 */

/** Clerk user id, or null. Cheap — reads the session, no network call. */
export async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

/**
 * Where the user was heading, for the post-sign-in bounce.
 *
 * Reads the header set by `middleware.ts`, since Next does not expose the
 * pathname to Server Components. Returns null rather than throwing when the
 * header is absent — a missing redirect is a small annoyance, an exception is a
 * broken page.
 */
async function currentPath(): Promise<string | null> {
  try {
    const path = (await headers()).get("x-pathname");
    // Only same-origin relative paths. `//evil.com` is protocol-relative and
    // would navigate off-site, so a leading `//` is rejected too.
    if (path && path.startsWith("/") && !path.startsWith("//")) return path;
    return null;
  } catch {
    return null;
  }
}

async function redirectToSignIn(): Promise<never> {
  const path = await currentPath();
  redirect(
    path ? `/sign-in?redirect_url=${encodeURIComponent(path)}` : "/sign-in",
  );
}

/** Clerk user id, or redirect to sign-in preserving the destination. */
export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) await redirectToSignIn();
  return userId as string;
}

/** The full Clerk profile — name, email, avatar. Hits Clerk's API. */
export async function getClerkUser() {
  return currentUser();
}

/**
 * Our database row for the signed-in user.
 *
 * Returns `null` when the user exists in Clerk but not yet in our database — a
 * real race, not a theoretical one: the `user.created` webhook can land *after*
 * the user's first page load. Callers must handle it rather than assuming a row
 * exists the moment a session does.
 */
export async function getCurrentUser(): Promise<UserModel | null> {
  const userId = await getUserId();
  if (!userId) return null;

  return prisma.user.findUnique({ where: { clerkId: userId } });
}

/**
 * Resolve our row for a signed-in Clerk user, creating it if it is missing.
 *
 * ## Why this exists
 *
 * This used to redirect to a holding page, on the reasoning that creating the
 * row here "would race the webhook and risk two rows for one person". The
 * schema had already ruled that out — `clerkId` is unique, and the signup grant
 * is keyed on a unique idempotency key — so what the caution actually bought
 * was a product that silently does nothing when the webhook is misconfigured.
 * It was misconfigured in production for all of Sprint 25, and every sign-up
 * landed on a holding page with no account and no credits.
 *
 * The webhook is still worth having: it is the only thing that observes later
 * profile edits and deletions. It is no longer the only way in.
 *
 * Returns `null` when Clerk has no email for the account, which is the one case
 * we genuinely cannot provision — `email` is unique and not nullable.
 */
async function resolveOrProvision(userId: string): Promise<UserModel | null> {
  const existing = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (existing) return existing;

  // Only reached once per account, so the extra Clerk API call costs nothing
  // in the steady state.
  const clerkUser = await currentUser();
  const email =
    clerkUser?.emailAddresses.find(
      (address) => address.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ?? clerkUser?.emailAddresses[0]?.emailAddress;

  if (!clerkUser || !email) return null;

  return provisionUser({
    clerkId: userId,
    email,
    name:
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      null,
    imageUrl: clerkUser.imageUrl || null,
  });
}

/**
 * Our database row, or redirect.
 *
 * Use in Server Components and Actions that cannot proceed without a user
 * record — anything touching credits, generations or assets.
 */
export async function requireUser(): Promise<UserModel> {
  const userId = await requireUserId();

  const user = await resolveOrProvision(userId);

  // Provisioning only fails when Clerk has no email address on the account.
  // The profile page is where they can add one.
  if (!user) redirect("/profile");

  return user;
}

/**
 * The 401 thrown by `requireApiUser`.
 *
 * Structurally a `DomainError` (`message` / `status` / `code`), so every area's
 * error responder maps it to a 401 without knowing it exists — see
 * `lib/api-response.ts` for why that interface is structural.
 */
export class AuthError extends Error {
  readonly status = 401;
  readonly code = "unauthenticated";

  constructor(message = "You need to be signed in to do that.") {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Our database row, or throw — the route-handler counterpart to `requireUser`.
 *
 * ## Why this replaced six copies
 *
 * `services/projects.ts`, `collections.ts`, `generation.ts`,
 * `billing/checkout.ts`, `community/index.ts` and `marketplace/index.ts` each
 * defined a private `requireApiUser()`. All six were byte-identical apart from
 * the error class they constructed. That is six places to harden the most
 * security-critical check in the codebase, and five of them would be missed.
 *
 * The differing error type turned out not to matter: `errorResponse` matches
 * domain errors structurally, so one `AuthError` produces exactly the same 401
 * through every responder that the six bespoke errors did.
 *
 * ## Why it stays in the service layer rather than moving to the route
 *
 * `lib/api-guard.ts` also resolves the caller, and it would be easy to conclude
 * the service check is now redundant. It is not, and removing it would undo the
 * rule this file exists to state: **protection lives with the resource.** A
 * guard protects the one route it wraps. A service function is reachable from
 * route handlers, Server Actions and other services, and the check must hold
 * for all of them — including the next caller nobody has written yet.
 *
 * The guard is a cheap outer gate that also gives rate limiting a user id to
 * key on. This is the gate that counts.
 */
export async function requireApiUser(): Promise<UserModel> {
  const userId = await getUserId();

  if (!userId) {
    /**
     * No session. Try an API key before giving up.
     *
     * This is what makes every service reachable by a program — the MCP server
     * Claude and ChatGPT talk to, a custom GPT action, somebody's script. None
     * of them has a browser, so none can hold a Clerk cookie.
     *
     * Placed here rather than in each route on purpose: this function is the
     * gate the whole service layer already passes through, so teaching *it*
     * about keys is what makes the next service work programmatically without
     * anybody remembering to wire it up.
     *
     * A key spends its owner's credits exactly as a session would. That is the
     * intent, and the reason `revokeApiKey` exists.
     */
    const header = (await headers()).get("authorization");
    const viaKey = await resolveApiKey(header);
    if (viaKey) return viaKey;

    throw new AuthError();
  }

  // Provisions on first call, same as `requireUser`. Without this the page
  // would render for a webhook-less sign-up and every API call behind it would
  // 401, which is a worse failure than not rendering at all.
  const user = await resolveOrProvision(userId);
  if (!user) {
    throw new AuthError(
      "Your account has no email address. Add one in your profile to continue.",
    );
  }

  return user;
}
