import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import {
  LOCALE_COOKIE,
  localeRedirect,
} from "@/features/marketing/i18n/negotiate";

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
 * 3. Sends a first-time visitor whose browser prefers Spanish to the Spanish
 *    page, before anything renders.
 *
 * Neither of the first two is a security control, which is the point. The third
 * is not either — it is a redirect, and every condition guarding it is in
 * `features/marketing/i18n/negotiate.ts` with the reasoning attached.
 */
export default clerkMiddleware(async (_auth, request) => {
  /**
   * Language negotiation, before Clerk does anything expensive.
   *
   * A **server** redirect rather than a client one: redirecting after hydration
   * means the English page paints, the reader starts to read it, and it is
   * replaced. That is worse than not translating at all.
   *
   * `localeRedirect` returns null for almost everything — an explicit cookie,
   * an already-Spanish path, a non-document request, a page with no Spanish
   * twin — so the common case costs one header read.
   */
  const target = localeRedirect({
    pathname: request.nextUrl.pathname,
    acceptLanguage: request.headers.get("accept-language"),
    cookie: request.cookies.get(LOCALE_COOKIE)?.value,
    fetchDest: request.headers.get("sec-fetch-dest"),
  });

  if (target) {
    const url = request.nextUrl.clone();
    url.pathname = target;
    // Query survives the move. A visitor arriving on a campaign link keeps its
    // parameters, and losing them would break the attribution that paid for
    // the visit.
    //
    // 307 rather than 308: this decision depends on a request header, and a
    // permanent redirect would be cached by the browser and applied to a later
    // visitor on the same machine who prefers English.
    return NextResponse.redirect(url, 307);
  }

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
     * Everything except:
     *
     * - `_next` and static files — running Clerk for a font or an image adds
     *   latency to every asset for no benefit.
     * - `design-system` and the `*-preview` routes — internal tooling with no
     *   session. This exclusion is not cosmetic: on a development instance
     *   Clerk performs a handshake **redirect** on every matched request, which
     *   made both routes unreachable in a browser. A preview whose entire
     *   purpose is to render without Clerk must not be gated by Clerk.
     *
     * Excluding them is safe because neither reads user data — the rule that
     * matters is in `lib/auth.ts`, not here.
     */
    "/((?!_next|design-system|dashboard-preview|studio-preview|projects-preview|billing-preview|marketplace-preview|community-preview|admin-preview|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
