import "server-only";

import { createHash } from "node:crypto";

import { env } from "@/lib/env";
import { API_KEY_PREFIX } from "@/services/api-keys/prefix";

/**
 * Who is making this request, for rate limiting and for cross-origin defence.
 *
 * Both answers come from headers an attacker partly controls, so both are
 * written to be wrong in the safe direction.
 */

/**
 * The client IP.
 *
 * ## `x-forwarded-for` is only trustworthy behind a proxy that overwrites it
 *
 * Any client can send this header. It is meaningful **only** because the
 * hosting platform (Vercel, Cloudflare, a correctly configured nginx) replaces
 * it with the real peer address before our code runs. Deployed anywhere that
 * does not do that, this value is attacker-chosen and IP-keyed limits become
 * decorative.
 *
 * That is why the first entry is used, not the last: the platform appends, so
 * with a trusted proxy the leftmost is the origin client. It is also why every
 * limit that can be keyed by user id is keyed by user id instead — see
 * `callerKey`.
 *
 * `x-real-ip` is checked first where present because platforms that set it set
 * exactly one value and it is not a list.
 */
export function clientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  // No proxy header at all — local development, or a misconfigured deployment.
  // A single shared bucket is the safe failure: it over-limits rather than
  // under-limits, and it is visible immediately in development.
  return "unknown";
}

/**
 * The rate-limit key for a caller.
 *
 * **User id wins whenever there is one.** An authenticated caller has already
 * proven who they are, so the key cannot be spoofed, cannot be shared with
 * strangers behind the same NAT, and survives an IP change mid-session. IP is
 * the fallback for anonymous traffic, where nothing better exists.
 */
export function callerKey(request: Request, userId: string | null): string {
  if (userId) return `u:${userId}`;

  /**
   * A bearer key gets its own bucket, keyed on a hash of the token.
   *
   * Without this every API-key caller behind one NAT would share an IP bucket
   * and throttle each other. Keying on the *user* would be better still, but
   * that needs a database read and the rate limit deliberately runs before the
   * first one — so the token's own hash is the closest identity available for
   * free. Truncated because this is a bucket name, not a credential check.
   */
  const bearer = bearerApiKey(request);
  if (bearer) {
    return `k:${createHash("sha256").update(bearer).digest("hex").slice(0, 24)}`;
  }

  return `ip:${clientIp(request)}`;
}

/**
 * The API key on this request, if the header even looks like one.
 *
 * Pure string inspection — no database, no crypto beyond a prefix test. That is
 * what lets `guard()` decide about CSRF and rate-limit keying before it has
 * spent anything, and still resolve the key properly afterwards.
 *
 * Returns the raw token, not a verdict. A malformed or revoked key returns a
 * token here and fails authentication later, which is the correct split: this
 * answers "is the caller *presenting* a key", not "is the key good".
 */
export function bearerApiKey(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;

  const token = header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : header.trim();

  return token.startsWith(`${API_KEY_PREFIX}_`) ? token : null;
}

/**
 * Origins permitted to make state-changing requests.
 *
 * Only our own. There is no third-party embed, no partner site, and no public
 * API with browser callers — so anything else making a credentialed POST to us
 * is doing it on a user's behalf without their intent, which is the definition
 * of the attack.
 */
function allowedOrigins(): Set<string> {
  const origins = new Set<string>([env.NEXT_PUBLIC_APP_URL]);

  // Vercel injects the deployment URL, which differs from the canonical one on
  // preview branches. Without it every mutation on a preview deploy fails CSRF.
  const vercel = process.env.VERCEL_URL;
  if (vercel) origins.add(`https://${vercel}`);

  return origins;
}

export type CsrfVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Cross-origin request forgery check for state-changing requests.
 *
 * ## Why an origin check rather than a token
 *
 * A synchroniser token is the textbook answer, and it is the wrong shape here.
 * Every mutation in this app is `fetch` with `Content-Type: application/json`
 * from our own first-party JavaScript. A token would mean threading a value
 * through a codebase that has no forms posting to itself, to defend a case that
 * `Origin` already covers — browsers have sent `Origin` on cross-origin
 * requests for years, and they do not let scripts forge it.
 *
 * ## `Sec-Fetch-Site` first
 *
 * Where the browser sends it, it is a direct statement of the relationship
 * between the initiator and us, and it cannot be set by script at all. It is
 * checked first and trusted when present.
 *
 * ## Missing `Origin` is refused, not waved through
 *
 * A same-origin `fetch` always carries one. Something with no `Origin` and no
 * `Sec-Fetch-Site` is a non-browser client — curl, a script, a server. Those
 * are exactly the callers a CSRF check has no opinion about *and* exactly the
 * callers with no legitimate reason to hold a user's session cookie. Refusing
 * costs nothing real and closes the "old browser" gap.
 *
 * Note this defends the **cookie-carrying** case only. It is not a substitute
 * for authorisation, which happens separately and always.
 */
export function verifyCsrf(request: Request): CsrfVerdict {
  const site = request.headers.get("sec-fetch-site");

  if (site) {
    // `none` is a direct navigation (typed URL, bookmark). A state-changing
    // request cannot arrive that way from our own UI.
    if (site === "same-origin") return { ok: true };
    return { ok: false, reason: `sec-fetch-site: ${site}` };
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return { ok: false, reason: "no origin and no sec-fetch-site" };
  }

  if (allowedOrigins().has(origin)) return { ok: true };

  return { ok: false, reason: `origin not allowed: ${origin}` };
}
