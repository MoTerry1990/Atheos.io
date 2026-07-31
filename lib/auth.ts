import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
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
 * Our database row, or redirect.
 *
 * Use in Server Components and Actions that cannot proceed without a user
 * record — anything touching credits, generations or assets.
 */
export async function requireUser(): Promise<UserModel> {
  const userId = await requireUserId();

  const user = await prisma.user.findUnique({ where: { clerkId: userId } });

  if (!user) {
    // The webhook has not landed yet. A holding page is honest; creating the
    // row here would race the webhook and risk two rows for one person.
    redirect("/profile");
  }

  return user;
}
