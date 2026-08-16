import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Session context — **not** the authorisation gate.
 *
 * ## Why there is no `auth.protect()` here
 *
 * Clerk 7 deprecated middleware-based route protection, and the reasoning is
 * sound enough that it changed the design of this file:
 *
 * > Middleware-based auth checks rely on path matching, which can diverge from
 * > how Next.js routes requests and leave protected resources reachable.
 *
 * A regex over pathnames is a *model* of the route tree, and models drift.
 * Parallel routes, intercepting routes, route groups and rewrites all resolve
 * in ways a matcher does not see. When the model and the router disagree, the
 * router wins and the resource is served.
 *
 * So protection lives with the resource:
 *
 *   `app/(app)/layout.tsx`   calls `requireUserId()`
 *   Server Actions           call `requireUser()` themselves
 *   Route handlers           call `requireUserId()` themselves
 *
 * A new protected page inherits the layout's check by existing inside it,
 * rather than by someone remembering to add a pattern here.
 *
 * ## Clerk runs on every matched request. All of them.
 *
 * Sprint 4.2 added a `CLERK_FREE_PATHS` set — `/`, `/es`, both pricing pages,
 * the legal pages — which returned early and **never invoked
 * `clerkMiddleware` at all**. The reasoning was that those pages call neither
 * `auth()` nor `currentUser()`, mount no `ClerkProvider`, and were paying an
 * 850 ms development-instance handshake for a session nothing read.
 *
 * Every one of those observations was true. The conclusion was wrong, and it
 * broke authentication.
 *
 * `clerkMiddleware` is not only an authorisation gate. It is the component
 * that **completes the handshake, sets and rotates the session cookie, and
 * keeps the browser's view of the session in step with the server's.** A route
 * can be entirely public and still need that work done on its way through — a
 * signed-in visitor loading the homepage is still a signed-in visitor, and the
 * request that skips Clerk is a request where the session silently goes stale.
 *
 * The symptom was a textbook client/server split: `/sign-in` reported "You are
 * already signed in" — the browser's Clerk state was live — while `/dashboard`
 * and `/studio` bounced back to sign-in, because `getUserId()` on the server
 * found nothing. It reproduced in fresh Incognito windows and across browsers,
 * which is what ruled out stale cookies and pointed at the server.
 *
 * **The rule this file now keeps: "public" describes authorisation, never
 * whether Clerk runs.** Public routes skip `auth.protect()`. Nothing skips
 * `clerkMiddleware`.
 *
 * The handshake cost is real and is the correct trade. It is also mostly an
 * artifact of the instance still being a development one (blocker B9); a
 * production Clerk instance does not handshake on every cold request.
 */

/**
 * Clerk's own query parameters, which must never be copied anywhere.
 *
 * `__clerk_handshake` carries a signed payload of cookies to set. It is a
 * credential, it is large — several kilobytes on a development instance — and
 * it belongs to Clerk's middleware alone.
 */
export const CLERK_PARAMS = [
  "__clerk_handshake",
  "__clerk_handshake_nonce",
  "__clerk_db_jwt",
  "__clerk_status",
  "__clerk_ticket",
];

/**
 * The path to remember for the post-sign-in redirect.
 *
 * ## Why the query string is filtered rather than copied
 *
 * This used to be `pathname + search`, verbatim. On a real OAuth return that
 * meant copying a multi-kilobyte `__clerk_handshake` token into a **request
 * header** — a credential written somewhere it does not belong, on the one
 * request where the header budget is already at its largest.
 *
 * Nothing downstream wants it: `lib/auth.ts` reads this to rebuild the URL
 * somebody was heading for, and "where they were going" is never the
 * handshake callback.
 *
 * Capped at 512 characters. `redirect_url` is a query parameter on a later
 * redirect, and an unbounded value here becomes an unbounded value there.
 *
 * A request for `//evil.com` has the pathname `//evil.com`, which is
 * protocol-relative: as a redirect target a browser reads it as an absolute URL
 * and leaves the site. `lib/auth.ts` already refuses to redirect to one, and
 * that check stays — but the value should not be manufactured here either. An
 * open redirect wants a guard at both ends, because the two are edited by
 * different people for different reasons.
 */
export function destinationFor(request: NextRequest) {
  const url = new URL(request.nextUrl);
  for (const param of CLERK_PARAMS) url.searchParams.delete(param);

  if (url.pathname.startsWith("//")) return "/";

  const search = url.searchParams.toString();
  const path = url.pathname + (search ? `?${search}` : "");

  return path.length > 512 ? url.pathname : path;
}

/**
 * Marks a request that has already been through handshake recovery once.
 *
 * Without it, a handshake that fails every time would be redirected, reissued
 * and failed again — a loop that is worse than the error it replaces.
 */
export const RETRY_MARKER = "__atheos_auth_retry";

const handler = clerkMiddleware(async (_auth, request) => {
  const headers = new Headers(request.headers);
  // Next.js does not expose the pathname to Server Components. This is the
  // standard way to make it available, and it powers the post-sign-in redirect
  // in `lib/auth.ts`.
  headers.set("x-pathname", destinationFor(request));

  return NextResponse.next({ request: { headers } });
});

/**
 * An unresolvable handshake ends as *signed out*, not as a 500.
 *
 * ## The failure this replaces
 *
 * Production returned `MIDDLEWARE_INVOCATION_FAILED` on a real Google sign-in.
 * Reproduced locally, the exception is Clerk's:
 *
 *     Clerk: unable to resolve handshake: SyntaxError: Unexpected end of data
 *       at getCookiesFromHandshake
 *       at resolveHandshake
 *
 * `resolveHandshake` decodes the handshake payload and throws when it cannot.
 * That throw escapes `clerkMiddleware`, and an exception out of Edge
 * middleware is a 500 with no page, no error boundary and no way forward — the
 * visitor is stuck on a URL that fails every time they load it.
 *
 * ## Why this is not a permissive catch
 *
 * It does **not** call `NextResponse.next()` and let the request through. A
 * handshake is the mechanism that *establishes* a session; if it cannot be
 * resolved, no session exists, and the honest representation of that is an
 * unauthenticated visitor at a clean URL.
 *
 * So the recovery redirects to the same path with Clerk's parameters removed.
 * The visitor arrives signed out. Every protected route still runs
 * `requireUserId()` and still sends them to sign-in. Nothing is granted access
 * it would not otherwise have had, and the only state that changes is that a
 * dead end becomes a retry.
 *
 * The marker makes it strictly one attempt. A second failure re-throws, so a
 * persistently broken configuration still surfaces as an error rather than
 * spinning — configuration problems must stay visible.
 */
export default async function middleware(
  request: NextRequest,
  event: Parameters<typeof handler>[1],
) {
  try {
    return await handler(request, event);
  } catch (error) {
    const isHandshakeFailure =
      error instanceof Error && /handshake/i.test(error.message);

    const alreadyRetried = request.nextUrl.searchParams.has(RETRY_MARKER);

    // Anything that is not a handshake failure, and any second attempt, is a
    // genuine fault. Re-throwing keeps it loud.
    if (!isHandshakeFailure || alreadyRetried) throw error;

    const url = new URL(request.nextUrl);
    for (const param of CLERK_PARAMS) url.searchParams.delete(param);
    url.searchParams.set(RETRY_MARKER, "1");

    // 303: the retry is a fresh GET of a different URL, and must not be
    // cached — the next visitor to this path has their own handshake.
    const response = NextResponse.redirect(url, 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

export const config = {
  matcher: [
    /**
     * Clerk's recommended matcher: everything except Next.js internals and
     * static files, plus every API route.
     *
     * The `*-preview` and `design-system` routes are still excluded. Those are
     * internal tooling with no session, and on a development instance the
     * handshake redirect made them unreachable in a browser. A preview whose
     * entire purpose is to render without Clerk must not be gated by Clerk.
     *
     * **The public marketing pages are deliberately *not* excluded**, even
     * though they read no user data. See the note above: skipping Clerk there
     * is what desynchronised the session from the server.
     */
    "/((?!_next|design-system|dashboard-preview|studio-preview|projects-preview|billing-preview|marketplace-preview|community-preview|admin-preview|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
