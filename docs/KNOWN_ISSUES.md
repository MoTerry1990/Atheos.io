# Known issues

Things that are wrong, understood, and not yet fixed. An issue leaves this file
by being fixed or by being reclassified as a decision in
[`DECISIONS.md`](DECISIONS.md) — not by going stale.

---

## KI-1 — Local Clerk application mismatch blocks signed-in development

**Filed** 2026-08-24 · **Severity** high for local work, **none in production**

### Symptom

Any authenticated route on `localhost:3000` redirects in a loop and the dev
server logs:

```
Clerk: Refreshing the session token resulted in an infinite redirect loop.
This usually means that your Clerk instance keys do not match — make sure to
copy the correct publishable and secret keys from the Clerk dashboard.
```

`/studio`, `/dashboard`, `/settings` and `/billing` are unreachable locally.
Public routes and `/studio-preview` (which uses fixtures) are unaffected.

### What was checked

| Check                                           | Result                               |
| ----------------------------------------------- | ------------------------------------ |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` environment | `pk_test_…` — **test**               |
| `CLERK_SECRET_KEY` environment                  | `sk_test_…` — **test**               |
| Both from the same Clerk _environment_          | yes                                  |
| Publishable key's instance                      | `civil-bedbug-73.clerk.accounts.dev` |

So this is **not** the usual live/test mix-up. Both keys are test-mode. The pair
belongs to two different Clerk **applications**, or the secret was rotated in the
dashboard without `.env.local` being updated.

### Why it is not a production problem

Production and Preview take their Clerk keys from Vercel, not from
`.env.local`. `atheos-io.vercel.app` authenticates correctly — verified
2026-08-23, when `/studio`, `/dashboard` and `/settings` all returned a clean
`307 → /sign-in?redirect_url=…` and the sign-in page rendered.

### What it blocks

- Any local verification of a signed-in flow.
- **Creative Director live verification** (Truth & Audio Step 3), which needs a
  real generation as a real user. Combined with KI-2 there is currently no route
  to one.

### Fix

Open the Clerk dashboard, pick the application that owns
`civil-bedbug-73.clerk.accounts.dev`, and copy **both** keys from that same
application into `.env.local`. Owner action — it needs dashboard access, and
nobody else should be handling those keys.

---

## KI-2 — No machine-authentication path exists, so no automated live test can run

**Filed** 2026-08-24 · **Severity** medium · **RESOLVED** 2026-08-24

### Resolution

The owner created a key, and it still did not work — which exposed the real
cause. `requireApiUser()` had always accepted a key, but nothing ever reached
it: `guard()` runs first on every route and refused a key-bearing request twice
before that fallback could run, with a 403 on the missing `Origin` header and
then a 401 on the missing session. A server-to-server client sends neither, so
the whole feature was unreachable in production while reading as fully
implemented.

`guard()` now resolves a caller as a session **or** a valid bearer key, skipping
CSRF for bearer callers only (an `Authorization` header is never ambient, so it
cannot be forged cross-origin) while keeping rate limits, in a per-key bucket.
Two routes that called the redirecting `requireUser()` after the guard were
fixed alongside it.

Proven live: `GET /api/generations` with a bearer key returns 200, and the Step 3
generation below ran entirely through key authentication.

---

### Original report

### Symptom

`requireApiUser()` accepts a Clerk session **or** an API key, which is what makes
the service layer reachable by a program. But:

- the `api_keys` table contains **0 rows**;
- keys are stored as a `hash`, so an existing one could not be recovered anyway;
- creating one requires `POST /api/keys`, which requires a signed-in session;
- signing in locally is blocked by **KI-1**.

The result is circular: automated verification of a real generation needs a key,
and getting a key needs the thing the key would let us avoid.

### What it blocks

Every end-to-end proof that involves spending credits — Creative Director
verification, the audio delivery gate, settlement behaviour under a real
provider response.

### Fix

Owner creates one key at `/settings/api-keys` **in production** (Production and
Preview share `DATABASE_URL`, so a single key authenticates against both) and
puts it in `.env.local` as `ATHEOS_API_KEY`. It is then used the same way
`REPLICATE_API_TOKEN` already is: read from the file, never printed, never
committed.

Fixing KI-1 also resolves this, since the key could then be created locally.

---

## KI-3 — The audio delivery gate is not connected to the pipeline

**Filed** 2026-08-24 · **Severity** high — it is a guarantee the product does
not actually provide

### Symptom

`services/video/audio-gate.ts` is a pure verdict function. It is imported by
exactly one file, `tests/unit/video-audio.test.ts`, which constructs its input by
hand. **No code path measures a delivered file**, so a generation that promised
audio and came back silent is delivered and settled.

`assets.width`, `assets.height` and `assets.durationMs` are nullable and were
NULL on both generations audited on 2026-08-23 — nothing measures containers
either.

### Why the claim was made anyway

Commit `e6caffc` ("fail the delivery gate when audio loudness cannot be
measured") is real and its tests pass. It hardened the _decision_ function. The
wiring that would call it was never built, and the distinction was not stated
clearly enough in the sprint reports that followed. Recorded here so the claim
and the behaviour stop diverging.

### Fix

[`DELIVERY_MEASUREMENT_SPEC.md`](DELIVERY_MEASUREMENT_SPEC.md) — a worker that
runs `ffprobe` outside the serverless runtime, posts a `MeasuredAudio` back, and
settles only after `judgeAudio` returns. Needs a migration for a `MEASURING`
status, so it stops for approval before it is applied.

Until it exists, **do not describe audio delivery as verified**, and treat a
Veo benchmark as testing `ffprobe` rather than testing Atheos.

---

## KI-4 — The Creative Director quotes a flat price regardless of duration

**Filed** 2026-08-24 · **Severity** low — it overcharges rather than loses money

`assessModel()` in `services/ai/brief-routing.ts` returns
`credits: model.creditsPerGeneration`, a flat figure set at each model's longest
clip. A four-second Cinematic Fast plan is therefore quoted **720 credits where
360 holds the 3.0× floor** — 6.0× margin instead of 3.0×.

The direct-selection path does not have this problem: `services/ai/pricing.ts`
scales by `durationSeconds / min(durations)`.

Recorded rather than repriced because it changes what customers pay, which is a
product decision. `tests/unit/catalogue-integrity.test.ts` pins the current
behaviour so it cannot drift further while the decision is pending.

---

## KI-5 — The intent planner extracts nothing, and the compiler used to ship the gap

**Filed** 2026-08-24 · **Severity** high · **Partially mitigated**

### Symptom

`planFromPrompt` returns a brief whose scene fields are all empty.
`primarySubject` comes back with the reason string _"not identified without a
planner call"_ — the extraction step it names has never been built. Every
`from` is `"default"`.

### What it caused

`sceneLine()` composed the model prompt from those fields alone, so a prompt
with no extracted subject compiled to boilerplate. Found live against a real
deployment, one step before a paid call:

```
in : A single slow push-in on a cup of coffee steaming on a windowsill at dawn.
out: natural daylight One continuous shot, no cuts.
```

Nothing errored. That generation would have succeeded, charged 90 credits, and
returned a grey clip — worse than a failure, because a failure is visible.

### What has been fixed

The compiler now falls back to the user's own words when no subject was
extracted (`originalPrompt` was already preserved byte-for-byte for exactly this
reason). Pinned by `tests/unit/prompt-integrity.test.ts`.

### What has not

The planner itself. Every brief still arrives with empty structured fields, so
the Creative Director's routing, conflict detection and shot planning are all
reasoning about a brief that contains almost nothing. The fallback stops a
wrong prompt shipping; it does not make the Director work as designed.

---

## KI-6 — The clarification questions offer options the model cannot honour

**Filed** 2026-08-24 · **Severity** medium

### Symptom

Planning a Motion 1 video returns two clarifications, both wrong in a small way:

- `shotCount` offers **"1 edited shots"** — a grammar fault, and both of its
  options carry the same value `1`, so the two choices are indistinguishable.
- `audioStrategy` recommends **NATIVE**, but `AUDIO_CAPABILITIES` declares Motion
  1's strategies as `ATHEOS_SOUND_DESIGN` and `SILENT`. NATIVE is not among them.
  This is [KI-3](#ki-3--the-audio-delivery-gate-is-not-connected-to-the-pipeline)
  surfacing as a user-visible option rather than a silent gap.

### Why it matters

The recommended answer to a question Atheos asks should be one Atheos can
deliver. Accepting the recommendation here selects a sound mode the model has no
way to produce.
