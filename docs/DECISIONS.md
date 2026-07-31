# Architectural decisions

Every decision made in Sprint 0, with the reasoning and the trade-off accepted.
Written down because the expensive part of a foundation is not making these
choices — it is re-litigating them in six months with nobody remembering why.

Format: **decision → why → what it costs us**.

---

## 1. Next.js 15 App Router, not 16, not Pages Router

**Decision.** Next.js 15.5 with the App Router. Pinned explicitly.

**Why.** The App Router's Server Components are the right default for this
product: generation history, asset libraries and credit balances are all server
state, and rendering them on the server means no client cache to invalidate and
no API layer to write. Streaming and Suspense also map cleanly onto AI work,
which is slow and arrives in pieces.

Version 16 was current when this was scaffolded — `create-next-app@latest`
installed it — and was deliberately rolled back to 15. Two reasons: 15 was the
specified target, and the ecosystem around it (shadcn/ui, Clerk, UploadThing) has
had a full release cycle to stabilise against it.

**What it costs.** `eslint-config-next@15` ships legacy eslintrc configs with no
exports map, so `eslint.config.mjs` needs the `FlatCompat` shim. That is the only
visible tax, and it disappears on upgrade. Worth knowing: 16 pins the _same_
`postcss@8.4.31`, so staying on 15 costs nothing on the security side.

---

## 2. Clerk owns identity; Supabase is just PostgreSQL

**Decision.** Clerk for authentication. Supabase for managed Postgres (and,
later, Realtime). **Not** Supabase Auth. **Not** NextAuth.

**Why.** Authentication is a solved problem that is expensive to solve badly, and
the surface a paying user judges within thirty seconds. Clerk ships production
sign-in, MFA, session management and organisations as finished product rather
than as primitives. NextAuth would mean assembling all of it; Supabase Auth would
mean building the entire UI.

**What it costs.** Two vendors where one might have done, and — more importantly
— **Supabase row-level security cannot see our users**. Sessions are Clerk's, so
the database has no idea who the caller is.

The consequence is a rule, not a workaround: **all data access goes through
Prisma on the server, and authorisation is enforced in our own service layer.**
Do not reach for the anon key and RLS as a shortcut. It will not know who is
asking. `lib/supabase.ts` says this at the point of use, because this is the
single easiest thing to get wrong in this codebase.

---

## 3. Prisma with a driver adapter, and two connection strings

**Decision.** Prisma 7 as the ORM, connecting through `@prisma/adapter-pg`.
`DATABASE_URL` (pooled, port 6543) at runtime; `DIRECT_URL` (session, port 5432)
for migrations, configured in `prisma.config.ts`.

**Why.** Serverless functions open and discard connections far faster than
Postgres can absorb, so runtime traffic must go through Supabase's transaction
pooler. Migrations cannot: the pooler will not run DDL and cannot hold the
advisory locks Prisma Migrate depends on.

Prisma 7 made this split explicit by removing connection URLs from the schema
entirely. That is an improvement — the old single `url` field described a
situation that was never actually true.

**What it costs.** Two variables to configure instead of one, and a real trap for
anyone who assumes they are interchangeable. Running migrations through the
pooler works in development and deadlocks in production, so both `.env.example`
and `prisma.config.ts` spell out the distinction.

---

## 4. UploadThing and Cloudflare R2 — two storage systems, on purpose

**Decision.** UploadThing for inbound user uploads. R2 for generated output.

**Why.** They are not competing choices; they solve different halves of the
problem.

_Inbound_ means a browser, a progress bar, presigned URLs, MIME validation, and
size limits — plumbing that is tedious to write and easy to write insecurely.
UploadThing is that plumbing, type-safe and finished.

_Outbound_ is different. Generated media is written server-side, where there is
no browser and none of that matters, and the dominant cost is **egress**. A
platform whose product is generated video pays more to deliver bytes than to
store them: on S3, one 50MB video viewed a thousand times costs more in bandwidth
than a month of storage. R2 charges nothing for egress. That removes the largest
and least predictable line in the hosting bill, and removes the perverse
incentive to make the product stingier about letting people watch their own work.

**What it costs.** Two storage systems to reason about, two sets of credentials.
The `Asset.source` column (`GENERATED` | `UPLOADED`) records which path a file
came in through, so this never has to be inferred.

R2 is S3-compatible and used through the AWS SDK, so the exit door stays open:
moving to S3, B2 or MinIO is an endpoint change, not a rewrite.

---

## 5. Credits are an append-only ledger

**Decision.** `credit_transactions` is insert-only. `User.creditBalance` is a
cached sum, written in the same transaction as the entry that changed it.

**Why.** A mutable integer answers "how many credits do they have" and nothing
else. It cannot answer "why is this number wrong", "did we double-charge this
generation", or "what should we refund" — and all three of those are support
tickets that will arrive. Concurrent updates to a single balance column also lose
writes under load, which is exactly when it hurts most.

Every entry carries `balanceAfter`, so a statement renders without replaying
history, and an optional unique `idempotencyKey`, so a retried webhook is rejected
by the database rather than by application logic that someone forgets to write.

**What it costs.** A row per transaction and the discipline of never issuing a
bare `UPDATE` on the balance. A correction is a new row with the opposite sign,
never an edit.

---

## 6. Stripe and Clerk are sources of truth; our tables are mirrors

**Decision.** `subscriptions` and `users` mirror external systems, reconciled by
webhook. When they disagree, the external system is right.

**Why.** Two systems that both believe they own billing state will diverge, and
the divergence is discovered by a customer who was charged for something they
cannot access. Naming the owner up front makes every conflict trivially
resolvable.

**What it costs.** Webhook reliability becomes load-bearing. Hence
`webhook_events`, keyed on the provider's event id: insert first, let the unique
constraint reject duplicates. Both Stripe and Clerk retry and can deliver out of
order, and this is the only approach that survives both.

---

## 7. Configuration is validated once, at build time

**Decision.** `lib/env.ts` validates every variable with Zod. `next.config.ts`
imports it, so a misconfigured deployment fails `next build`. Nothing else in the
codebase reads `process.env`.

**Why.** The alternative failure mode is `undefined` reaching an SDK constructor
and surfacing three layers away as an unauthenticated request at 3am. Failing at
build time turns that into a named variable in a build log.

It also enforces the server/client split in the type system: a secret declared in
the `server` block cannot be imported into a client component. The build breaks
instead of quietly inlining a Stripe key into a bundle served to every visitor.

**What it costs.** New variables must be added in three places — the schema,
`.env.example`, and the deployment environment. `SKIP_ENV_VALIDATION` exists for
Docker builds and CI lint jobs, and must never be set anywhere that serves
traffic.

**One deliberate exception.** `prisma.config.ts` reads raw environment variables,
because the Prisma CLI runs outside the Next.js build and cannot import the
validated module. It is commented as such.

---

## 8. Tailwind v4, CSS-first, with a token indirection layer

**Decision.** No `tailwind.config.js`. All tokens in `styles/globals.css`, in
three layers: raw scales → semantic roles per theme → roles exposed as utilities.

**Why.** v4's `@theme` makes CSS the source of truth, which removes the constant
drift between a JS config and the stylesheet. The three-layer structure is the
part that matters: components reference **roles** (`bg-surface`,
`text-muted-foreground`), never raw scales (`bg-neutral-800`). That indirection is
the only reason a theme can be changed without touching a single component.

Colours are in `oklch` so that equal numeric steps look like equal steps.
Perceptual uniformity is the difference between a palette that feels designed and
one that has a muddy patch in the middle.

**What it costs.** A layer of indirection to learn, and the discipline not to
reach for a raw scale when a role does not exist yet. The right move then is to
add the role.

---

## 9. Dark mode is class-based and defaults to dark

**Decision.** `next-themes` with `attribute="class"`, `defaultTheme="dark"`,
system detection on.

**Why.** Media-query-only theming cannot honour a user who wants the app darker
than their OS, and that choice has to survive a reload. Dark is the default
because generated imagery reads better against a dark surround and this is a tool
people sit in for hours.

Dark surfaces get **lighter** as they rise, inverting the light theme. Copying
light-mode elevation into dark mode is precisely what makes dark themes look
muddy.

**What it costs.** `suppressHydrationWarning` on `<html>` — the theme class is
written before React hydrates, so the markup legitimately differs on that one
element. Scoped there and nowhere else.

---

## 10. The provider seam is defined before any provider exists

**Decision.** `services/ai/types.ts` defines the full adapter contract in Sprint
0, with no implementations.

**Why.** The product's entire value proposition is many vendors behind one
interface, so this seam _is_ the product. Defining it first means the data model,
the credit ledger and the job pipeline are all built against a stable shape
rather than against whichever vendor we happen to integrate first — which is how
a "multi-provider platform" ends up permanently shaped like its first provider.

Generation is modelled as **submit-then-poll**, not a single awaited call. Image
models take seconds and video models take minutes; no serverless function holds a
request open that long. One shape across all three modalities stops the pipeline
forking per media type.

Errors are normalised onto `ProviderError` with an explicit `retryable` flag,
because retry policy and credit refunds both hang off that single bit.

**What it costs.** Adapters must translate rather than pass through, and the
`providerOptions` escape hatch needs policing. If the same field appears there for
three providers, it belongs in the interface.

**The rule.** Nothing outside `services/ai` may import a vendor SDK or branch on
which provider is in use. If a feature knows who it is talking to, the
abstraction has failed.

---

## 11. Zustand for client state only

**Decision.** Zustand in `store/`, restricted to ephemeral UI state.

**Why.** With Server Components, server state lives in the React tree. Copying it
into a client store creates a second source of truth that is stale the moment
anything changes. The store is for what is open, what is selected, what the user
prefers about the chrome — nothing that could be read from the database.

TanStack Query is deliberately **not** installed yet. It earns its place in Sprint
2, when there are generation jobs to poll. Before that it is a cache with nothing
to cache.

**What it costs.** A boundary that has to be defended in review, since a store is
always the easiest place to put something.

---

## 12. Deferred deliberately

Named so they read as decisions rather than omissions.

| Deferred                            | Why                                                                                                                                                      | Lands in |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `ClerkProvider` and auth middleware | Sprint 0 must build without live Clerk credentials. Wiring a provider that throws on every request is a worse foundation than one honest gap.            | Sprint 1 |
| Content-Security-Policy             | Clerk, Stripe and each AI provider need their own allowances. A CSP written before those are known is either theatre or breaks checkout.                 | Sprint 7 |
| TanStack Query                      | Nothing to poll yet.                                                                                                                                     | Sprint 2 |
| Rate limiting                       | Needs a real traffic shape to tune against.                                                                                                              | Sprint 7 |
| Test suite                          | Deliberate: there is no behaviour to test in Sprint 0, and tests over scaffolding calcify it. Arrives with the first business logic — the credit ledger. | Sprint 2 |

---

## 13. Authorisation lives with the resource, not in middleware

**Decision.** `middleware.ts` establishes the Clerk session and records the
pathname. It does **not** protect routes. Every protected surface calls
`requireUserId()` or `requireUser()` itself.

**Why.** This was going to be the opposite — a `createRouteMatcher` deny-list in
middleware — until Clerk 7 emitted a deprecation explaining why that is unsafe:

> Middleware-based auth checks rely on path matching, which can diverge from how
> Next.js routes requests and leave protected resources reachable.

A pathname regex is a _model_ of the route tree. Parallel routes, intercepting
routes, route groups and rewrites all resolve in ways the model does not see, and
when the model and the router disagree the router wins — serving the resource.

The resource-based version cannot drift: a new page inside `app/(app)/` inherits
the layout's check by existing there, not by someone remembering to add a
pattern.

**What it costs.** The check must be repeated in Server Actions and route
handlers, because layouts do not run for either and both are directly
addressable over HTTP. That repetition is the price of the guarantee, and it is
stated as a rule in `lib/auth.ts` and `CLAUDE.md`.

A secondary finding: `auth.protect()` in middleware returned **404** rather than
redirecting, because middleware cannot resolve a sign-in URL. Silent 404s on
protected pages would have looked like a routing bug for a long time.

---

## 14. Custom auth screens on Clerk's signals API

**Decision.** Sign-in, sign-up, verification, forgot-password and reset are built
from `useSignIn`/`useSignUp` and our own components, rather than Clerk's
prebuilt `<SignIn>` / `<SignUp>`.

**Why.** The brief asked for these as distinct screens, and auth is where a user
decides whether to trust the product with a password — a visible seam between
"our product" and "a vendor's widget" is worst exactly there.

Clerk still does everything that matters. Passwords go straight to
`signIn.password()` and are verified server-side; we never see, store or
transmit them ourselves.

**Two things about Clerk 7 that are easy to get wrong**, both now load-bearing in
this codebase:

1. **Errors are returned, not thrown.** `const { error } = await
signIn.password(...)`. A `try/catch` alone catches nothing, and the form
   silently does nothing on a wrong password.
2. **`finalize()` establishes the session**, replacing `setActive`. Navigating
   before it resolves lands the user on a protected route with no session, which
   bounces them straight back to sign-in.

**What it costs.** MFA and enterprise SSO are not wired. Both are supported by
the same API, but each is a flow with its own screens, and building them
speculatively would be guessing at requirements. Accounts with MFA get an
explicit "not wired up yet" message rather than a silent failure — the flows
check `status` and refuse to treat a non-`complete` result as success.

---

## 15. Notification preferences in Clerk metadata, for now

**Decision.** Stored in Clerk's `unsafeMetadata`, not in our `users` table.

**Why.** The name is alarming and worth decoding: `unsafeMetadata` means
_user-writable from the browser_, as opposed to `publicMetadata`, which only a
backend can set. That is exactly right for preferences — the user is the
authority on whether they want an email — and exactly wrong for anything that
grants access or costs money. A credit balance in `unsafeMetadata` would be
editable from the devtools console.

**What it costs.** Long term these belong in our database, so the service that
_sends_ an email does not have to call Clerk to find out whether it may. It is
not there yet because there is no email service to gate, and adding a column to
store a preference nothing reads is speculative. The migration is a webhook away.

Values are merged over defaults on read, never trusted as-is — user-writable
metadata can contain anything.

---

## 16. Account enumeration: different answers on different screens

**Decision.** The sign-in form says "no account found with that email". The
forgot-password form does not — it shows the success state either way.

**Why.** These look inconsistent and are not. Sign-in already reveals account
existence through the password check itself, so withholding it there costs
usability for no security gain. Password reset has no such leak to begin with, so
saying "no account" would _introduce_ one: an oracle for testing an address list,
useful for credential stuffing and targeted phishing.

**What it costs.** A user who mistypes their address on the reset form gets no
feedback and simply never receives the email — the same experience as mistyping
into an address that happens to exist. That is the intended trade.
