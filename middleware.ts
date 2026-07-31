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
 * ## What this file still does
 *
 * 1. Establishes the Clerk session so `auth()` and `currentUser()` work in
 *    Server Components. Without `clerkMiddleware`, they throw.
 * 2. Records the pathname on a request header, so `requireUserId()` can send
 *    the user back where they were going after signing in.
 *
 * Neither is a security control, which is the point.
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
    // Everything except Next internals and static files. Running Clerk for a
    // font or an image adds latency to every asset for no benefit.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
