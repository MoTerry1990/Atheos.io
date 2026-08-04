# Security Audit — Sprint 25

**Scope:** Phase 6. Authentication, authorization, API routes, rate limiting,
validation, secrets, cookies, headers, CSRF, XSS, CORS.
**Score: 86 / 100**, up from 84 at Sprint 15 — the gain is the preview-route
guard closed this sprint.

This audit supersedes `SECURITY_REPORT.md` (Sprint 15) where they differ.

---

## Summary

| Area              | Score  | Verdict                                                                           |
| ----------------- | ------ | --------------------------------------------------------------------------------- |
| Authentication    | 90     | Clerk 7, custom flows, no home-grown session handling                             |
| Authorization     | 95     | Lives with the resource; admin root of trust is an env var, not a database column |
| API routes        | 92     | One gate, 36 route files, deliberate check ordering                               |
| Rate limiting     | 70     | Comprehensive policies; **in-memory and per-process**                             |
| Validation        | 95     | Zod on body and query through one gate; multipart validated harder than JSON      |
| Secrets           | 88     | Typed env layer, server/client split enforced by the type system                  |
| Cookies           | 95     | The app sets none — Clerk owns them entirely                                      |
| Headers           | 85     | Enforcing CSP, HSTS preload, full set; `'unsafe-inline'` remains                  |
| CSRF              | 95     | `Sec-Fetch-Site` then `Origin`, **refuses requests carrying neither**             |
| XSS               | 90     | React escaping, one audited `dangerouslySetInnerHTML`, no `eval`                  |
| CORS              | 95     | None configured — same-origin only, which is correct                              |
| **Observability** | **10** | **`console.error`. Nothing can be seen.**                                         |

---

## Authentication

Clerk 7 with custom flows: sign-in, sign-up, OTP, reset, OAuth. No hand-rolled
session, token or password handling anywhere — the highest-risk code in a
typical product is absent by delegation.

**Verified over real HTTP:** every authenticated endpoint returns 401 to an
anonymous caller. The full admin surface returns **404, not 401**, regardless of
method, query shape or body — a 401 confirms an endpoint exists and is worth
attacking.

`CLERK_WEBHOOK_SIGNING_SECRET` fails **closed**: the receiver returns 503 naming
the variable rather than accepting unsigned events.

**Gap:** nothing has ever authenticated. No MFA and no account deletion.

---

## Authorization

Three properties worth naming because each is a class of bug that cannot occur:

1. **Authorisation lives with the resource, not a middleware matcher.** A
   matcher is a list someone forgets to update; a check beside the query cannot
   be forgotten by adding a route.
2. **Every per-user query is scoped by `userId` in its `where`.** Mutations use
   `updateMany` scoped by owner, so a wrong id affects **zero rows** rather than
   someone else's.
3. **The admin root of trust is `ADMIN_USER_IDS`, an environment variable**,
   checked independently of `User.role`. A database compromise alone cannot
   escalate to admin, and changing the list requires a deploy.

Sprint 15 collapsed six byte-identical `requireApiUser()` copies into one, so
the check is written once.

---

## API routes

36 route files behind a single `apiGuard`. **The order of checks is the design:**

```
CSRF → session id → rate limit → user row (first DB read) → admin → input validation
```

Admin authorisation runs **before input parsing**. Sprint 15 introduced the
opposite order and it leaked: a malformed body returned 400 and a well-formed
one 404 — two different answers is exactly the disclosure the 404 rule exists to
prevent. It was caught and fixed, and this ordering is why it cannot recur.

---

## Rate limiting

Eight named policies, from `generate` at 12/min to `read` at 300/min, covering
every handler. Verified live: request 21 of 25 to a 20/min endpoint returned 429
with `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset` and
`retry-after`.

**The limiter is in-memory and per-process.** Behind N Vercel instances the
effective limit is N× the configured one, and a serverless cold start resets it.
`RateLimitStore` exists precisely so Redis is one implementation and no call-site
changes. **On Vercel this is a real weakness, not a theoretical one** — the
platform scales horizontally by default, so the limit that protects the provider
bill is the limit least likely to hold.

Same applies to `HealthStore`: a dead provider is rediscovered once per
instance instead of once.

---

## Validation

Zod on body and query through the same gate. `/uploads` takes multipart rather
than JSON and is validated **more** strictly than any JSON route: length, size
checked **before the buffer is allocated**, declared type, and magic bytes that
must agree with the declared type.

---

## Secrets

`lib/env.ts` is the single validated entry point; nothing reads `process.env`
directly. The server/client split is enforced by the type system — a secret in
the `server` block **cannot** be imported into a client component, so a Stripe
key cannot be inlined into a bundle by accident.

Sprint 14 removed `SUPABASE_SERVICE_ROLE_KEY`: a credential that bypasses
row-level security entirely, required by nothing, that every deployment would
have carried.

**Verified today:** `.env.local` is git-ignored; `.env.example` (a template, no
secrets) is now tracked deliberately.

---

## Cookies

**The application sets no cookies.** Session cookies are Clerk's entirely, with
its own `HttpOnly`, `Secure` and `SameSite` handling. There is no home-grown
cookie to get wrong — worth stating explicitly, since a hand-rolled session
cookie is one of the most common findings in a review like this.

---

## Headers

```
Content-Security-Policy         enforcing (not Report-Only)
Strict-Transport-Security       max-age=63072000; includeSubDomains; preload
X-Content-Type-Options          nosniff
X-Frame-Options                 DENY
Referrer-Policy                 strict-origin-when-cross-origin
Permissions-Policy              camera=(), microphone=(), geolocation=(), interest-cohort=()
```

CSP is tight where it matters: `frame-ancestors 'none'`, `object-src 'none'`,
`base-uri 'none'` (not `'self'` — `'self'` still permits an injected
`<base href="/evil/">` to repoint every relative URL), `form-action` limited to
self plus Stripe's hosted pages.

**`'unsafe-inline'` remains in `script-src`.** Removing it needs per-request
nonces generated in middleware, and a nonce forces every page dynamic — which
would opt the landing page out of static rendering. A named trade-off, not an
oversight.

---

## CSRF

`Sec-Fetch-Site` first, `Origin` as fallback, and — the part most
implementations miss — **a request carrying neither is refused**, not waved
through.

| Request                       | Result                                       |
| ----------------------------- | -------------------------------------------- |
| `Origin: evil.com`            | 403                                          |
| `Sec-Fetch-Site: cross-site`  | 403                                          |
| neither header present        | 403                                          |
| `Sec-Fetch-Site: same-origin` | 401 — passes CSRF, correctly stopped by auth |

CSRF is **off** on the two webhooks, and that is correct: a webhook sender is
not a browser and sends no `Origin`. They authenticate by signature over the raw
body, which is stronger, and they carry the tightest rate limits in the app.

---

## XSS

React escapes by default. One `dangerouslySetInnerHTML` in the entire codebase —
`structured-data.tsx`, serialising a JSON-LD graph the application constructs
itself from typed values, with no user input in the object. Audited and
appropriate.

**No `eval`, no `new Function`** anywhere in `app/`, `lib/`, `services/` or
`features/`.

---

## CORS

**No `Access-Control-Allow-*` header is set anywhere.** The API is same-origin
only, which is the correct posture for a first-party application with no public
API. Nothing to tighten; the risk here is a future change loosening it.

---

## Fixed this sprint

### Preview routes no longer ship to production — **High, closed**

`/admin-preview` rendered the complete admin interface with the authorisation
gate bypassed. The data was fixtures so nothing leaked, but it published the
design of every internal tool to anyone with the URL — on a product whose admin
surface otherwise answers 404 _specifically so its existence does not leak_.

Open since Sprint 14 and filed High three times. The only control was
`metadata.robots`, and `noindex` asks a crawler not to list a page — it does not
stop a person opening it.

Now `notFound()` unless `ENABLE_DEV_PREVIEWS=1`. **Verified over HTTP:** all
four sampled preview routes return 404 in a production build; product routes are
unaffected. 104 E2E tests still pass because the harness opts in explicitly.

---

## Open issues

| #   | Issue                                                                                                                                                                             | Severity |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **No error tracking or structured logging.** 30 `console.error` sites. Every 403, 429 and webhook 500 goes somewhere nobody reads — there is no way to see an attack in progress. | **High** |
| 2   | **Rate limiter and health store are per-process.** On Vercel's horizontal scaling this is a live weakness, not theoretical.                                                       | **High** |
| 3   | **No content moderation.** Arbitrary generated imagery publishes to a public, indexable gallery with no scanning and no takedown path. Legal and platform-safety exposure.        | **High** |
| 4   | **No account deletion or data export.** Cascade rules are correct; nothing triggers them. GDPR erasure and portability unimplemented.                                             | **High** |
| 5   | **No legal pages** — no terms, privacy policy or acceptable-use policy.                                                                                                           | **High** |
| 6   | `'unsafe-inline'` in `script-src`.                                                                                                                                                | High     |
| 7   | **R2 objects are protected only by unguessable keys** and never expire on the public path. The download route checks ownership; the direct URL does not.                          | Medium   |
| 8   | **DNS-rebinding SSRF is open** — a public hostname resolving to a private address passes `isDeliverableUrl`. Closing it needs resolution-time checking.                           | Medium   |
| 9   | **Webhook secrets are optional in the env schema.** Both fail closed at runtime, which is the important half; a deploy can still start without them.                              | Medium   |
| 10  | **15 of 31 `findMany` calls unbounded.** Rate limiting bounds how often they are asked for, not how much each returns.                                                            | Medium   |
| 11  | **No dependency scanning in CI**, because there is no CI. `npm audit` is clean today — manually.                                                                                  | Medium   |
| 12  | **A cancelled job is not cancelled at the provider.** We stop tracking it and keep paying.                                                                                        | Medium   |

Items 3, 4 and 5 are not code quality issues — they are **launch blockers for a
public product** independent of whether the code works. A service that generates
arbitrary imagery and publishes it to an indexable gallery cannot open to
strangers without automated scanning, a takedown path, and a privacy policy.
