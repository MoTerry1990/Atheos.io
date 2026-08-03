# Architectural decisions

Every load-bearing decision, with the reasoning and the trade-off accepted.
Written down because the expensive part of a foundation is not making these
choices — it is re-litigating them in six months with nobody remembering why.

§§ 1–13 are Sprint 0, 14–16 Sprint 3, 17–21 Sprint 7, 22–25 Sprint 8, 26–29
Sprint 9, 30–32 Sprint 10, 33–36 Sprint 11, 37–40 Sprint 12, 41–45 Sprint 13,
46–48 Sprint 14, 49–51 Sprint 15. Appended to, never rewritten: a decision that
turned out badly is worth more as a record than as a gap.

**§ 4 and § 2 were partly reversed in Sprint 14.** They are left standing —
§ 46 records what actually happened and why.

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

---

## 17. Video durations are a list, not a maximum

**Decision.** `ModelCapabilities.durations` is `readonly number[]` — the exact
clip lengths a model accepts. The UI renders it as buttons.

**Why.** Video models do not take a range. A model that produces 5- or
10-second clips, handed 7, rounds silently to one of them. A slider from 1 to 10
would therefore be an interface that lies at eight of its eleven positions: the
user chooses 7, is charged for 7, and receives something else. Buttons can only
express what the model can actually do.

The server snaps too, in `resolveDuration`. The request schema's `max(30)` stops
the obvious abuse but cannot know what a particular model offers, and a client
is not something to take arithmetic from.

**What it costs.** A model with genuinely continuous duration would have to
enumerate its options or gain a second field. No provider we have looked at is
in that position, and inventing the field before one is would be guessing.

---

## 18. One pricing function, imported by both sides

**Decision.** `services/ai/pricing.ts` is not `server-only`. The composer's
estimate and the server's debit call the same `creditsFor`.

**Why.** The estimate and the invoice disagreeing is the most damaging class of
bug a credits product can ship — worse than being wrong, because the user was
told a number and then charged a different one. Two implementations of the same
arithmetic will eventually differ; one cannot.

Video prices as a multiple of the shortest declared clip, rounded up. Cost is
compute time, so linear is close to true, and rounding up means we absorb the
error rather than bill it.

**What it costs.** The pricing rules ship to the browser. They are not a secret
— the credit cost is on every model in the picker — so there is nothing to
protect. A discount or promotional rule that _is_ sensitive would have to be
applied server-side on top of this, not inside it.

---

## 19. The operation is derived from the composer, not chosen by the user

**Decision.** No mode switch. `operationFor(model, params)` reads the model's
modality and whether a reference is attached, and returns one of
text-to-image, image-to-image, text-to-video or image-to-video.

**Why.** The obvious design — a tab bar of operations — asks the user to state
something the interface already knows, and then lets the two disagree. Picking
"text to image" with a video model selected is a state that has to be handled,
and every way of handling it is worse than not being able to reach it.

Capability wins over intent: a model declaring only `text-to-video` gets
`text-to-video` even with a reference attached. That would be a silent surprise,
so the composer says so — `operationNote` returns a sentence, and the summary
line names the operation on every state change.

**What it costs.** An operation reachable only by an explicit choice cannot be
expressed. Upscale, background removal and variations are exactly that, which is
why they live beside a finished result instead — they take an existing image,
so the only place to start them is next to one.

---

## 20. Downloads redirect to a presigned URL rather than proxying

**Decision.** `GET /api/assets/[id]/download` checks ownership and 302s to an R2
presigned GET carrying `ResponseContentDisposition: attachment`.

**Why.** Three approaches, two of them wrong:

A plain link to the public URL does not download. The `download` attribute is
ignored cross-origin, so the browser navigates — playing the video, or replacing
the app with the image.

Fetching as a blob works but requires CORS on the bucket and pulls a 50MB clip
through the page's memory to hand it straight to the disk.

Streaming through the route works and costs us execution time and memory to move
bytes R2 will serve for free — defeating the reason for choosing a zero-egress
bucket (§ R2).

The redirect gets the filename, the attachment behaviour and the direct
delivery. The ownership check is not what keeps an object private — the public
URL is unguessable, not secret — it stops the route becoming a signing oracle
for any asset id someone can enumerate.

**What it costs.** Fifteen-minute signatures are shareable for fifteen minutes.
Short enough not to be worth passing around, long enough to survive a slow start
on a large file.

---

## 21. Polling resumes on mount

**Decision.** The studio bootstrap splits the server's generations by status,
puts unfinished ones back in the queue, and re-attaches a poller to each.

**Why.** Polling is what _advances_ a generation in this architecture — each GET
asks the provider, stores the outputs and settles the credits. A job nobody is
polling is genuinely stuck, not merely unobserved. With images the exposure was
a few seconds; a video clip takes minutes, so the tab that started one being
closed, reloaded or navigated away from before it lands is the normal case.

`track` is separate from `generate` and idempotent, keyed by generation id, so
re-attaching cannot open a second loop against the same job — doubling the
request rate on a long job is the cheapest way to be rate-limited by our own
provider.

**What it costs.** It narrows the window; it does not close it. A user who never
comes back still leaves a job stranded and their credits unrefunded. The real
fix is a scheduled reconciler that settles anything RUNNING past a threshold,
and it is still queued with the operational work.

---

## 22. Folders are flat

**Decision.** A folder holds projects. It does not hold other folders.

**Why.** Nesting is one nullable `parentId` away and adding it later is a
migration with no data loss. Shipping it now would cost cycle detection on every
move, recursive counts, breadcrumbs and a tree control with drag targets — a
week of work to support a depth most people's project lists never reach.

The rule this follows throughout the codebase: build the shape the data actually
takes, and leave the door open. Speculative structure is the expensive kind of
wrong, because it is load-bearing before anyone has confirmed it is needed.

**What it costs.** Someone with sixty projects and a real hierarchy in mind
cannot express it, and will use naming conventions instead. If that turns into a
support pattern, the migration is `parentId String?` plus a cycle check in
`updateFolder`.

**Deleting a folder never deletes its projects.** That is `onDelete: SetNull` in
the schema, not a check in application code — a rule enforced only in a service
is one `psql` session away from being broken.

---

## 23. Archive and delete are different actions, and both are honest

**Decision.** Archive sets `archivedAt` and hides the project from every view
but "Archived". Delete removes the row permanently. Deleting a project **never**
deletes the generations inside it.

**Why.** Most "delete" presses mean "get this out of my way". Soft-deleting
everything and calling it deletion is the usual answer, and it produces a
product where nothing is ever really gone and users stop believing the word.
Having a real archive is what earns the right to make delete mean delete.

The membership rows cascade; the assets do not. This is the single most
destructive mistake this schema could have allowed, so the confirmation dialog
says the count out loud — "your 5 generations are kept" — rather than relying on
the user to infer it from a noun.

**What it costs.** A deleted project is not recoverable. Accepted because
archive is one menu item away in the same menu, and the dialog points at it.

---

## 24. Autosave, with a state machine and a flush on unmount

**Decision.** Project metadata saves itself 700ms after the last keystroke.
There is no Save button. `useAutosave` owns a five-state machine — idle, dirty,
saving, saved, error — and `SaveIndicator` always shows which one is true.

**Why.** The naive version is a `setTimeout` in a component, and it loses work
three ways: unmounting mid-debounce drops the edit silently, two saves in flight
can land out of order and leave the older value in the database, and a "Saved"
tick rendered on keystroke claims durability that has not happened.

So: `flush()` runs on unmount, a save that starts while one is running sets a
save-again flag instead of racing, a failed save keeps its value pending for the
next attempt, and `saved` is only reached after the request resolves.

The editing fields are also deliberately **not** re-seeded from server
responses. A refetch landing mid-sentence and replacing text under the cursor is
the classic autosaving-form bug.

**What it costs.** A request per pause in typing, and a user who loses their
connection sees "Could not save — retrying" rather than being blocked. That is
the honest failure mode, but it is quieter than a button that refuses to submit.

---

## 25. The projects client is injectable

**Decision.** Components read their API through `ProjectsApiContext`, whose
default value is the real module.

**Why.** Every sprint here has hit the same wall: no database, no Clerk, so a
page that fetches cannot be looked at. Sprint 7's studio preview could seed a
Zustand store; a component calling `fetch` directly offers no such seam, and
"typechecks" is not "verified".

One context with the real client as its default changes nothing in production
and nothing at any call site. `/projects-preview` wraps the same components in
an in-memory implementation, and rename, duplicate, archive, move, search,
folder deletion and autosave all become things that can be clicked. That is how
the folder-count contradiction described in the Sprint 8 notes was found — the
delete dialog promised to unfile two projects and the result reported three.

**What it costs.** One indirection between a component and its data. Worth it
twice over: it is also the shape a test suite will want.

**The fixture reproduces the server's rules**, including unique names, the
copy-name generator and archived-excluded-everywhere. A preview more permissive
than the server teaches the wrong thing about the product.

---

## 26. Nothing is granted on redirect — only on a webhook

**Decision.** `services/billing/checkout.ts` starts payments and grants nothing.
Every credit and every plan change happens in `app/api/webhooks/stripe`, after
Stripe confirms money moved.

**Why.** Reaching the success page is not evidence of payment. The user can
abandon a 3-D Secure challenge after the redirect, a card can be declined
asynchronously, and `/settings/billing?checkout=success` is a URL anyone can
type. Granting on redirect is how a product gives itself away — quietly, to
whoever notices first.

The cost is a visible delay: the balance updates a second or two after the user
returns. So the screen says so and refetches, rather than showing an optimistic
number that might be wrong.

**Idempotency is a database constraint, not a check.** Stripe retries for up to
three days on any non-2xx and can redeliver on success. Two layers guard it: the
`webhook_events` row is inserted _before_ processing, so a duplicate delivery
returns 200 without re-running; and each grant carries a unique key derived from
the Stripe object (`invoice:{id}`, `pack:{sessionId}`), so the same invoice
cannot pay out twice even across two event types. A `P2002` on that key is
treated as success — returning an error would make Stripe retry forever against
a constraint that will never stop rejecting it.

**On failure the event row is deleted** before returning 500, so the retry is
processed rather than rejected as a duplicate. Without that, one transient
database error means a renewal is never granted and nothing ever tries again.

---

## 27. Upgrades apply now; downgrades apply at the period end

**Decision.** An upgrade changes the price with `proration_behavior:
"always_invoice"` and takes effect immediately. A downgrade — including
cancelling — is scheduled for the end of the paid period, with no proration
credit. `cancel_now` is not offered.

**Why.** The asymmetry is the whole design. Someone upgrading wants capacity
now and has just agreed to pay for it; making them wait until next month for
something they were charged for today would be absurd.

A downgrade is different, and the fair-sounding option is the wrong one.
Applying it immediately with a proration credit means the user loses access
mid-period in exchange for a credit against a future invoice they may never
receive. So they keep everything they paid for, `scheduledTier` records what
will happen, and the interface says the date and offers to undo it.

The downgrade is also the only one of the two that asks for confirmation.
Upgrades are reversible in a click and cost an amount the card already stated;
downgrades remove capability.

**What it costs.** Somebody who wants to stop paying _today_ cannot. The refund
path for that is a support conversation, which is the right venue for a case
this rare.

---

## 28. `PAST_DUE` still entitles

**Decision.** `getEntitlement` treats `TRIALING`, `ACTIVE` **and** `PAST_DUE` as
entitled. Access stops at `UNPAID`.

**Why.** Stripe retries a failed payment on a schedule for days, and most of
those retries succeed — the common cause is an expired card, not a refusal to
pay. Cutting access off at the first failure punishes both identically, and
turns a card update into a support ticket. `UNPAID` is Stripe's own signal that
every retry has failed, and that is the honest place to stop.

The state is not hidden: the billing screen shows a banner saying the payment
did not go through and that access continues while it is retried.

**What it costs.** A few days of service to somebody who genuinely will not pay.
Cheaper than the churn from locking out customers whose card expired.

---

## 29. The catalogue is split from the price ids

**Decision.** `services/billing/catalogue.ts` holds tiers, amounts, allowances
and features, with no `env` and no `server-only`. `services/billing/plans.ts`
adds the Stripe price ids and is server-only.

**Why.** The landing page, the pricing card and the billing screen all need the
catalogue, and they run in the browser. `@t3-oss/env-nextjs` throws when a
server variable is read on the client — and because `PLANS` reads them at module
scope, a single client import would have been a production runtime error and
nothing at all in development. That is the worst possible time to discover it.

The split also fixed a real duplication: the landing page had maintained its own
hand-written tier list since Sprint 2. Fine while nothing could be bought; with
checkout live, two lists eventually advertise $24 and charge something else.
`features/marketing/content.ts` now derives from the catalogue and invents no
numbers.

**Amounts are committed, ids are not.** A price id is per-account and per-mode,
so it cannot be in the repository. Nothing in this codebase can guarantee the
committed amount matches what Stripe charges — Stripe owns that. What it does
guarantee is refusing to sell a plan it has no id for, with a message naming the
variable, rather than showing a price and charging whatever the dashboard says.

---

## 30. The marketplace catalogue is code, not a table

**Decision.** `services/marketplace/catalogue.ts` is a TypeScript array. Only
favourites and installs are database rows, keyed by `slug` rather than by a
foreign key.

**Why.** Same shape as the AI model registry, for the same reasons: items ship
with the repository, get reviewed like any other change, and exist on a fresh
database with no seed step. A table would add a seed to every environment and a
migration to every copy edit, in exchange for making a linear scan over sixteen
objects marginally faster.

`slug` is a string and not a foreign key precisely because the catalogue is not
a table yet. When third-party publishing arrives, an `items` table joins
alongside and the key does not change.

**What it costs.** A publisher cannot add an item without a deploy — which is
correct while every item is first-party, and is the thing that has to change
first when that stops being true.

---

## 31. No ratings, no download counts, no invented publishers

**Decision.** Every item says "Atheos". Cards show what is inside — "12
prompts", "6 styles" — and nothing about popularity. The browse page states
that publishing is not open.

**Why.** A marketplace's social proof is the first thing a user trusts and the
first thing they would discover was untrue. There are no third-party publishers
yet, so any author name, star rating or download figure would be fabricated.
The honesty constraints this project has held since Sprint 2 — no invented
customer logos, no fabricated metrics, no `aggregateRating` — apply hardest
here, where the numbers _are_ the product's credibility.

Size and contents are facts we actually have, and they are the useful ones
anyway: nobody installs a prompt pack because of its star rating.

**Voice packs are catalogued and marked unusable** rather than hidden. Audio
generation does not exist until a later sprint. A listing that can be found and
cannot be used, saying exactly why, is more honest than one that quietly does
not exist — and the install still works, so somebody can keep it for when it
does.

**What it costs.** The browse page looks sparser than a populated marketplace.
That is what it actually is.

---

## 32. Everything is shown before it is installed

**Decision.** The detail sheet lists every prompt, every style fragment and
every character trait in full. Nothing is summarised.

**Why.** This extends Sprint 5's rule that preset text must be readable. A
marketplace makes the stakes an order of magnitude higher: it is somebody else's
text being added to your prompts, and installing sight-unseen is how a workspace
fills with things nobody can explain or remove.

It is also the honest answer to "why would I install this". The contents _are_
the product — there is nothing else to evaluate.

**Installs are snapshots, not references.** Editing a pack in the repository
must not silently change work somebody has already built on; a prompt that
shifts under a user is worse than one that is out of date. The snapshot is what
turns that into an "Update available" badge they can choose to act on.

**What it costs.** A long sheet for a twelve-prompt pack, and stored payloads
that duplicate the catalogue. Both are cheap; the alternative is not.

---

## 33. Nothing is public unless somebody published it

**Decision.** A `Post` row exists only because a person pressed Publish. It is
separate from `Asset` rather than a `published` boolean on it. Sharing a project
does **not** publish what is inside — the shared view shows only assets that
were themselves published, enforced as a join condition rather than a filter
somebody remembers downstream.

**Why.** The studio holds people's unfinished and commercial work. A product
that defaults any of it to visible has misunderstood what it is holding, and the
mistake is unrecoverable — you cannot un-see a leaked draft.

Keeping the post separate also keeps the blast radius small: nothing in the
studio, the projects page or the storage layer knows this table exists. And
unpublishing sets `publishedAt = null` rather than deleting, so the likes and
comments — which belong to the people who left them — survive a take-down and
return if it goes back up.

**Showing the prompt is a third, separate decision.** It is what people most
want to see and what a professional is most likely to consider their method.
Bundling it into "publish" would take that choice away silently.

**A public profile is opt-in too.** Signing up creates no handle. Deriving one
from an email address would publish a page about somebody who never asked for
one.

**What it costs.** More steps between generating something and it being seen,
and a gallery that stays empty longer. Correct trade.

---

## 34. Trending is computed and may be empty; featured is editorial

**Decision.** Trending ranks by likes then comments then recency within seven
days. Featured is a timestamp we set by hand, on posts and on creators, never
derived from popularity. Both return nothing until there is something, and the
interface explains which.

**Why.** They are two different claims — "many people engaged with this" and "we
think this is worth seeing" — and merging them makes the second one worthless.

With nothing published, trending is empty. It does **not** fall back to recent
wearing a flame icon: a ranking that invents momentum is lying about the only
thing it claims to measure, and it is the lie a user catches first. The same
applies to featured creators, where the honest empty state says the list is
editorial and therefore blank rather than quietly showing the most-followed
accounts.

The ranking itself is deliberately naive. A weighted decay score would look more
sophisticated and be untestable against a dataset that does not exist. When
there is real traffic this is the function to replace, and its signature will
not change.

**What it costs.** An empty page at launch, which is what an empty product
actually looks like.

---

## 35. Handles are ASCII, reserved-checked, and never case-sensitive

**Decision.** `[a-z0-9_-]`, 3–24 characters, lower-cased before storing or
comparing, with a reserved list. Profiles live at `/u/{handle}`. Validation
lives in a pure module both the form and the server import.

**Why.** Three separate failure modes, all impersonation:

Unicode handles look inclusive and are a homograph attack surface — Cyrillic
"а" beside Latin "a" is indistinguishable in most fonts, and the entire purpose
of a handle is to identify one person.

Case sensitivity makes `Ada` and `ada` different people, which is the same
attack with less effort.

The reserved list is about `admin`, `support` and `atheos` — a handle that looks
official is the cheapest phishing tool a platform can hand out. It is not about
route collisions; `/u/` prefixing already prevents those.

**`/u/` rather than `/@handle`** because `@` is reserved for parallel routes in
the App Router, so `app/@[handle]` would be read as a slot rather than a page.

**One implementation, imported by both sides.** Two would eventually disagree,
and the disagreement surfaces as a form that accepts what the API then rejects.

---

## 36. Counts are denormalised and written in the same transaction

**Decision.** `likeCount` and `commentCount` on the post, `followerCount` and
`followingCount` on the user. Every write that changes a count does so in the
same transaction as the row it counts.

**Why.** A gallery of twenty-four cards would otherwise be twenty-four counting
subqueries, and the count is on every card.

The transaction is the whole point. A count that can drift from the rows it
counts is a number nobody can trust again, and reconciling it later is a table
scan per post. Following is the sharpest case: three counters move together —
the follow row, the target's followers, the actor's following — and any two
without the third is a number that is wrong forever.

Liking twice is a double-click, not an error: the composite primary key rejects
the duplicate and the count is left alone.

**What it costs.** Write amplification, and a reconciliation job worth having
eventually. Both are cheaper than a follower count nobody believes.

**Deleted comments leave a tombstone.** "This comment was removed" rather than
the row vanishing — a thread with a hole reads as broken; one that says
something was removed reads as moderated, which is what happened. The body is
replaced on the way out, so a deleted comment is not still in the payload.

**Reporting says what it does.** There is no automated moderation, so the
confirmation says a person will look. A report button implying review nobody
performs is worse than none: it tells somebody the problem is handled when it is
only queued.

---

## 37. Admin access has two independent grants, and the environment wins

**Decision.** Admin is `ADMIN_USER_IDS` **or** `User.role = ADMIN`. The
environment list is checked without touching the database.

**Why.** The dashboard can read every user's email and change any credit
balance, so a single grant mechanism is a single point of failure.

The environment list is the root of trust: a database compromise on its own
cannot escalate anybody, and it is the recovery path if the column is ever
wrong — including if an admin removes their own access. Changing it needs a
deploy, which is exactly the friction that should exist here.

The column exists because a bootstrap admin needs to grant access without a
deploy. That is a real operational need and it is deliberately the weaker of the
two. `setRole` refuses to act on yourself in either direction: self-promotion
would route around the allowlist, self-demotion is how an organisation locks
itself out.

**What it costs.** Two places to look when somebody's access is wrong. Named in
the status page, which reports how many ids are in the list and warns when it is
empty.

---

## 38. Absence is 404 — for the API and, after a correction, for the page

**Decision.** Every admin API route returns 404 to non-admins. `/admin` lives in
its own route group whose layout calls `isAdmin()` and `notFound()`.

**Why.** A 403 confirms the endpoint is real and that the caller found
something worth looking for. 404 says nothing.

The page originally sat inside `(app)`, whose layout calls `requireUserId()` —
a **redirect**. So a signed-out visitor got 307 for `/admin` and 404 for
`/adminx`, and the difference confirmed the route existed. That contradicted the
rule the API followed, and it was found by probing rather than by reading the
code. Admin now has its own group, its own chrome, and is indistinguishable
from a typo.

**Three gates, none sufficient alone.** The layout checks, the page checks, and
every function in `services/admin` calls `requireAdmin()` itself. That is the
Sprint 3 rule: a layout check is one refactor away from being bypassed by
another route rendering the same component, and neither does anything for the
API. Protection lives with the resource; the outer gates only make the surface
undiscoverable.

---

## 39. Every admin action is audited, including reads

**Decision.** `admin_audit_log` is append-only. Mutations write to it in the
**same transaction** as the change. Opening a support view writes to it too.

**Why.** "Who granted this account 50,000 credits" needs an answer, and the
first time it is asked will be the worst possible time to find there is no
record. Same transaction, because an action that can commit unaudited is one
nobody can answer for.

Reads are included because the support view is a **disclosure** — it exposes an
email, a payment history and every generation. A log that records only writes
cannot answer "who looked at this account", which is what a privacy complaint
actually asks. The users list says so before you click.

Every mutation requires a written reason, dismissing a report included.
"Reviewed, nothing wrong" is a decision, and one nobody recorded is
indistinguishable from a report nobody read.

**What it costs.** A row per action and a required text field. Both trivial
against the alternative.

---

## 40. Credit adjustments go through the ledger, never around it

**Decision.** `adjustCredits` writes a `MANUAL_ADJUSTMENT` ledger entry with a
caller-supplied idempotency key, inside a transaction with the balance update
and the audit row. Never a bare `UPDATE` on `creditBalance`.

**Why.** The append-only ledger is the entire reason a balance can be explained
(§ 5). An admin tool that bypassed it would produce exactly the unexplainable
number the design exists to prevent — and it would be the highest-trust code
doing it.

**The idempotency key comes from the client** because only the client knows two
requests are the same _intent_ rather than two deliberate adjustments. A support
agent double-submitting a goodwill grant is the failure this must not have; the
unique constraint catches it, and a repeat returns `applied: false` rather than
an error that would invite a third attempt.

**Balances cannot go negative.** Nothing else in the product can represent one —
the studio would show it, billing would render it, and no code path knows how to
recover. Guarded in the service and previewed in the dialog as
"2,140 → −97,859", because a signed number in a box is easy to misread and the
difference between +5000 and −5000 is somebody's month.

**Adjustments are capped at 1,000,000** — not because a larger correction is
never right, but because a typo of six zeros should not be one keystroke away.

---

## 41. One HTTP client and one error responder, with a structural `DomainError`

**Decision.** `lib/http.ts` holds the single browser-side `request<T>()`.
`lib/api-response.ts` holds the single `errorResponse()`. Each feature's
`shared.ts` is now a thin named wrapper over the latter.

**Why.** By Sprint 12 there were **six** copies of the same nine-line
`request<T>()` — studio, projects, billing, marketplace, community, admin — each
with its own `ApiError` re-export. They were copied because the first was not
exported and every feature after it needed the same thing. Six copies is six
places to fix a parsing bug and five of them get missed.

**The error responder takes a structural interface, not a base class.**
`GenerationError`, `ProjectError`, `BillingError`, `MarketplaceError`,
`CommunityError` and `AdminError` were written independently across five
sprints, and all six happen to carry `message`, `status` and `code`. Retrofitting
a shared base class would mean editing six service layers to satisfy a helper —
the tail wagging the dog. An interface matching the shape they already have
costs nothing and breaks nothing.

**What it costs.** Structural typing will accept an unrelated object that
happens to have those three fields. In practice the alternative — a refactor
across six services purely for nominal typing — was the larger risk.

**The per-feature wrappers stay** because each area's log context and vocabulary
differ, and a single call site with a six-way switch would be worse than six
two-line functions.

---

## 42. Three error boundaries, and `global-error` imports nothing

**Decision.** `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`.
Before Sprint 13 there were none — a thrown render error showed the Next.js
default, which in production is a blank page.

**`error.tsx` calls `reset()`, not `location.reload()`.** A reload discards
client state, and in this product that state is an unsaved prompt or a
generation being polled. `reset()` re-renders the segment and keeps both. The
`digest` is shown deliberately: it is the only string that connects what the
user saw to what the server logged, and asking someone to describe a stack trace
is asking them to do the impossible.

**`global-error.tsx` uses inline styles and system fonts, and imports nothing
from the design system.** It only renders when the **root layout** threw — so
the theme provider, the font loader, or the stylesheet itself may be exactly
what broke. A fallback that depends on the thing that failed is not a fallback.

**`not-found.tsx` does not say why.** It cannot distinguish "no such post" from
"a post you may not see" without leaking the difference, and § 38's 404-not-403
rule only holds if the 404 page keeps the secret too.

---

## 43. The CSP ships in Report-Only, with an explicit escape hatch

**Decision.** `Content-Security-Policy-Report-Only` by default; the header key
becomes the enforcing one only when `CSP_ENFORCE=1`.

**Why.** This policy has never seen real traffic — no Clerk captcha frame, no
Stripe redirect, no OAuth popup has ever loaded against it. A first-deploy
enforced CSP that blocks the checkout iframe is discovered by a customer who
cannot pay, which is the worst available feedback channel.

**`script-src` excludes `'unsafe-eval'`** but includes `'unsafe-inline'`,
because Next.js emits inline bootstrap scripts and a nonce-based policy needs
per-request header generation in middleware. That is worth doing; it was not
worth doing at the same time as the first CSP the app has ever had.

**What it costs.** A report-only policy stops nothing. It is a measurement
instrument until someone reads the reports and flips the flag — and that flip
should be a deliberate act with evidence behind it, not a default chosen by
whoever wrote the config.

---

## 44. The sitemap queries the database and degrades to static

**Decision.** `app/sitemap.ts` is async, lists published posts and public
profiles (capped at 5,000 each), and is wrapped in try/catch so a database
failure returns the static routes instead of throwing.

**Why.** A community with no discoverable posts is a community search engines
cannot see. But a sitemap is not worth a 500 — the failure mode of a crawler
getting a partial sitemap is mild, and the failure mode of `/sitemap.xml`
erroring is that the whole file is unusable.

**`/admin` is absent from `robots.ts` deliberately.** It 404s for non-admins
(§ 38); naming it in a file whose entire purpose is to be fetched by strangers
would undo that in one line. Disallowing a path is advertising it.

---

## 45. The launch checklist says what has never run

**Decision.** `docs/LAUNCH.md` sorts everything into verified / written-never-run
/ not-built, and opens by stating that Atheos has never touched a real database,
Clerk instance, Stripe account, provider key or bucket — and that there are no
tests and no migration has ever been generated.

**Why.** Thirteen sprints produced a build that is clean, a UI that has been
checked at two breakpoints, and a set of preview routes that exercise real
interaction against fixtures. It would be easy, and wrong, to read that as
readiness. Everything with money or identity behind it is unexecuted code.

A checklist that flatters the work is worse than no checklist, because it
transfers a false belief to whoever deploys it. The honest version is also the
useful one: the first-run list is short, ordered, and every item on it is
something that has genuinely never happened.

**What it costs.** It reads as a list of failures. It is a list of _unknowns_,
which is a different and more actionable thing.

---

## 46. One storage system and one database client — reversing part of §§ 2 and 4

**Decision.** Removed `uploadthing`, `@uploadthing/react`, `@supabase/ssr`,
`@supabase/supabase-js`, `@stripe/stripe-js` and `cmdk`, together with
`UPLOADTHING_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.

**Why.** All six had **zero import sites**. Not "used lightly" — never imported
once, across thirteen sprints.

§ 4 argued for two storage systems on the grounds that inbound uploads are
different work from outbound delivery. That reasoning was sound and the
prediction was wrong: when `/api/uploads` was finally built in Sprint 7 it took
multipart form data and wrote straight to R2, and the plumbing UploadThing was
meant to save us turned out to be about thirty lines once the destination is
already S3-compatible.

§ 2 chose Supabase for managed Postgres "and, later, Realtime". Later never
came, and § 2's own reasoning is why: Clerk owns sessions, so row-level security
cannot see who is asking, which makes the anon-key path unusable here by design.
The JS client had nothing to do.

`@stripe/stripe-js` existed for a card form that was never built — checkout
returns Stripe's hosted `session.url` and the browser navigates to it. `cmdk`
existed solely for a command palette component nothing rendered.

**Why the environment variables matter more than the packages.**
`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security completely. It was sitting
in the deployment surface, required by nothing, protecting nothing, and every
person who ever configured this app would have pasted a live one in. The best
thing to do with a credential nobody uses is to stop asking for it.

More generally: a deployment checklist is only trustworthy if every line on it is
load-bearing. Five variables that nothing reads make the other twenty look
optional too.

**What it costs.** Reinstating any of them is an `npm install` and an env entry.
That is a much smaller cost than the one being paid — configuration that implies
integrations which do not exist.

---

## 47. The first migration is generated offline and baselined

**Decision.** `prisma/migrations/0_init/migration.sql` was produced with
`prisma migrate diff --from-empty --to-schema`, not by `prisma migrate dev`
against a live database. Deploying applies it with `migrate deploy`; an existing
database adopts it with `migrate resolve --applied 0_init`.

**Why.** `migrate dev` needs a database to shadow, and there was none — which is
exactly how a schema reaches thirteen sprints without a single migration. Waiting
for infrastructure to exist before writing the migration had already cost the
project its largest single gap.

`migrate diff` needs nothing. The SQL it produced is the same SQL `migrate dev`
would have written, and it can be **read** before it is ever run — which is what
the deployment order in `docs/LAUNCH.md` asks for anyway.

**It was verified rather than assumed.** The SQL was applied to a real Postgres
engine (PGlite — Postgres compiled to WebAssembly, in-process, no server) and the
result introspected: 16 tables, 11 enums, 22 foreign keys, 59 indexes, 16 primary
keys. Those reconcile exactly against the schema — 16 `model` blocks, 11 `enum`
blocks, and 30 `@@index` + 3 `@@unique` + 10 field-level `@unique` = the 43
`CREATE INDEX` statements emitted.

Fifteen behavioural assertions then ran against that database, covering the
guarantees the product's correctness actually rests on: a replayed webhook event
id is rejected, a reused credit `idempotencyKey` is rejected, a null one is not,
deleting a generation nulls its ledger row rather than removing it, deleting a
user cascades everything they own, and a composite primary key makes a double
like impossible. All fifteen passed.

**What it costs.** PGlite is not the Postgres we will deploy to — no pooler, no
extensions, a different build. It proves the DDL is valid and the constraints
behave; it does not prove anything about pooling, `pg_trgm`, or performance. And
because the migration was never applied by `migrate dev`, the first real
`migrate deploy` is still the first time Prisma's own migration machinery touches
this schema.

---

## 48. A duplicate webhook and a broken database are not the same event

**Decision.** Both webhook receivers now check `isUniqueViolation(error)` before
treating a failed idempotency claim as "already processed". Anything else is
logged and answered with a 500 so the provider retries.

**Why.** Both were written as a bare `catch { return 200 }`. The intent was
"the primary key rejected a replay, so this is a no-op" — but the catch also
swallowed dropped connections, pool exhaustion and timeouts, and answered every
one of them with _200, already handled_. Stripe and Svix both stop retrying on a 200. The grant would be lost permanently, silently, and most likely under load,
which is precisely when the database is least reachable.

The failure mode was invisible in code review because the comment described the
intent rather than the behaviour, and `isUniqueViolation` — written in Sprint 13
for exactly this — was three lines away in `lib/prisma-errors.ts`.

**The Clerk receiver had a second, worse bug.** It claimed `event.data.id`, which
is the **user** id, not the event id. `user_abc` was claimed by the first
`user.created`; every later `user.updated` for that person then collided with it
and was dropped as a duplicate. A profile would sync exactly once and never
again — and the eventual `user.deleted` would collide too, leaving the row and
all of that person's data undeleted after they closed their account. It now uses
the `svix-id` header, which is unique per delivery.

A missing `CLERK_WEBHOOK_SIGNING_SECRET` is also reported as its own 503 rather
than surfacing as "signature verification failed", which sent whoever read that
log hunting for a signature mismatch.

**What it costs.** Nothing. A retry after a 500 is safe by construction: the
claim is the first write, so nothing has been granted when it fails.

---

## 49. One gate at the route boundary, and the check still lives with the resource

**Decision.** `lib/api-guard.ts` runs CSRF → session → rate limit → user row →
admin → input, for all 52 route handlers. The six private `requireApiUser()`
copies became one in `lib/auth.ts`, and it is **still called by every service
function**.

**Why one gate.** Rate limiting needs a caller identity, CSRF needs to run
before any work, and input validation needs to run after authorisation. Those
three orderings are easy to state and were being re-derived, differently, in
every route. Thirty-four files each deciding what to check first is thirty-four
chances to check it last.

**Why the service check stays.** The obvious follow-on is that the guard has
made `requireApiUser()` redundant. It has not. A guard protects the single route
that calls it; a service function is reachable from route handlers, Server
Actions and other services, including the caller nobody has written yet. This is
the § 14 rule, and the cost of keeping it is one database read that is already
cached per request.

**Why the six copies could merge without touching six error types.**
`errorResponse` matches domain errors structurally (§ 41), so one `AuthError`
produces exactly the same 401 through every area's responder that six bespoke
error classes did. The duplication had no purpose; it was only load-bearing in
appearance.

**What it costs.** Every route now has a line of ceremony before its real work,
and a policy name that has to be chosen. That choice being explicit is the
point — there is no default and no unlimited path.

---

## 50. Authorisation runs before input validation, not after

**Decision.** The guard checks admin membership at step 5 and parses the body at
step 6. Non-admins get 404 before a single byte of input is read.

**Why.** This was a real leak, and it predates the guard. An admin route parsed
its body first, so a malformed body returned **400** while a well-formed one
returned **404**. Two different answers to two different guesses is exactly the
disclosure the 404 rule (§ 38) exists to prevent — an attacker does not need the
route to admit it exists, only to behave differently from one that does not.

The first version of the guard made it worse: `auth: "required"` returned 401
before the service could 404 at all. That was caught in runtime verification
rather than review, which is worth recording — the check that found it was
"request every admin route four different ways and confirm the answers are
byte-identical", and no amount of reading the diff would have produced it.

**The general rule this encodes:** a 400 is information. Any endpoint whose
existence is a secret must not validate input before deciding whether the caller
may know it exists.

**What it costs.** Admin routes do one extra `isAdmin()` call before parsing.
`isAdmin()` reads the session and an environment list; it is cheaper than the
JSON parse it now precedes.

---

## 51. Origin-based CSRF, and a request with no origin is refused

**Decision.** `verifyCsrf` trusts `Sec-Fetch-Site` where present, falls back to
an `Origin` allowlist, and **refuses when neither header is present**.

**Why not a synchroniser token.** It is the textbook answer and the wrong shape
here. Every mutation in this app is `fetch` with JSON from our own first-party
JavaScript; there is not one form that posts to itself. A token would mean
threading a value through a codebase with nowhere natural to put it, to defend a
case `Origin` already covers.

**Why refuse the header-less request.** The usual advice is to allow it, on the
grounds that a CSRF check has no opinion about non-browser clients. That is true
and it is beside the point: a same-origin `fetch` always sends one of these
headers, so a request with neither is not our UI. It is curl, a script, or a
server — and those have no legitimate reason to be carrying a user's session
cookie. Refusing costs nothing real and closes the "ancient browser" gap without
having to reason about which browsers those are.

**What it costs.** Any future server-to-server integration authenticating by
cookie would break. It should not authenticate by cookie; the webhooks already
demonstrate the right pattern, and they set `csrf: false` precisely because a
signature over the body is stronger than an origin header.
