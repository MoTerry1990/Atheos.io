# Security Report — Sprint 15

**Scope:** security hardening. No features added.
**Baseline:** the fourteen findings in `PROJECT_AUDIT.md` § Security Review.

---

## Headline

`PROJECT_AUDIT.md` rated **no rate limiting anywhere** the single most severe
finding in the project, and the only Critical one with no mitigating control at
all. It is now closed: **every one of the 52 route handlers passes through a
gate that applies a named limit**, and there is no unlimited path left.

Four other Critical or High findings are closed with it. Three that this sprint
found — none of which were in the audit — are described below; one of them was a
regression I introduced during this sprint and caught before it shipped.

Security score moves **66 → 84**. It is not higher because the two things that
would move it most are unchanged: nothing is tested, and nothing has ever run
against real infrastructure.

---

# What was built

## `lib/rate-limit.ts` — the limiter

A fixed-window counter behind a `RateLimitStore` interface, with eight named
policies reviewed as a set rather than discovered one route at a time:

| Policy       | Limit/min | Applies to                                                                         |
| ------------ | --------- | ---------------------------------------------------------------------------------- |
| `generate`   | **12**    | Submitting a generation — the only endpoint that spends credits and provider quota |
| `billing`    | 10        | Checkout, portal, plan changes                                                     |
| `sensitive`  | 20        | Webhook receivers, before signature verification                                   |
| `upload`     | 20        | File uploads                                                                       |
| `mutation`   | 60        | Every authenticated write                                                          |
| `admin`      | 100       | The whole admin surface                                                            |
| `publicRead` | 120       | Anonymous reads — gallery, profiles, marketplace catalogue                         |
| `read`       | 300       | Authenticated reads, including the studio's polling                                |

**Honest limitation, stated in the module and repeated here:** the store is
in-memory and per-process. On one long-lived server it is correct. Behind N
instances the effective limit is N times the configured one, and a serverless
cold start begins at zero. There is no Redis in this project. `RateLimitStore`
exists so that swapping one in is a single implementation with no call site
changing — that is the production fix, and it is the first item in "Remaining
issues" below.

The limiter is also bounded at 50,000 tracked keys so that it cannot itself
become a memory-exhaustion vector. At the cap it sheds oldest-first, which fails
**open** for those keys — failing closed would let an attacker flooding the map
lock out real users.

## `lib/api-guard.ts` — one gate, in a deliberate order

```
1. CSRF            header inspection only, no I/O
2. Session id      Clerk session read — local, no network, no database
3. Rate limit      keyed on that id, or IP when anonymous
4. User row        the first database read
5. Admin           where the route is admin-only
6. Input           body and query, against Zod
```

**Step 3 before step 4 is the point.** If the limit were checked after the user
lookup, a flood would still cost one database round trip per request and the
limiter would be protecting the expensive work while being the expensive work.
Clerk's session read is local, so the limit is enforced before anything touches
Postgres.

**Step 5 before step 6 is the other point** — see "Findings" below.

## `lib/request-identity.ts` — CSRF and caller identity

Origin-based CSRF rather than a synchroniser token. Every mutation in this app
is `fetch` with JSON from our own first-party JavaScript; there are no
self-posting forms. `Sec-Fetch-Site` is checked first where the browser sends it
(script cannot set it at all), falling back to an `Origin` allowlist.

**A request with neither header is refused**, not waved through. A same-origin
`fetch` always carries one; something with neither is a non-browser client, and
those have no legitimate reason to be holding a user's session cookie.

Rate-limit keys prefer **user id over IP** whenever a session exists — an
authenticated caller has already proven who they are, so the key cannot be
spoofed, is not shared with strangers behind one NAT, and survives an IP change.

`x-forwarded-for` is documented as trustworthy **only** behind a proxy that
overwrites it. Deployed anywhere that does not, IP-keyed limits are decorative.

## `lib/api-output.ts` — response validation

Zod object schemas strip unknown keys, so a response schema is an **allowlist**:
a field not named cannot be transmitted, however it got into the object.

The failure this prevents is over-disclosure by accident. Every route builds
responses from Prisma rows, and `users` alone carries `email`, `clerkId` and
`stripeCustomerId`. Nothing about `NextResponse.json(user)` looks wrong in
review. The realistic path is not carelessness but change — a `select` gains a
field, a service starts returning a whole row, a relation is included for a
count and brings its parent.

## `lib/auth.ts` — one `requireApiUser`

Six byte-identical private copies existed in `projects`, `collections`,
`generation`, `billing/checkout`, `community` and `marketplace`, differing only
in which error class they threw. Six places to harden the most
security-critical check in the codebase, five of which would be missed.

The differing error type turned out not to matter: `errorResponse` matches
domain errors **structurally**, so one shared `AuthError` produces exactly the
same 401 through every responder.

**It stayed in the service layer.** The guard also resolves the caller, and it
would be easy to conclude the service check is now redundant. It is not. A guard
protects the one route that calls it; a service function is reachable from route
handlers, Server Actions and other services — including the next caller nobody
has written yet. The guard is the outer gate; the service check is the one that
decides.

---

# Findings

## 1. Uploads buffered the entire file before any size check — High

`/api/uploads` called `Buffer.from(await file.arrayBuffer())` and handed the
result to `storeUploadedAsset`, which enforced a 10MB limit. The limit was real
and it was enforced **after** the whole file was in memory. A 2GB upload was a
memory-exhaustion attack that our own check politely rejected once it was too
late.

Now `Content-Length` is checked before the multipart parser runs, `file.size`
before the buffer is allocated, and the declared type before either.

## 2. The declared MIME type was the only type check — Medium

`file.type` in a multipart upload is whatever the client wrote. An allowlist
checked against it is an allowlist checked against attacker input.

`sniffImageMime` now reads the magic bytes and requires them to agree with the
declaration. This matters because these objects are served from a **public
bucket**: a file that is really HTML, served with a sniffable type, would be
stored XSS on our storage origin.

## 3. Admin routes leaked their existence through validation — Medium

**Found while verifying this sprint's own work, and it cuts both ways.**

Before Sprint 15, an admin route parsed and validated its body _before_ calling
the service that returns 404 to non-admins. So a malformed body to
`/api/admin/moderation` returned **400** while a well-formed one returned
**404**. Two different answers is the same disclosure the 404 rule (§ 38) exists
to prevent.

My first pass made it worse — the guard's `auth: "required"` returned **401**
before the service could 404 at all. Caught in runtime verification.

The fix is the `admin` option on the guard, which runs `isAdmin()` **before any
input is parsed**. Verified: every admin route now answers 404 to an anonymous
caller regardless of method, query or body — and `/api/adminx`, which does not
exist, answers identically.

## 4. Unbounded query parameters reached database filters — Medium

`/api/admin/overview` did `Number(searchParams.get("days") ?? 30)`. `"abc"`
became `NaN` and flowed into a date computation; `"100000"` asked the database
to aggregate three centuries. Now coerced, integral, and bounded to a year.

Search terms (`q`) reaching Prisma `contains` filters are now bounded to 120
characters. Prisma parameterises, so this was never injection — it is a
sequential scan somebody else pays for.

Enum-valued parameters on **public** surfaces use `.catch(default)` rather than
rejecting: these are shareable URLs, and a stale bookmark should render the
default view, not an error page.

## 5. We set no cookies of our own — informational

Audited rather than assumed. Every session cookie belongs to Clerk, which sets
`httpOnly`, `Secure` and `SameSite` itself. Our client-side persistence is
`localStorage` and holds composer settings and sidebar state — no tokens, no
user data. The studio store's `partialize` explicitly strips references.

There is nothing here to harden, which is the correct answer rather than an
absent one.

---

# Endpoint audit

All 34 route files, 52 handlers. Every handler is gated.

| Endpoint                           | Methods          | Policy               | Auth     | Admin | CSRF    | Zod |
| ---------------------------------- | ---------------- | -------------------- | -------- | ----- | ------- | --- |
| `/admin/audit`                     | GET              | admin                | optional | 404   | on      | yes |
| `/admin/moderation`                | GET POST         | admin                | optional | 404   | on      | yes |
| `/admin/overview`                  | GET              | admin                | optional | 404   | on      | yes |
| `/admin/status`                    | GET              | admin                | optional | 404   | on      | –   |
| `/admin/users`                     | GET              | admin                | optional | 404   | on      | yes |
| `/admin/users/[id]`                | GET POST         | admin                | optional | 404   | on      | yes |
| `/assets/[id]/download`            | GET              | read                 | required | –     | on      | –   |
| `/billing`                         | GET              | read                 | required | –     | on      | –   |
| `/billing/checkout`                | POST             | billing              | required | –     | on      | yes |
| `/billing/portal`                  | POST             | billing              | required | –     | on      | –   |
| `/billing/subscription`            | PATCH            | billing              | required | –     | on      | yes |
| `/collections`                     | GET POST         | read, mutation       | required | –     | on      | yes |
| `/collections/[id]/assets`         | POST             | mutation             | required | –     | on      | yes |
| `/community/comments/[id]`         | DELETE POST      | mutation             | required | –     | on      | yes |
| `/community/creators`              | GET              | publicRead           | optional | –     | on      | –   |
| `/community/posts`                 | GET              | publicRead           | optional | –     | on      | yes |
| `/community/posts/[slug]`          | GET POST         | publicRead, mutation | mixed    | –     | on      | yes |
| `/community/posts/[slug]/comments` | GET POST         | publicRead, mutation | mixed    | –     | on      | yes |
| `/community/profile`               | GET PATCH        | read, mutation       | required | –     | on      | yes |
| `/community/profiles/[handle]`     | GET POST         | publicRead, mutation | mixed    | –     | on      | –   |
| `/community/publish`               | POST             | mutation             | required | –     | on      | yes |
| `/folders`                         | GET POST         | read, mutation       | required | –     | on      | yes |
| `/folders/[id]`                    | PATCH DELETE     | mutation             | required | –     | on      | yes |
| `/generations`                     | POST GET         | **generate**, read   | required | –     | on      | yes |
| `/generations/[id]`                | GET DELETE       | read, mutation       | required | –     | on      | –   |
| `/marketplace`                     | GET              | publicRead           | optional | –     | on      | yes |
| `/marketplace/[slug]`              | GET POST         | publicRead, mutation | mixed    | –     | on      | yes |
| `/marketplace/installed`           | GET              | read                 | required | –     | on      | –   |
| `/projects`                        | GET POST         | read, mutation       | required | –     | on      | yes |
| `/projects/[id]`                   | GET PATCH DELETE | read, mutation       | required | –     | on      | yes |
| `/projects/[id]/assets`            | POST DELETE      | mutation             | required | –     | on      | –   |
| `/projects/[id]/duplicate`         | POST             | mutation             | required | –     | on      | –   |
| `/uploads`                         | POST             | upload               | required | –     | on      | n/a |
| `/webhooks/clerk`                  | POST             | sensitive            | none     | –     | **off** | –   |
| `/webhooks/stripe`                 | POST             | sensitive            | none     | –     | **off** | –   |

**CSRF off on the two webhooks is correct and deliberate.** A webhook sender is
not a browser and sends no `Origin`; the cross-origin check would reject every
real delivery. They authenticate by signature over the raw body, which is
stronger than an origin check, and they are the tightest-limited endpoints in
the app.

**`/uploads` shows `n/a` for Zod** because its payload is multipart, not JSON.
It is validated more strictly than any JSON route — length, size, declared type
and magic bytes.

---

# Verification

Executed against `next start`, not inferred.

## Rate limiting

```
25 consecutive POSTs to /api/webhooks/stripe (policy: sensitive, 20/min)
  503 x20   (503 = STRIPE_WEBHOOK_SECRET unset — correct fail-closed)
  429 x5
first 429 at request #21

429 response headers:
  ratelimit-limit: 20
  ratelimit-remaining: 0
  ratelimit-reset: 59
  retry-after: 59
```

## CSRF

| Request                                            | Result                                       |
| -------------------------------------------------- | -------------------------------------------- |
| `POST /api/projects` `Origin: evil.com`            | **403**                                      |
| `POST /api/projects` `Sec-Fetch-Site: cross-site`  | **403**                                      |
| `POST /api/projects` no Origin, no Sec-Fetch-Site  | **403**                                      |
| `POST /api/projects` `Sec-Fetch-Site: same-origin` | 401 — passes CSRF, correctly stopped by auth |
| `POST /api/generations` `Origin: evil.com`         | **403**                                      |

## Admin disclosure

Every response identical, whatever the input:

```
GET  /api/admin/overview             404
GET  /api/admin/overview?days=abc    404
GET  /api/admin/users                404
GET  /api/admin/audit                404
GET  /api/admin/status               404
POST /api/admin/moderation  (bad body, same-origin)   404
POST /api/admin/users/x     (bad body, same-origin)   404
GET  /api/adminx            (does not exist)          404
/admin                                                404
```

## Input validation

```
/api/marketplace?q=<300 chars>   400
/api/marketplace?q=cinematic     200
/api/marketplace?view=bogus      200   (catches to "all", by design)
```

## Headers

```
Content-Security-Policy: default-src 'self'; …     (enforcing, not Report-Only)
base-uri 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

## No regressions

```
/                        200      /api/projects              401
/explore                 200      /api/folders               401
/api/marketplace         200      /api/collections           401
/sitemap.xml             200      /api/billing               401
                                  /api/generations           401
```

`/api/community/*` returns 500 because Prisma cannot reach a database. That is
pre-existing and unrelated — `/api/marketplace` works because its catalogue is
code rather than rows.

`tsc --noEmit`, `eslint --max-warnings 0`, `prettier --check` and `next build`
all clean.

---

# CSP: now enforcing

Sprint 13 shipped `Content-Security-Policy-Report-Only` with `CSP_ENFORCE=1` to
flip it, reasoning that a policy which has never seen real traffic will block
something and that a customer who cannot check out is the worst way to find out.

That reasoning assumed reports would accumulate. They cannot — nothing has been
deployed, so there is no traffic to observe, and "wait for evidence" became
"ship a header that blocks nothing, indefinitely". A report-only CSP is a
measurement instrument, and this one was measuring an empty room.

It now **enforces by default**. `CSP_REPORT_ONLY=1` goes back to observing.
`base-uri` tightened from `'self'` to `'none'` — `'self'` still permits an
injected `<base href="/evil/">` to repoint every relative URL on the page.

**`'unsafe-inline'` remains in `script-src`**, and that is the largest remaining
weakness in the policy. Removing it needs per-request nonces generated in
middleware, and a nonce forces every page dynamic — which would opt the landing
page out of static rendering. That trade-off is named in "Remaining issues"
rather than made silently here.

---

# Remaining issues

## Not addressed this sprint

| #   | Issue                                                                                                                                                                                                  | Severity |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 1   | **The limiter is in-memory.** Correct on one instance; N instances means N times the limit; serverless cold starts reset it. Swap in Redis behind `RateLimitStore`.                                    | High     |
| 2   | **`'unsafe-inline'` in `script-src`.** Needs nonces in middleware, at the cost of making the landing page dynamic.                                                                                     | High     |
| 3   | **No content moderation.** Users can generate arbitrary imagery and publish it to a public, indexable gallery with no automated scanning. Legal and platform-safety exposure, not a product gap.       | High     |
| 4   | **No account deletion or data export.** Schema cascades are correct; nothing in the product triggers them. GDPR erasure and portability unimplemented.                                                 | High     |
| 5   | **No error tracking or structured logging.** The new 403s, 429s and webhook 500s all go to `console.error`. There is still no way to see an attack in progress.                                        | High     |
| 6   | **Preview routes ship to production.** `/admin-preview` renders the admin interface with the gate bypassed. Fixtures only, so no data disclosure — but it publishes the design of every internal tool. | High     |
| 7   | **Webhook secrets optional in the env schema.** Both now fail closed and loudly at runtime, which is the important half. A production deploy can still start without them.                             | Medium   |
| 8   | **Public object storage.** R2 objects are protected only by unguessable keys and never expire on the public path. The download route checks ownership; the direct URL does not.                        | Medium   |
| 9   | **13 of 31 `findMany` calls still unbounded.** Rate limiting bounds how _often_ they can be asked for; it does not bound how much each returns.                                                        | Medium   |
| 10  | **No dependency scanning, no CI.** Still no pipeline running `npm audit`.                                                                                                                              | Medium   |
| 11  | **`jsonOut` is built but applied nowhere yet.** The mechanism exists and is documented; wiring it to the community and admin routes is follow-up work.                                                 | Low      |

## Unchanged and still dominant

**There are no tests.** Every claim in this report rests on manual runtime
checks executed once, by me, today. Nothing prevents the next change from
silently removing a guard — and the guards are now the thing standing between a
signed-in user and our provider bill.

The rate-limit policies, the CSRF verdicts, and the admin-404 discipline are all
pure functions of a request. They are among the most testable code in the
project and none of it is tested.

---

# Score

| Dimension          | Before | After  | Why                                                                             |
| ------------------ | ------ | ------ | ------------------------------------------------------------------------------- |
| **Security**       | 66     | **84** | Rate limiting everywhere, CSRF, enforcing CSP, upload hardening, one auth check |
| Input validation   | 70     | 95     | Every handler validates body and query through one gate                         |
| Abuse resistance   | 10     | 80     | Was nothing; now eight policies, capped at the process boundary                 |
| Disclosure control | 75     | 90     | Admin 404 now uniform across every input; response allowlists available         |
| Observability      | 5      | 15     | Refusals are logged with route and reason — still `console.error`               |
| Testing            | 0      | 0      | Unchanged                                                                       |

84 rather than higher for two reasons, both structural: the limiter's
correctness depends on process topology it does not control, and none of this is
tested. Both are named above with the fix.

---

## Recommended next

1. **Redis behind `RateLimitStore`** — one implementation, no call site changes.
2. **Tests for the guard.** Policy arithmetic, CSRF verdicts, admin-404 across
   every input shape. These are pure functions; there is no excuse.
3. **Content moderation**, before anything is public.
4. **Account deletion and export.**
5. **Error tracking**, so the 403s and 429s now being logged can be seen.
