import "server-only";

import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import { getCurrentUser, getUserId } from "@/lib/auth";
import { isAdmin } from "@/services/admin/auth";
import type { UserModel } from "@/lib/generated/prisma/models";
import { invalidInput, malformedBody } from "@/lib/api-response";
import {
  POLICIES,
  type PolicyName,
  checkRateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { bearerApiKey, callerKey, verifyCsrf } from "@/lib/request-identity";
import { resolveApiKey } from "@/services/api-keys";

/**
 * The gate every route handler passes through.
 *
 * ## What it does, and the order it does it in
 *
 * The order is the design. Each step is cheaper than the one after it, and each
 * rejects a class of caller that the next step would otherwise have to serve:
 *
 *   1. **CSRF** — pure header inspection, no I/O. A cross-origin mutation is
 *      refused before we spend anything on it.
 *   2. **Session id** — `getUserId()` reads the Clerk session token. No network
 *      call, no database query.
 *   3. **Rate limit** — keyed on that id, or the IP when anonymous.
 *   4. **User row** — `getCurrentUser()` is the first database read, and it only
 *      happens for callers who have already passed the three checks above.
 *   5. **Input validation** — body and query, against Zod.
 *
 * Step 3 before step 4 is the point. If rate limiting came after the user
 * lookup, a flood would still cost one database round trip per request, and the
 * limiter would be protecting the expensive work while being the expensive
 * work. Clerk's session read is local, so the limit can be enforced before
 * anything touches Postgres.
 *
 * ## It does not replace service-layer authorisation
 *
 * `services/*` still calls `requireApiUser()` itself, and must. This guard
 * protects exactly the route that calls it; a service function is reachable
 * from route handlers, Server Actions and other services. See the long note on
 * `requireApiUser` in `lib/auth.ts`.
 *
 * Treat this as the outer gate that makes abuse expensive, and the service
 * check as the one that decides whether the caller may have the data.
 */

export interface GuardContext<TBody, TQuery> {
  /** Our database row. Non-null only when `auth: "required"`. */
  user: UserModel | null;
  /** Clerk id. Present whenever there is a session, even before the row exists. */
  sessionId: string | null;
  /**
   * True when `user` was resolved from an `Authorization: Bearer` API key
   * rather than a browser session.
   *
   * The permission scope is identical either way — a key acts as its owner —
   * so no handler should branch on this to decide *what* a caller may do. It is
   * here so a handler can log which door a request came through.
   */
  viaApiKey: boolean;
  body: TBody;
  query: TQuery;
  /** `RateLimit-*` headers, for handlers that want to echo them on success. */
  headers: HeadersInit;
}

export interface GuardOptions<TBody, TQuery> {
  /** Which limit applies. Every route names one — there is no unlimited path. */
  policy: PolicyName;
  /**
   * `required` resolves the user row and 401s without one.
   * `optional` resolves it when a session exists — for public reads that show
   *   viewer-specific state such as "you liked this".
   * `none` never looks. For webhooks, which authenticate by signature.
   */
  auth?: "required" | "optional" | "none";
  /**
   * Defaults to on for anything that is not GET or HEAD.
   *
   * Set false only where the caller cannot send an `Origin` and authenticates
   * some other way — webhooks, which verify a signature over the raw body.
   */
  csrf?: boolean;
  /**
   * Admin-only. Answers **404** to everyone else, before any input is parsed.
   *
   * Both halves matter. 404 rather than 401/403 is § 38 — a 401 confirms the
   * endpoint exists, which is the first thing an attacker wants to know. And
   * *before parsing* is why this is an option here rather than left to the
   * service: validation runs inside the guard, so a non-admin posting a
   * malformed body to an admin route would otherwise get a 400 while a
   * non-admin posting a well-formed one got a 404. Two different answers is
   * the same disclosure the 404 rule exists to prevent.
   *
   * `requireAdmin()` still runs inside every admin service function. This is
   * the outer gate; that is the one that decides.
   */
  admin?: boolean;
  body?: ZodType<TBody>;
  query?: ZodType<TQuery>;
  /** Names the route in server logs. */
  context?: string;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Run the gate.
 *
 * Returns a `NextResponse` when the request must be refused, or a context when
 * it may proceed. Call sites do:
 *
 * ```ts
 * const gate = await guard(request, { policy: "mutation", body: schema });
 * if (gate instanceof NextResponse) return gate;
 * ```
 */
export async function guard<TBody = undefined, TQuery = undefined>(
  request: Request,
  options: GuardOptions<TBody, TQuery>,
): Promise<GuardContext<TBody, TQuery> | NextResponse> {
  const method = request.method.toUpperCase();
  const authMode = options.auth ?? "required";

  /**
   * Does the caller present a bearer key? Pure header inspection, no I/O.
   *
   * Answered here, before anything is spent, because it changes two later
   * decisions: whether CSRF applies, and which rate-limit bucket this request
   * lands in. Resolving the key properly is a database read and stays where the
   * other database reads are.
   */
  const bearer = authMode === "none" ? null : bearerApiKey(request);

  /**
   * CSRF does not apply to a bearer key.
   *
   * The attack it defends against is a browser attaching an *ambient*
   * credential to a request some other site caused. A cookie is ambient; an
   * `Authorization` header is not — a cross-origin page cannot set one on a
   * request the browser sends for it, and a non-browser client has no cookie to
   * be tricked out of. Requiring an `Origin` from a server-to-server caller is
   * what made the whole API-key feature unreachable.
   *
   * A malformed or revoked key skips CSRF and then fails authentication a few
   * lines below, which costs nothing: CSRF only ever protected the session, and
   * a caller presenting a bearer token is not using one.
   */
  const checkCsrf = (options.csrf ?? !SAFE_METHODS.has(method)) && !bearer;

  // 1. Cross-origin ------------------------------------------------------
  if (checkCsrf) {
    const verdict = verifyCsrf(request);
    if (!verdict.ok) {
      console.warn(
        `csrf refused: ${method} ${options.context ?? request.url} — ${verdict.reason}`,
      );
      // 403 rather than 400: the request was well-formed, it is not permitted.
      return NextResponse.json(
        { error: "This request was refused.", code: "csrf" },
        { status: 403 },
      );
    }
  }

  // 2. Session id — local, no I/O ----------------------------------------
  let sessionId: string | null = null;
  if (authMode !== "none") {
    sessionId = await getUserId();
  }

  // 3. Rate limit ---------------------------------------------------------
  const policy = POLICIES[options.policy];
  const result = await checkRateLimit(policy, callerKey(request, sessionId));
  const headers = rateLimitHeaders(result);

  if (!result.ok) {
    console.warn(
      `rate limit: ${policy.name} exhausted by ${callerKey(request, sessionId)}`,
    );
    return NextResponse.json(
      {
        error: "Too many requests. Give it a moment and try again.",
        code: "rate_limited",
      },
      { status: 429, headers },
    );
  }

  // 4. User row — the first database read --------------------------------
  let user: UserModel | null = null;
  let viaApiKey = false;

  if (authMode !== "none") {
    if (sessionId) {
      user = await getCurrentUser();
    } else if (bearer) {
      /**
       * The session is absent, so try the key — the same fallback
       * `requireApiUser()` has always performed, finally reachable.
       *
       * `resolveApiKey` does the hash lookup, refuses a revoked key and
       * compares in constant time. It returns the key's **owner**, so
       * everything downstream — the credit ledger, the plan tier, the spend
       * ceiling — attributes the work to that user exactly as a session would.
       */
      user = await resolveApiKey(bearer);
      viaApiKey = user !== null;

      /**
       * Adopt the owner's Clerk id as the session id.
       *
       * Every consumer of `sessionId` means "which principal is this", and a
       * key acts as its owner. Leaving it null would make an API-key request
       * look anonymous to anything that attributes work by Clerk id, which is
       * precisely the drift requirement 2 forbids.
       */
      if (user) sessionId = user.clerkId;
    }
  }

  if (authMode === "required" && !user) {
    return NextResponse.json(
      {
        error: "You need to be signed in to do that.",
        code: "unauthenticated",
      },
      { status: 401, headers },
    );
  }

  // 5. Admin — before any input is read, so the answer cannot vary ---------
  if (options.admin && !(await isAdmin())) {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers });
  }

  // 6. Input --------------------------------------------------------------
  let query = undefined as TQuery;
  if (options.query) {
    const raw = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = options.query.safeParse(raw);
    if (!parsed.success) {
      return invalidInput("Those search parameters are not valid.", [
        ...parsed.error.issues,
      ]);
    }
    query = parsed.data;
  }

  let body = undefined as TBody;
  if (options.body) {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return malformedBody();
    }

    const parsed = options.body.safeParse(payload);
    if (!parsed.success) {
      return invalidInput("Those details are not valid.", [
        ...parsed.error.issues,
      ]);
    }
    body = parsed.data;
  }

  return { user, sessionId, viaApiKey, body, query, headers };
}

/**
 * Attach rate-limit headers to a successful response.
 *
 * Worth doing on endpoints a client polls or retries — the studio backs off on
 * `RateLimit-Remaining` rather than discovering the limit by hitting it.
 */
export function withHeaders(
  response: NextResponse,
  context: { headers: HeadersInit },
): NextResponse {
  for (const [key, value] of Object.entries(context.headers)) {
    response.headers.set(key, String(value));
  }
  return response;
}
