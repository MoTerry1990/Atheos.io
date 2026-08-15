import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

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
export default clerkMiddleware(async (_auth, request) => {
  // Next.js does not expose the pathname to Server Components. This is the
  // standard way to make it available, and it is what powers the post-sign-in
  // redirect in `lib/auth.ts`.
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);

  return NextResponse.next({ request: { headers } });
});

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
