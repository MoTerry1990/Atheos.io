import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

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
 *
 * ## What used to be here: automatic language negotiation
 *
 * A first-time visitor whose browser preferred Spanish was redirected from `/`
 * to `/es` before anything rendered. It read `Accept-Language` only and never
 * the visitor's country, which was the right call — a Peruvian on an
 * English-configured laptop wants English.
 *
 * It is gone anyway, because **English is the default experience and `/` must
 * render English**. A URL that serves different languages to different people
 * is a URL that cannot be shared, cached at the edge, or reasoned about: the
 * person who sends a colleague a link has no idea what the colleague will see.
 *
 * Spanish is still fully reachable and fully indexed — `/es` and `/es/precios`
 * render server-side, `hreflang` on both pages tells a crawler they are
 * translations of each other, and the footer carries a real link between them
 * that sets a preference cookie when clicked. What is gone is the guessing.
 */
/**
 * The public marketing pages, which Clerk never sees.
 *
 * A `Set` of exact paths rather than a matcher pattern. The first attempt at
 * this used a negative lookahead in `config.matcher` — `(?!$|es$|pricing$|…)`
 * — and it silently did not work: `curl` showed no redirect because Clerk
 * skips non-browser requests, while Lighthouse's Chrome still went through the
 * full 820 ms handshake. The regex looked right, the manual check agreed with
 * it, and both were wrong.
 *
 * Exact-match membership is not clever, and it fails visibly.
 */
const CLERK_FREE_PATHS = new Set([
  "/",
  "/es",
  "/es/precios",
  "/pricing",
  "/privacy",
  "/terms",
  "/acceptable-use",
  "/connect",
]);

/** The pathname header, set on every request whether or not Clerk runs. */
function withPathname(request: NextRequest) {
  // Next.js does not expose the pathname to Server Components. This is the
  // standard way to make it available, and it is what powers the post-sign-in
  // redirect in `lib/auth.ts`.
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);

  return NextResponse.next({ request: { headers } });
}

const withClerk = clerkMiddleware(async (_auth, request) =>
  withPathname(request),
);

export default function middleware(
  request: NextRequest,
  event: NextFetchEvent,
) {
  if (CLERK_FREE_PATHS.has(request.nextUrl.pathname)) {
    return withPathname(request);
  }

  return withClerk(request, event);
}

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
     * - **The public marketing pages** — `/`, `/es`, both pricing pages, the
     *   three legal pages and `/connect`. Added in Sprint 4.2, for the same
     *   reason as the previews and with a measurement behind it.
     *
     *   Lighthouse on the homepage recorded an **850 ms chain of three
     *   redirects** before anything rendered: `/` to
     *   `clerk.accounts.dev/v1/client/handshake`, back to `/?__clerk_handshake=…`,
     *   then to `/`. TTFB was 1.8 s and the SEO audit lost its meta description
     *   somewhere in the bounce. That is Clerk's development-instance handshake,
     *   which fires on every matched request that has no dev-browser cookie —
     *   exactly the behaviour already documented above for the preview routes.
     *
     *   A production Clerk instance does not handshake, so this is partly an
     *   artifact of B9 (the instance is still a development one). Excluding the
     *   pages is right either way: **nothing under `features/marketing` or
     *   `app/(marketing)` calls `auth()`, `currentUser()` or `getUserId()`, and
     *   `ClerkProvider` is not mounted there at all** — so establishing a
     *   session for them was work with no consumer, on the most-visited and
     *   most-cacheable pages on the site.
     *
     *   The consequence, stated plainly: the marketing header cannot know
     *   whether you are signed in, so "Start creating" always points at
     *   `/sign-up?redirect_url=%2Fstudio`. Clerk forwards an existing session
     *   straight through to the studio, so a signed-in visitor still lands in
     *   the right place — they simply pass through a redirect to get there.
     *   Making the header session-aware would mean putting Clerk back on every
     *   marketing request, and this measurement is what that would cost.
     *
     * Excluding them is safe because none reads user data — the rule that
     * matters is in `lib/auth.ts`, not here.
     */
    "/((?!_next|design-system|dashboard-preview|studio-preview|projects-preview|billing-preview|marketplace-preview|community-preview|admin-preview|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
