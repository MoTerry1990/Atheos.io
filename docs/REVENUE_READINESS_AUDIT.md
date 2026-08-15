# Revenue Readiness Audit — Atheos.io

**Type:** audit, plus a Sprint 4 addendum (§ 21) recording what was built
against it. No migration applied to production, no Stripe object created,
**no paid generation run**, no secret value printed or read.

**Commit:** `b8c874b5c9e58ddbd85f6d807f4932f5006317cb`
**Working tree:** clean at audit start
**Date:** 2026-08-14
**Sources:** the repository, `docs/FRONTEND_AUDIT.md`, `docs/DECISIONS.md`,
`docs/LAUNCH.md`, `CLAUDE.md`, `AGENTS.md`, and the production deployment's
configuration **by variable name only**.

---

# 1. Executive Summary

| Area                       |             Score | Note                                                                 |
| -------------------------- | ----------------: | -------------------------------------------------------------------- |
| Overall product completion |           **72%** | Feature-complete surface; the money layer is the gap                 |
| **Paid-beta readiness**    | **41 → 58 / 100** | After Sprint 4. See § 21 for what moved and what did not             |
| Auth                       |                80 | Works; the Clerk webhook is still unwired                            |
| Studio                     |                75 | Generates, polls, stores, refunds                                    |
| Image generation           |                85 | Verified end to end against a real provider                          |
| Video generation           |                70 | Verified; serial chaining; slow model is expensive                   |
| Audio generation           |                55 | Models verified live; costs **estimated, not measured**              |
| Credit system              |       **35 → 80** | Atomic reserve/capture/release; non-negative constraint (§ 21)       |
| Stripe                     |                45 | Code complete; nothing configured; annual/Agency contradict the plan |
| Storage / library          |                60 | Isolated by query, but the bucket is **public**                      |
| **Financial safety**       |       **10 → 70** | Eight-rung breaker, four kill switches; spend figure is still manual |
| Security                   |       **60 → 70** | Rate limiting is now enforceable across instances                    |
| Monitoring / operations    |                20 | `console` and a health endpoint                                      |

**Launch blockers: 9 open** (2 × P0, 3 × P1, 3 × P2, 1 × P3) — down from 14.
**Closed:** B10 (rotation, 2026-08-14), then B1, B2, B6 and B7 in Sprint 4.
**B5 is partially closed** and stays open: every enabled model now clears a
tested margin floor, but four of the six provider costs are still estimates
rather than invoices, so the paid credit allowances remain unset.

## Verdict: **NOT READY — but for a different reason than before**

The original verdict was that nothing in the codebase could stop it spending
money. That is no longer true: § 21 records the breaker, the atomic ledger and
the distributed limiter that now sit in front of every provider call.

What remains is B3 (the worker has never run in production) and the entire
Stripe path, which is Sprint 5. Nothing can be **sold** yet, so nothing can be
overspent by a customer — and the free tier, which is the only thing anyone can
reach today, is bounded at every level.

The verdict below is preserved as written on 2026-08-14.

## Original verdict: **NOT READY**

Not because the product does not work — it does. Because **there is no
mechanism, anywhere in this codebase, that can stop it spending money.**

Three findings drive the verdict, and each is independently sufficient:

1. **No spending control exists.** Not a counter, not a ceiling, not a switch.
   A search for budget/limit/kill-switch logic returns only the worker's
   45-second time budget. With a $500 absolute ceiling and a self-funded
   founder, shipping paid accounts without this is betting the company on
   nobody finding the free tier.
2. **The credit ledger can go negative under concurrency.** The balance check
   reads outside the transaction that debits, and the column has no
   non-negative constraint. Concurrent requests overspend.
3. **Stripe is configured for a plan that no longer exists.** The code
   advertises five tiers with annual billing and an Agency plan; the launch
   plan is four tiers, monthly only, no Agency. No price ID is set in
   production, so checkout cannot complete at all.

A paid beta is reachable — Sprints 4 and 5 as scoped below — but not from here.

---

# 2. Architecture Map

```
User
 └─ middleware.ts ....................... Clerk session + locale negotiation
     └─ lib/auth.ts ..................... requireApiUser() — THE gate
         └─ app/api/generations/route.ts  guard: CSRF → rate limit → auth → zod
             └─ services/generation.ts    submitGeneration()
                 ├─ registry lookup ..... services/ai/registry.ts
                 ├─ price ............... services/ai/pricing.ts  (server-side)
                 ├─ balance check ....... ⚠ OUTSIDE the transaction
                 ├─ TX: generation row + balance decrement + ledger row
                 ├─ provider.submit() ... services/ai/providers/replicate.ts
                 └─ status → QUEUED/RUNNING
                     └─ pollGeneration() ← browser drives it
                         └─ settleSuccess()
                             ├─ download from provider
                             ├─ services/storage/assets.ts → R2
                             ├─ asset rows + cost record
                             └─ lease release
                         └─ failure → refund() idempotencyKey=refund:{id}
```

| Stage    | Files                          | Boundary           | Models                  | External  | Failure        | Retry          | Observability           | Security                  |
| -------- | ------------------------------ | ------------------ | ----------------------- | --------- | -------------- | -------------- | ----------------------- | ------------------------- |
| Auth     | `middleware.ts`, `lib/auth.ts` | server             | User                    | Clerk     | 401 / redirect | none           | none                    | session **or API key**    |
| Request  | `app/api/generations/route.ts` | server             | —                       | —         | 400/403/429    | none           | `console.warn` on limit | CSRF, zod, rate limit     |
| Pricing  | `services/ai/pricing.ts`       | **server only**    | —                       | —         | throws         | —              | none                    | client cannot set cost ✅ |
| Debit    | `services/generation.ts`       | server             | User, CreditTransaction | —         | TX rollback    | none           | none                    | ⚠ **race**                |
| Provider | `providers/replicate.ts`       | server             | —                       | Replicate | typed error    | manager retry  | `console.error`         | token server-side         |
| Poll     | `pollGeneration`               | **browser-driven** | Generation              | Replicate | stays RUNNING  | worker reclaim | GenerationLog           | owner-scoped              |
| Store    | `services/storage/assets.ts`   | server             | Asset                   | R2        | job fails      | none           | none                    | key contains userId       |
| Settle   | `settleSuccess`                | server             | Asset, Generation       | —         | refund         | idempotent     | GenerationLog           | —                         |
| Library  | `/projects`, `/api/assets`     | server             | Asset, Project          | —         | 404            | —              | none                    | `where: { userId }` ✅    |

**The load-bearing weakness:** polling is driven by the browser. The worker
exists and is correct, but its only trigger is a **daily** Vercel Hobby cron.
A closed tab means a clip finishes on Replicate — already billed — and Atheos
does not notice until 03:00. The user has been charged credits and sees
nothing. A GitHub Actions workflow exists to tick it every 5 minutes but its
two secrets are **not configured**, so it fails on every run.

---

# 3. Authentication and Onboarding

| Item                            | State                     | Note                                                                                                                                                             |
| ------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-up (email + password)      | **Working**               | Clerk custom flow                                                                                                                                                |
| Sign-up (Google)                | **Working**               | Only enabled provider                                                                                                                                            |
| Apple / Microsoft / GitHub      | **Missing**               | Coded and rendered only when Clerk reports them enabled — currently none are                                                                                     |
| Email verification              | **Working**               | Clerk-managed                                                                                                                                                    |
| Password reset                  | **Working**               | `/forgot-password`, `/reset-password`                                                                                                                            |
| Session persistence             | **Working**               | `clerkMiddleware`                                                                                                                                                |
| Sign-out                        | **Working**               | Clerk `UserButton`                                                                                                                                               |
| Protected routes                | **Working**               | Resource-level `requireUser()`, not a matcher                                                                                                                    |
| Redirect after sign-in          | **Working**               | `x-pathname` header                                                                                                                                              |
| Signed-in visitor on `/sign-in` | **Working**               | Honours `redirect_url`, same-origin only                                                                                                                         |
| **New-user DB row**             | **Working**               | `services/users/provision.ts`, called from both webhook and sign-in path                                                                                         |
| Duplicate users                 | **Safe**                  | `clerkId` unique; upsert                                                                                                                                         |
| **Deleted users**               | **Partially working**     | Handled only by the Clerk webhook — which is unwired                                                                                                             |
| **Clerk webhook**               | **Missing in production** | `CLERK_WEBHOOK_SIGNING_SECRET` not set. Sign-up survives without it; later profile edits and deletions are never observed                                        |
| Account settings                | **Working**               | `/settings`                                                                                                                                                      |
| Spanish auth routes             | **Unverified**            | `/sign-in` and `/sign-up` are English-only; Spanish visitors are routed to `/es` marketing but land in English auth                                              |
| Production Clerk instance       | **Unverified**            | Publishable key decodes to `civil-bedbug-73.clerk.accounts.dev` — a **development** instance. Dev instances perform a handshake redirect and have relaxed limits |

**P1:** the deployment appears to be on a Clerk _development_ instance. That
must be confirmed and moved to production before real users.

---

# 4. Studio Functional Inventory

| Feature                | Route/component             | Backend              | Provider            | Readiness                 | Known failure                        | Launch          |
| ---------------------- | --------------------------- | -------------------- | ------------------- | ------------------------- | ------------------------------------ | --------------- |
| Text-to-image          | `/studio` composer          | `submitGeneration`   | flux-schnell/dev    | **Ready**                 | —                                    | **PASS**        |
| Image-to-image         | composer + reference        | same                 | flux-dev            | Coded, **untested**       | unverified                           | **LIMIT**       |
| Reference images       | `reference-upload.tsx`      | `/api/uploads`       | —                   | Ready                     | —                                    | PASS            |
| Text-to-video          | modality rail               | same                 | wan-2.2 / seedance  | **Ready**                 | slow; browser must stay open         | **LIMIT**       |
| Image-to-video         | composer                    | same                 | wan-2.2             | Ready (used by sequences) | —                                    | PASS            |
| Audio generation       | Audio tab                   | same                 | musicgen / audiogen | Ready; **cost estimated** | —                                    | **LIMIT**       |
| Model selection        | `model-picker.tsx`          | registry             | —                   | Ready                     | —                                    | PASS            |
| Aspect ratio           | `output-settings.tsx`       | —                    | —                   | Ready                     | —                                    | PASS            |
| Duration               | `video-settings.tsx`        | —                    | —                   | **Fixed this week**       | advertised 10s, delivered 7.5s       | PASS            |
| Resolution             | per model                   | —                    | —                   | Ready                     | —                                    | PASS            |
| Negative prompts       | `prompt-editor.tsx`         | —                    | wan only            | Ready                     | absent when unsupported ✅           | PASS            |
| Seeds                  | advanced panel              | —                    | —                   | Ready                     | —                                    | PASS            |
| Prompt enhancement     | `Enhance`                   | `/api/ai/enhance`    | llama-3-8b          | Ready                     | free, rate-limited                   | PASS            |
| Generation queue       | `queue-and-history.tsx`     | store                | —                   | Ready                     | —                                    | PASS            |
| Job progress           | polling                     | `pollGeneration`     | —                   | **Browser-dependent**     | stalls if tab closes                 | **FIX**         |
| Cancellation           | `cancelGeneration`          | —                    | Replicate           | Coded, untested           | provider may still bill              | **LIMIT**       |
| Retry                  | manager                     | —                    | —                   | Ready                     | **retry cost unmodelled**            | **FIX**         |
| Download               | `/api/assets/[id]/download` | —                    | R2                  | Ready                     | —                                    | PASS            |
| Delete                 | soft delete                 | —                    | —                   | Ready                     | **no R2 cleanup**                    | **FIX**         |
| Favourite              | projects                    | —                    | —                   | Ready                     | —                                    | PASS            |
| Project assignment     | `save-to-project.tsx`       | —                    | —                   | Ready                     | —                                    | PASS            |
| Prompt reuse           | history                     | —                    | —                   | Ready                     | —                                    | PASS            |
| Model comparison       | —                           | —                    | —                   | **Missing**               | advertised in FAQ                    | **POST-LAUNCH** |
| Batch generation       | `outputs` 1–4               | —                    | —                   | Ready                     | **multiplies cost**                  | **LIMIT**       |
| Sequences              | `/sequences`                | `services/sequences` | wan/seedance        | Ready                     | most expensive button in the product | **LIMIT**       |
| Mobile Studio          | responsive                  | —                    | —                   | **Unverified**            | —                                    | **FIX**         |
| Error messages         | `errorResponse`             | —                    | —                   | Ready                     | —                                    | PASS            |
| Empty / loading states | present                     | —                    | —                   | Ready                     | —                                    | PASS            |

---

# 5. Provider and Model Registry

**Connected provider: Replicate only.** OpenAI and Google are coded but no key
is configured; a mock provider is used when nothing is present, and it labels
itself. Nothing else is connected.

| Model ID                        | Name              | Modality | Provider  | Version pinned | Connected              | Selectable        | Prod | Output    | Cost basis | Verified?                                             |      Credits | Margin   | Retry risk | Recommendation       |
| ------------------------------- | ----------------- | -------- | --------- | -------------- | ---------------------- | ----------------- | ---- | --------- | ---------- | ----------------------------------------------------- | -----------: | -------- | ---------- | -------------------- |
| `replicate/flux-schnell`        | Flux Fast         | IMAGE    | Replicate | `c846a699…`    | ✅                     | ✅                | ✅   | webp      | $0.003/img | **Unverified** — table says `2026-08`, no measurement |            4 | see §6   | Low        | **Launch**           |
| `replicate/flux-dev`            | Flux Quality      | IMAGE    | Replicate | `6e4a938f…`    | ✅                     | ✅                | ✅   | webp      | $0.025/img | **Unverified**                                        |           12 | see §6   | Low        | **Launch**           |
| `replicate/video-gen`           | Motion 1          | VIDEO    | Replicate | `c483b1f7…`    | ✅                     | ✅                | ✅   | mp4 720p  | $0.020/s   | ✅ **Measured**                                       |       90 @5s | see §6   | Medium     | **Launch, capped**   |
| `replicate/video-pro`           | Motion Pro        | VIDEO    | Replicate | `6e47dd83…`    | ✅                     | ✅                | ✅   | mp4 1080p | $0.054/s   | ✅ **Measured**                                       |      180 @5s | see §6   | High       | **Paid tiers only**  |
| `replicate/music`               | Score             | AUDIO    | Replicate | `671ac645…`    | ✅                     | ✅                | ✅   | mp3       | $0.003/s   | ⚠ **Estimated from run time**                         |           20 | Unknown  | Medium     | **Verify first**     |
| `replicate/sfx`                 | Foley             | AUDIO    | Replicate | `154b3e51…`    | ✅                     | ✅                | ✅   | wav       | $0.002/s   | ⚠ **Estimated**                                       |           10 | Unknown  | Medium     | **Verify first**     |
| `replicate/real-esrgan`         | Upscale           | IMAGE    | Replicate | `b3ef1941…`    | ✅                     | ✅                | ✅   | png       | $0.0023    | Unverified                                            |            3 | —        | Low        | Launch               |
| `replicate/remove-bg`           | Remove bg         | IMAGE    | Replicate | `95fcc2a2…`    | ✅                     | ✅                | ✅   | png       | $0.0015    | Unverified                                            |            2 | —        | Low        | Launch               |
| `meta/meta-llama-3-8b-instruct` | (prompt enhancer) | TEXT     | Replicate | `5a6809ca…`    | ✅                     | n/a               | ✅   | text      | ≪$0.001    | Unverified                                            | **0 — free** | Negative | Low        | Launch, rate-limited |
| `openai/gpt-image-1`            | —                 | IMAGE    | OpenAI    | —              | ❌ **Configured only** | ❌                | ❌   | —         | $0.040     | Unverified                                            |            — | —        | —          | Not available        |
| `mock/*`                        | Mock              | —        | internal  | —              | Fallback               | only with no keys | ❌   | svg       | $0         | n/a                                                   |            0 | —        | —          | Dev only             |

**Roadmap-only, and advertised nowhere as available:** Fal, Gemini, Anthropic,
Runway, Luma, Kling, Minimax, Hailuo, Pika. The homepage section listing these
was removed in Sprint 2. `services/ai/registry.ts` refuses to route to any
provider without an adapter.

## What must be verified before pricing

| Model                   | Unit needed                                  | Where to check                                             |
| ----------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| flux-schnell            | **$ per output**                             | `replicate.com/black-forest-labs/flux-schnell` pricing tab |
| flux-dev                | **$ per output**                             | `replicate.com/black-forest-labs/flux-dev`                 |
| musicgen                | **$ per second of GPU**, and which GPU class | `replicate.com/meta/musicgen`                              |
| audiogen                | **$ per second of GPU**                      | `replicate.com/sepal/audiogen`                             |
| real-esrgan / remove-bg | **$ per run**                                | respective model pages                                     |

Six of eleven cost entries carry the date `2026-08` with no measurement
recorded. Two were measured from a real invoice. Two are explicitly estimated.
**Pricing must not be set from the unverified ones.**

---

# 6. Model Cost Matrix

## Formula

```
worst-case unit cost
  = provider_rate
  × duration_seconds          (video/audio only)
  × output_count
  × max_paid_attempts
  + storage_write + egress
```

**`max_paid_attempts` is not 1.** `services/ai/manager.ts` retries on a
retryable provider error, and Replicate bills GPU time for a run that starts
and fails. Only an outright 4xx rejection is free. The audit assumes **2 paid
attempts worst case**.

**Storage:** R2 is $0.015/GB-month, **zero egress**. A 1 MB image is
~$0.000015/month; a 2 MB clip ~$0.00003/month. Negligible per unit, material
in aggregate — see §13.

## Verified models only

**Motion 1 (wan-2.2)** — $0.020/s measured

|                          | 1 attempt | Worst case (2) |
| ------------------------ | --------: | -------------: |
| 5 s                      |    $0.100 |     **$0.200** |
| 7.5 s (its real maximum) |    $0.150 |     **$0.300** |

**Motion Pro (seedance-1-lite)** — $0.054/s measured

|      | 1 attempt | Worst case (2) |
| ---- | --------: | -------------: |
| 5 s  |    $0.270 |     **$0.540** |
| 10 s |    $0.540 |     **$1.080** |
| 12 s |    $0.648 |     **$1.296** |

**Sequences** (the compound case, and the dangerous one):

```
6 shots × 10 s on Motion Pro = 6 × $0.540 = $3.24    (single attempt)
                                          = $6.48    (worst case)
16 shots × 12 s on Motion Pro          = $10.37 / $20.74 worst case
```

**One user, one button, up to $20.74.** That is 4% of the monthly ceiling in a
single click, and nothing in the codebase prevents it being pressed repeatedly.

## Unverified — do not price from these

flux-schnell, flux-dev, real-esrgan, remove-bg, musicgen, audiogen. The table
values are plausible but unmeasured. Measuring costs about $0.40 total and
must happen in Sprint 4 before credits are set.

## Current credit economics, where verifiable

Implied rate: 100 free credits ≈ $0.11 of Motion 1 → **~$0.0011 per credit**.

| Model                  | Credits | Implied revenue @ $0.0011 | Actual cost | Margin    |
| ---------------------- | ------: | ------------------------: | ----------: | --------- |
| Motion 1, 5 s          |      90 |                    $0.099 |      $0.100 | **−1%**   |
| Motion 1, 5 s, retried |      90 |                    $0.099 |      $0.200 | **−102%** |
| Motion Pro, 5 s        |     180 |                    $0.198 |      $0.270 | **−36%**  |
| Motion Pro, 12 s       |     432 |                    $0.475 |      $0.648 | **−36%**  |

**Every video generation currently loses money**, before Stripe fees and
before any retry. The credit-to-cost ratio was set from the fast model's
single-attempt cost and never revisited when Motion Pro was added.

---

# 7. Current Credit System

## Structure

`User.creditBalance` (cached Int) + `CreditTransaction` (append-only ledger:
`amount`, `reason`, `balanceAfter`, unique `idempotencyKey`). Reasons:
`SIGNUP_GRANT`, `SUBSCRIPTION_GRANT`, `PACK_PURCHASE`, `GENERATION_SPEND`,
`GENERATION_REFUND`, `MANUAL_ADJUSTMENT`. Balance and ledger are always
written in the same transaction.

**This design is sound.** The problems are in how it is used.

| Property                             | State                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| Reservation → capture                | ❌ **Does not exist.** Credits are debited at submit; there is no hold          |
| Refund on failure                    | ✅ Automatic, `idempotencyKey = refund:{generationId}`                          |
| Double refund                        | ✅ Prevented by the unique key                                                  |
| Double spend (same job)              | ✅ Prevented — `spend:{generationId}`                                           |
| **Double spend (concurrent jobs)**   | ❌ **NOT PREVENTED**                                                            |
| **Negative balance**                 | ❌ **Possible.** No CHECK constraint, no conditional update                     |
| Client-controlled cost               | ✅ Safe — priced server-side from the registry                                  |
| Client-controlled credits            | ✅ Safe                                                                         |
| Expiry / rollover                    | Partly — free grant caps at 2× allowance                                        |
| Monthly grant                        | ✅ Free tier renews monthly — **contradicts the launch plan**                   |
| One-time welcome grant               | ❌ Not implemented                                                              |
| Purchased credits                    | ✅ Coded, never exercised                                                       |
| Admin adjustment                     | ✅ `MANUAL_ADJUSTMENT`                                                          |
| Provider success after local timeout | ❌ **Charged and refunded, output lost**                                        |
| Renewal grant                        | ✅ Coded in the Stripe webhook                                                  |
| Duplicate renewal grant              | ✅ Idempotency key per invoice                                                  |
| Plan change / cancellation           | ✅ Coded                                                                        |
| **Refunds and disputes**             | ❌ **No credit clawback.** A charge reversed in Stripe leaves the credits spent |

## The race, precisely

`services/generation.ts`:

```
line 167   if (user.creditBalance < cost) throw …     ← read OUTSIDE the transaction
line 208   data: { creditBalance: { decrement: cost } } ← no guard, no constraint
```

`user` comes from `requireApiUser()`, read before the transaction opens. Two
requests arriving together both observe the old balance, both pass the check,
and both decrement. The ledger stays internally consistent — `balanceAfter` is
computed from the update's return — but the balance goes **negative**, and the
provider has been called twice.

**Exploitable deliberately.** 20 parallel requests against a 100-credit free
account can start 20 video generations worth roughly **$2.00–$4.00 of provider
spend**. Repeat across accounts and the $500 ceiling is reachable in an
afternoon. The API key surface and `/api/mcp` make this scriptable without a
browser.

**The fix (Sprint 4, not now):** conditional update —
`UPDATE users SET creditBalance = creditBalance - $cost WHERE id = $id AND creditBalance >= $cost`
— and treat zero affected rows as insufficient credit. Plus a CHECK constraint
as the backstop.

**Verdict: the credit ledger is auditable but not financially safe.**

---

# 8. Pricing Sustainability

## Current live plans

| Plan    |   Price |       Credits/mo | Max video exposure (Motion Pro, retried) | Sustainable                  |
| ------- | ------: | ---------------: | ---------------------------------------: | ---------------------------- |
| Free    |      $0 | 100 **renewing** |                        $0.24/mo, forever | **No** — perpetual liability |
| Starter |   $5.00 |              350 |                                    $0.84 | Marginal                     |
| Creator |  $15.99 |            1,000 |                                    $2.40 | Yes                          |
| Studio  |  $35.99 |            3,000 |                                    $7.20 | Yes                          |
| Agency  | $199.00 |           20,000 |                                   $48.00 | Yes                          |

Stripe takes 2.9% + $0.30 — on $5.00 that is **$0.45, or 9%**.

These numbers look survivable only because the credit rate makes video
break-even at best (§6). Margin comes from users **not** spending their
credits. That is a real business model, and it is also the one that collapses
the month a power user arrives.

## Proposed launch plans, against the founder's targets

| Plan    |  Price | Net after Stripe |      Provider allowance | Implied credits @ $0.0011 |
| ------- | -----: | ---------------: | ----------------------: | ------------------------: |
| Free    |     $0 |               $0 | **$0.25–0.50 lifetime** |    ~250–450, **one-time** |
| Creator |  $9.99 |            $9.40 |                 ≤ $2.50 |                    ~2,200 |
| Pro     | $34.99 |           $33.68 |                 ≤ $9.00 |                    ~8,000 |
| Studio  | $89.99 |           $87.09 |                ≤ $24.00 |                   ~21,800 |

Gross margin at those allowances: Creator **73%**, Pro **73%**, Studio **72%**
— before infrastructure (~$45/mo: Vercel Pro, Supabase, R2, Clerk).

**Break-even:** roughly **6 Creator** or **2 Pro** subscribers cover fixed
infrastructure. Reaching the $150 provider target needs ~60 Creator-equivalent
active users.

## Can exact credits be set now? **No.**

Four of the six models a plan would advertise have unverified costs, and the
credit-to-dollar rate must be derived from the _most expensive_ model a plan
can reach, not the cheapest. Sprint 4 must:

1. Measure all six unverified models — ~$0.40, one run each.
2. Set `credit_value_usd` from the worst-case unit in §6.
3. Derive grants as `allowance ÷ credit_value_usd`.
4. Re-price every model as `ceil(worst_case_cost ÷ credit_value_usd × margin)`.

---

# 9. Free-Tier Abuse Risk

| Vector                        | Protection today                    | Risk                                                         |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| Multiple accounts             | **None**                            | **Critical** — unlimited free credits per email              |
| Disposable email              | **None**                            | High                                                         |
| Unverified email can generate | **Yes, it can**                     | High                                                         |
| Automated sign-up             | Clerk bot detection only            | Medium                                                       |
| IP-based abuse                | **None**                            | High                                                         |
| **Parallel free generations** | **None**                            | **Critical** — §7 race                                       |
| **API bypass of UI limits**   | **None**                            | **Critical** — API keys + `/api/mcp` reach the same services |
| Repeated failed jobs          | Refunded, **provider still billed** | High                                                         |
| Prompt spam                   | Rate limit (weak, see below)        | Medium                                                       |
| Large uploads                 | Size-capped                         | Low                                                          |
| Storage abuse                 | **No quota**                        | Medium                                                       |

**The rate limiter cannot enforce anything.** `lib/rate-limit.ts` uses an
in-memory `MemoryStore`, documented in the file itself as per-process. On
Vercel every concurrent lambda has its own counter, so the effective limit is
`configured × instances`. Under load — exactly when it matters — it approaches
no limit at all.

**Recommended launch-safe free tier:**

- One-time welcome grant, **no monthly renewal** (matches the founder's plan;
  the current monthly renewal must be reverted in Sprint 4)
- Email verification **required before generating**
- Cheapest models only — flux-schnell and Motion 1
- **At most one** short video, ever
- No Motion Pro, no sequences, no batch outputs
- Redis-backed rate limits
- One free account per verified email, enforced at provision time

No fingerprinting, no device tracking — out of scope and disproportionate.

---

# 10. Spending-Control Audit

| Control                              | Exists                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Global monthly provider-cost counter | ❌                                                                            |
| Per-provider budget                  | ❌                                                                            |
| Per-user monthly cost counter        | ❌                                                                            |
| Free-tier budget                     | ❌                                                                            |
| Paid-tier budget                     | ❌                                                                            |
| **Per-generation estimated cost**    | ✅ `estimateCost()` — computed and stored, **never checked against anything** |
| Hard spending ceiling                | ❌                                                                            |
| Provider balance monitoring          | ❌                                                                            |
| Automatic restriction levels         | ❌                                                                            |
| Administrative kill switch           | ❌                                                                            |
| Expensive-model disable              | ❌                                                                            |
| Free-generation disable              | ❌                                                                            |
| Alerting                             | ❌                                                                            |
| Cost dashboard                       | Partial — admin analytics shows spend after the fact                          |
| Audit log                            | ✅ Admin actions only                                                         |

**Nothing prevents spending. The only existing limit is the provider's own
account balance**, which is how spending stopped last week — Replicate returned
402 and generation halted. That is not a control; it is an outage.

## Designed system (specification only — not implemented)

**Enforcement point:** `services/generation.ts`, immediately after the credit
debit and **before `provider.submit()`**. That is the single place every
generation passes through — studio, sequences, API keys and MCP alike. A check
in the route handler would miss three of those four.

```
submitGeneration()
  → price
  → conditional debit
  → assertBudget(estimatedCostMicroUsd, user.planTier)   ← NEW
  → provider.submit()
```

A new `BudgetUsage` table, one row per calendar month, incremented in the same
transaction as the cost record:

```prisma
model BudgetUsage {
  period        String  @id      // "2026-08"
  spentMicroUsd BigInt  @default(0)
  freeMicroUsd  BigInt  @default(0)
  updatedAt     DateTime @updatedAt
}
```

| Threshold | Action                                                   | Who is affected |
| --------: | -------------------------------------------------------- | --------------- |
|      $100 | Log + weekly review                                      | Nobody          |
|      $175 | Alert; evaluate free traffic                             | Nobody          |
|      $225 | **Stop new free generations**                            | Free tier       |
|      $275 | **Disable Motion Pro + sequences for free**              | Free tier       |
|      $350 | Pause non-essential (upscale, remove-bg, audio) for free | Free tier       |
|      $425 | **Paying users only**                                    | All free        |
|      $475 | **Emergency shutdown** — all generation refused          | Everyone        |
|      $500 | Must never be reached                                    | —               |

Plus two manual switches independent of the counter: `GENERATION_ENABLED` and
`EXPENSIVE_MODELS_ENABLED`, readable without a deploy.

**These are emergency brakes, not targets.** At the intended $100–150 of
provider spend, none should ever fire.

---

# 11. Stripe Architecture

**Code state: substantially complete. Configuration state: absent.**

| Element                       | Code                                               | Configured                             |
| ----------------------------- | -------------------------------------------------- | -------------------------------------- |
| Checkout Session              | ✅ `services/billing/checkout.ts`                  | ❌ no price IDs                        |
| Customer creation             | ✅                                                 | —                                      |
| Subscription creation         | ✅                                                 | —                                      |
| Customer Portal               | ✅ `/api/billing/portal`                           | ❌                                     |
| Product/Price mapping         | ✅ `plans.ts`, env-driven                          | ❌ **no `STRIPE_PRICE_*` set**         |
| Webhook verification          | ✅ signature-checked                               | ❌ **`STRIPE_WEBHOOK_SECRET` not set** |
| **Event deduplication**       | ✅ `WebhookEvent` PK insert **before** processing  | —                                      |
| Event ordering                | ⚠ Not handled — out-of-order updates apply blindly | —                                      |
| `checkout.session.completed`  | ✅                                                 | —                                      |
| `customer.subscription.*`     | ✅ created/updated/deleted                         | —                                      |
| `invoice.paid` → credit grant | ✅ idempotent per invoice                          | —                                      |
| `invoice.payment_failed`      | ✅                                                 | —                                      |
| **Refund**                    | ❌ **Not handled**                                 | —                                      |
| **Dispute / chargeback**      | ❌ **Not handled**                                 | —                                      |
| Upgrade / downgrade           | ✅ Downgrade deferred to period end                | —                                      |
| Proration                     | ⚠ Stripe default, unreviewed                       | —                                      |
| Customer↔user mapping         | ✅ `stripeCustomerId` unique on User               | —                                      |
| Test/live separation          | ⚠ Only by which key is deployed                    | —                                      |
| Trials                        | Not implemented — correct for launch               | —                                      |

**Three mismatches with the launch plan:**

1. The catalogue defines **five** tiers (`STARTER`, `BASIC`, `STUDIO`, `SCALE`,
   `AGENCY`); the plan is four. `AGENCY` must be removed or hidden.
2. **Annual prices exist** in code and env (`*_YEARLY`); the plan is monthly
   only.
3. Plan **names** differ: code says Free/Starter/Creator/Studio/Agency; the
   plan says Free/Creator/Pro/Studio. The `PlanTier` enum values already
   diverge from display names and are documented as such — Sprint 5 must map
   carefully rather than rename enum values.

**`isBillingConfigured()` already returns false**, so checkout buttons are
correctly inert today. The system fails safe.

### Recommended Sprint 5 architecture

1. Reduce the catalogue to four monthly tiers; drop annual price IDs.
2. Run `scripts/setup-stripe.ts --dry-run`, then create products in **test
   mode** first.
3. Webhook at `/api/webhooks/stripe`; store `STRIPE_WEBHOOK_SECRET`.
4. **Add `charge.refunded` and `charge.dispute.created`** → claw back
   unspent credits, flag the account.
5. Guard event ordering by comparing Stripe's `created` against the stored
   subscription's `updatedAt`.
6. Full test-mode transaction, including a refund, before live keys.

---

# 12. Database and Migration Audit

**7 migrations, all applied to production.** Schema is in sync.

| Model                    | State                          | Gap                                        |
| ------------------------ | ------------------------------ | ------------------------------------------ |
| `User`                   | Good                           | ⚠ **No CHECK on `creditBalance >= 0`**     |
| `Subscription`           | Good                           | `stripeSubscriptionId` unique ✅           |
| Plan                     | **No table** — a code constant | Fine; entitlements resolve from `planTier` |
| `CreditTransaction`      | **Good**                       | Unique `idempotencyKey` ✅                 |
| `Generation`             | Good                           | Lease columns present                      |
| Provider cost            | ✅ Recorded per generation     | Not aggregated anywhere                    |
| `Asset`                  | Good                           | Soft delete; **no R2 cleanup job**         |
| `Project` / `Collection` | Good                           | —                                          |
| `WebhookEvent`           | **Good**                       | PK dedup ✅                                |
| **`BudgetUsage`**        | ❌ **Missing**                 | Required for §10                           |
| Audit event              | ✅ Admin only                  | Not financial                              |

**Schema changes needed:**

- **Sprint 4:** add `BudgetUsage`; add CHECK `creditBalance >= 0`; index
  `CreditTransaction(userId, createdAt)` for per-user cost sums.
- **Sprint 5:** possibly `Subscription.currentPeriodCreditsGranted` to make
  renewal grants provable; add a `refundedAt`/`disputedAt` marker.

Both are additive. The CHECK constraint requires balances to be non-negative
first — verify before applying, since the race may already have produced one.

---

# 13. Storage and Library

| Item                     | State                                                     |
| ------------------------ | --------------------------------------------------------- |
| Asset persistence        | ✅ Copied from provider into R2 on success                |
| Expiring provider URLs   | ✅ Handled — we do not serve them                         |
| Signed URLs              | ❌ **Not used**                                           |
| **Bucket visibility**    | ⚠ **Public** (`pub-*.r2.dev`)                             |
| Access authorisation     | ✅ `/api/assets/[id]` scoped by `where: { userId }`       |
| **Direct object access** | ⚠ **Unauthenticated** — anyone with the key can fetch     |
| Upload limits            | ✅ Size-capped                                            |
| MIME validation          | ✅ Allow-list                                             |
| Malware risk             | Low — images/video only, never executed                   |
| Deletion                 | Soft only                                                 |
| **Orphan cleanup**       | ❌ **None** — deleted assets remain in R2, billed forever |
| Retention policy         | ❌ None                                                   |
| Egress                   | ✅ R2 zero-egress — a genuine cost advantage              |
| **User data isolation**  | ✅ **Via the API.** ⚠ **Not at the object layer**         |
| Storage cost tracking    | ❌ None                                                   |

**Can one user read another's assets by changing an identifier?**

- **Through the API: no.** Every query filters on `userId`. IDOR-safe.
- **Through storage: yes, if the key is known.** Keys are
  `users/{userId}/generations/{generationId}/{uuid}.ext`. The UUID makes them
  unguessable, so this is security by obscurity rather than access control.
  The `/r2/:path*` proxy added in the sequences sprint makes every object
  reachable from our own origin with no auth. That proxy exists because the
  bucket has no CORS policy.

**Not a breach, and not a control.** Sprint 6 should move to signed URLs with
short expiry, or a bucket policy plus an authenticated proxy.

**Storage growth is untracked and unbounded.** At ~2 MB per video and no
cleanup, 1,000 clips/month is 2 GB/month accumulating at $0.015/GB-month —
trivial in year one, and it never stops growing.

---

# 14. Job Reliability

| Item                  | State                                                          |
| --------------------- | -------------------------------------------------------------- |
| Queue                 | Postgres, `FOR UPDATE SKIP LOCKED` — **correct**               |
| Worker                | `runTick()` — a function, callable from anywhere               |
| Leasing               | ✅ 5-minute lease, `lockedBy`, heartbeats                      |
| Duplicate execution   | ✅ Prevented by the claim query (tested against real Postgres) |
| Timeouts              | ✅ Lease expiry reclaims                                       |
| Retries               | ✅ Backoff, attempt counter                                    |
| Provider polling      | ✅                                                             |
| **Provider webhooks** | ❌ Not used — polling only                                     |
| Stale jobs            | ✅ Reclaimed **when the worker runs**                          |
| Vercel limits         | ⚠ Hobby: 60 s/function, **1 cron/day**                         |
| **Worker trigger**    | ❌ **`WORKER_TRIGGER_SECRET` not set in production**           |
| User-visible status   | ✅                                                             |
| Credit reconciliation | ✅ Refund on terminal failure                                  |

**Can a job finish after the browser closes? Today: effectively no.**

The mechanism is correct and the trigger is missing. `vercel.json` declares one
cron at 03:00 daily. The GitHub Actions workflow that would tick it every five
minutes needs `WORKER_TRIGGER_SECRET` and `PRODUCTION_URL` as repo secrets;
neither is set, so **every run fails**. Meanwhile `/api/worker/tick` refuses to
run without the secret — correctly, but that means the worker has never run in
production.

**Consequence with money attached:** a user starts a 12-second Motion Pro clip
($0.65 of provider time), closes the tab, and Atheos does not settle it until
the daily cron — if the secret existed. Credits are spent, Replicate is billed,
and the user has nothing.

**This is a P0 for paid launch.**

---

# 15. Security

| Check                       | State                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| Missing authorization       | ✅ Resource-level `requireApiUser()` everywhere                                                          |
| IDOR (API)                  | ✅ Owner in the `where`, not a post-check                                                                |
| **IDOR (storage)**          | ⚠ See §13                                                                                                |
| Client-controlled cost      | ✅ **Safe** — priced server-side                                                                         |
| Client-controlled credits   | ✅ Safe                                                                                                  |
| Webhook signature           | ✅ Clerk and Stripe both verified                                                                        |
| Replay attacks              | ✅ `WebhookEvent` PK dedup                                                                               |
| **Rate limits**             | ⚠ **Not enforceable** — in-memory, per-instance                                                          |
| Oversized payloads          | ✅ Capped                                                                                                |
| Unsafe uploads              | ✅ MIME allow-list                                                                                       |
| **SSRF via reference URLs** | ✅ Addressed — the sequences endpoint takes a **storage key**, not a URL, and builds the URL server-side |
| Injection                   | ✅ Prisma parameterised                                                                                  |
| Prompt logging              | ⚠ Prompts appear in `console.error` on failure                                                           |
| Secret leakage              | ✅ `lib/env.ts` enforces the server/client split                                                         |
| Production error detail     | ✅ Normalised responses                                                                                  |
| Admin routes                | ✅ 404 (not 403) for non-admins; env allowlist + role                                                    |
| **API keys**                | ⚠ Spend credits with **no separate limit**                                                               |

**Highest security risk is financial, not data:** an API key or the MCP
endpoint can drive generation at machine speed, and the only brake is a rate
limiter that does not hold across instances.

## Credential rotation — verified 2026-08-14

The Replicate, Cloudflare R2 and Supabase credentials exposed in a development
transcript were revoked and replaced by the founder in the respective
dashboards. This section records the verification, which was conducted by name
and by match-count only — **no secret value was printed, logged or returned**.

| Check                                                                   | Result                               |
| ----------------------------------------------------------------------- | ------------------------------------ |
| Required variable names present locally                                 | ✅ all 8 Replicate/R2/Supabase names |
| `.env`, `.env.local`, `.env.production`, `.env.development` git-ignored | ✅ all four                          |
| Any `.env*` tracked in the index                                        | ✅ none but `.env.example`           |
| Replicate / R2 / Clerk credentials in the **tracked tree**              | ✅ 0 files                           |
| Replicate / R2 / Clerk credentials in **all git history**               | ✅ 0 files                           |
| Production database host referenced in any tracked file                 | ✅ none                              |
| Filenames resembling an env dump ever committed                         | ✅ none                              |
| Server secrets present in the built **client bundle**                   | ✅ 0 occurrences                     |
| `prisma` imported from any `"use client"` module                        | ✅ none                              |

**Two matches were investigated and cleared:**

1. Four tracked files matched a Postgres-credential pattern —
   `.env.example`, `.github/workflows/ci.yml`, `ENVIRONMENT_TEMPLATE.md` and
   `tests/setup/node.ts`. Their hosts are `localhost` or the literal
   placeholder `aws-0-REGION.pooler.supabase.com`. None references the
   production host, so none can carry a live credential.

2. `STRIPE_SECRET_KEY` matched 58 files across history and one in the working
   tree. The local value is **19 characters** with an `sk_test_` prefix — a
   placeholder, since a real Stripe test key is roughly 107 characters. The
   single tracked match is `tests/setup/node.ts`, which sets a dummy so the
   environment schema validates under test. Not a leak; the 58 historical hits
   are prior revisions of that one file.

**The rotation is confirmed clean.** Blocker **B10** is closed.

**One residual note, not a leak:** `lib/env.ts` enforces the server/client
split through `@t3-oss/env-nextjs` rather than the `server-only` package, and
`lib/prisma.ts` carries no `server-only` import. Both are safe today — the
schema throws if a server variable is read in the browser, and no client module
imports Prisma — but `server-only` on `lib/prisma.ts` would make the guarantee
structural rather than conventional. Cosmetic; not a blocker.

---

# 16. Monitoring and Operations

| Capability              | State                              | Launch?           |
| ----------------------- | ---------------------------------- | ----------------- |
| Error monitoring        | ❌ `console` only — no Sentry      | **Required**      |
| Structured logging      | Partial — `GenerationLog` for jobs | Post-launch       |
| Provider latency        | ❌                                 | Post-launch       |
| Provider failure rate   | ❌                                 | **Required**      |
| Generation success rate | Derivable, not surfaced            | **Required**      |
| **Cost per generation** | ✅ Stored per row                  | —                 |
| **Cost per user**       | ❌ Not aggregated                  | **Required**      |
| Revenue per user        | ❌                                 | Post-launch       |
| Gross margin            | ❌                                 | Post-launch       |
| Queue depth             | ✅ In the tick result              | Post-launch       |
| Stuck-job alerts        | ❌                                 | **Required**      |
| Webhook failures        | ❌                                 | **Required**      |
| Storage growth          | ❌                                 | Post-launch       |
| **Budget alerts**       | ❌                                 | **Required (P0)** |
| Support contact         | ✅ `hello@atheos.io`               | —                 |
| Status page             | ❌ `/api/health` exists            | Post-launch       |
| Admin controls          | ✅ `/admin` live                   | —                 |

---

# 17. Environment and Production Readiness

**Names only. No value was read, printed or logged.**

| Variable                                                                         | Service          | Required      | Production                                    |
| -------------------------------------------------------------------------------- | ---------------- | ------------- | --------------------------------------------- |
| `DATABASE_URL`                                                                   | Supabase pooler  | ✅            | **Present**                                   |
| `DIRECT_URL`                                                                     | Supabase session | ✅            | **Present**                                   |
| `CLERK_SECRET_KEY`                                                               | Clerk            | ✅            | **Present**                                   |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                                              | Clerk            | ✅            | **Present** ⚠ decodes to a _dev_ instance     |
| `CLERK_WEBHOOK_SIGNING_SECRET`                                                   | Clerk            | ✅            | **MISSING**                                   |
| `STRIPE_SECRET_KEY`                                                              | Stripe           | ✅            | **Present** (mode unverified — not inspected) |
| `STRIPE_WEBHOOK_SECRET`                                                          | Stripe           | ✅            | **MISSING — P0**                              |
| `STRIPE_PRICE_*` (8)                                                             | Stripe           | ✅            | **ALL MISSING**                               |
| `REPLICATE_API_TOKEN`                                                            | Replicate        | ✅            | **Present** (account out of credit)           |
| `OPENAI_API_KEY`                                                                 | OpenAI           | Optional      | Missing — provider disabled                   |
| `GOOGLE_AI_API_KEY`                                                              | Google           | Optional      | Missing — provider disabled                   |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` | Cloudflare       | ✅            | **Present**                                   |
| `NEXT_PUBLIC_R2_PUBLIC_URL`                                                      | Cloudflare       | ✅            | **Present**                                   |
| `NEXT_PUBLIC_APP_URL`                                                            | App              | ✅            | **Present**                                   |
| `ADMIN_USER_IDS`                                                                 | Admin            | ✅            | **Present**                                   |
| `WORKER_TRIGGER_SECRET`                                                          | Cron             | ✅            | **MISSING — P0**                              |
| `WEBHOOK_SIGNING_SECRET`                                                         | Outbound         | Optional      | Missing                                       |
| Email service                                                                    | —                | ✅ for launch | **No provider configured at all**             |
| Monitoring (`SENTRY_DSN`)                                                        | —                | ✅ for launch | **Not in the schema**                         |

**Also required and not present:** GitHub repo secrets `WORKER_TRIGGER_SECRET`
and `PRODUCTION_URL`, without which the worker workflow fails every run.

**Security note:** the Replicate, R2 and Supabase credentials exposed during
development were **rotated on 2026-08-14** and the rotation was verified — see
§15. Repository, full git history and the built client bundle all scan clean.

---

# 18. Launch Blockers

| ID         | Sev    | Area       | Problem                                                                                           | User impact             | Financial impact                  | Sprint | Acceptance                                                                                                                                                         |
| ---------- | ------ | ---------- | ------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~**B1**~~ | **P0** | Spending   | ~~No budget, ceiling, counter or kill switch anywhere~~ **CLOSED — Sprint 4**                     | None visible            | Breaker on every submit           | 4      | ✅ Eight-rung ladder + 4 kill switches; `spend.*` events; spend figure still manual                                                                                |
| ~~**B2**~~ | **P0** | Credits    | ~~Balance check outside the debit transaction; no non-negative constraint~~ **CLOSED — Sprint 4** | —                       | —                                 | 4      | ✅ Conditional UPDATE + CHECK; 20-way sequential proof on real PG; parallel proof gated on `TEST_DATABASE_URL`                                                     |
| **B3**     | **P0** | Jobs       | `WORKER_TRIGGER_SECRET` unset; worker has never run in production                                 | Job stalls on tab close | Provider billed, output lost      | 4      | Secret set; workflow green; job completes with tab closed                                                                                                          |
| **B4**     | **P0** | Stripe     | No webhook secret, no price IDs                                                                   | Cannot pay              | **Charge grants nothing**         | 5      | Test-mode transaction grants credits exactly once                                                                                                                  |
| ~~**B5**~~ | **P1** | Pricing    | ~~Video loses money; 4 of 6 costs unverified~~ **PARTIALLY CLOSED — Sprint 4**                    | —                       | —                                 | 4 / 5  | ⚠️ Every enabled model now clears its margin floor and it is tested. **Four costs are still estimates**, and the paid allowances stay null until they are measured |
| ~~**B6**~~ | **P1** | Free tier  | ~~Renews monthly; plan calls for one-time~~ **CLOSED — Sprint 4**                                 | —                       | —                                 | 4      | ✅ Renewal deleted; grant is one-time on the Clerk id; the cron now audits instead of granting                                                                     |
| ~~**B7**~~ | **P1** | Abuse      | ~~Rate limiter in-memory, ineffective on serverless~~ **CLOSED — Sprint 4**                       | —                       | —                                 | 4      | ✅ Postgres-backed, not Redis — see `docs/OPERATIONS.md` § 8 for the trade and the upgrade path                                                                    |
| **B8**     | **P1** | Stripe     | Refunds and disputes unhandled                                                                    | —                       | Credits kept after reversal       | 5      | `charge.refunded` + `dispute.created` claw back                                                                                                                    |
| **B9**     | **P1** | Auth       | Clerk appears to be a development instance                                                        | Handshake redirects     | —                                 | 5      | Production instance confirmed                                                                                                                                      |
| **B10**    | **P1** | Security   | Provider credentials exposed in a transcript, unrotated                                           | —                       | Third-party spend on our accounts | 4      | All rotated                                                                                                                                                        |
| **B11**    | **P2** | Storage    | Deleted assets never removed from R2                                                              | —                       | Slow cost growth                  | 6      | Cleanup job                                                                                                                                                        |
| **B12**    | **P2** | Monitoring | No error tracking or alerts                                                                       | Failures invisible      | Slow detection                    | 6      | Sentry + budget alert                                                                                                                                              |
| **B13**    | **P2** | Storage    | Objects publicly readable if the key is known                                                     | Low                     | —                                 | 6      | Signed URLs                                                                                                                                                        |
| **B14**    | **P3** | Studio     | Mobile Studio unverified; model comparison advertised but absent                                  | Confusion               | —                                 | 7      | Verified or claim removed                                                                                                                                          |

---

# 19. Recommended Sprint Plan

## Sprint 4 — Financial safety, credits, budgets, four-plan pricing

**Objective:** make it impossible to spend more than intended.

Files: `services/generation.ts`, `services/ai/cost.ts`, new
`services/billing/budget.ts`, `lib/rate-limit.ts`, `services/billing/catalogue.ts`,
`services/billing/free-grant.ts`, `prisma/schema.prisma`

Schema: `BudgetUsage`; CHECK `creditBalance >= 0`; index on
`CreditTransaction(userId, createdAt)`

Tests: 20-way concurrent debit leaves balance ≥ 0; budget refuses at each
threshold; kill switch blocks submission; one-time grant does not renew

Risks: the CHECK constraint fails if a negative balance already exists —
**query first**. Redis adds a dependency and a failure mode; fail **closed**.

Rollback: budget behind a flag defaulting to permissive, flipped on after
verification.

Acceptance: no generation reaches a provider without passing a budget check;
concurrency cannot overspend; every model cost measured; four monthly plans.

## Sprint 5 — Stripe subscriptions

Objective: take money correctly, exactly once.

Files: `services/billing/{catalogue,plans,checkout}.ts`,
`app/api/webhooks/stripe/route.ts`, `scripts/setup-stripe.ts`

Schema: refund/dispute markers; possibly a per-period grant record

Tests: full test-mode lifecycle — subscribe, renew, upgrade, downgrade, cancel,
refund, dispute; replayed webhooks grant once

Risks: **live keys before the test lifecycle passes.** Do not.

Rollback: `isBillingConfigured()` already fails safe — unset the price IDs.

Acceptance: a test-mode subscription grants credits once; a refund claws back;
no duplicate grant under replay.

## Sprint 6 — Generation reliability

Objective: a job completes whether or not anyone is watching.

Vercel Pro (`*/5` cron), or keep GitHub Actions; provider webhooks instead of
polling; R2 cleanup; signed URLs; Sentry.

Acceptance: tab closed mid-generation → asset appears; orphan cleanup runs.

## Sprint 7 — QA, security, controlled beta

Full E2E; security pass; **10 invited users**; daily cost review; hard cap at
$150 for the beta month.

Acceptance: 10 users, one week, zero unexplained cost, zero credit
discrepancies.

---

# 20. Final Launch Checklist

**Product** — [ ] homepage verified 320–1440 · [ ] domain decided
(`atheos.io` vs the Vercel subdomain) · [ ] mobile Studio verified

**Auth** — [ ] Clerk **production** instance · [ ] webhook wired · [ ] email
verification enforced before generating

**Generation** — [ ] image verified · [ ] video verified with tab closed ·
[ ] audio costs measured, or audio hidden · [ ] every model cost verified

**Money** — [ ] credit race fixed · [ ] non-negative constraint · [ ] budget
counter live · [ ] thresholds tested · [ ] kill switch tested · [ ] one-time
free grant · [ ] four monthly plans · [ ] every model ≥ 60% margin

**Stripe** — [ ] test products · [ ] webhook secret · [ ] full test lifecycle ·
[ ] refund and dispute handled · [ ] **one real $1 transaction, then refunded**
· [ ] live keys only after all of the above

**Infrastructure** — [ ] worker secret set · [ ] workflow green · [ ] Replicate
funded **with a spend limit** · [ ] credentials rotated · [ ] Sentry ·
[ ] budget alerting

**Legal** — [ ] terms, privacy, acceptable use reviewed by a lawyer ·
[ ] refund policy published

**Beta** — [ ] 10 invited users · [ ] $150 hard cap · [ ] daily cost review ·
[ ] rollback rehearsed

---

## Validation performed

Safe, non-paid only:

```
prettier --check  → clean
eslint            → clean
tsc --noEmit      → clean
vitest run        → 28 files, 341 tests passing
next build        → compiled successfully
```

No paid generation was run. No payment method was charged. No Stripe object was
created. No migration was applied. No production data was modified. No secret
value was read, printed or logged — environment variables were inspected **by
name only**.

---

# 21. Sprint 4 Addendum — What Was Built

**Date:** 2026-08-15. **Scope:** B1, B2, B5, B6, B7.
**Not touched:** Stripe (no object created), production database (no migration
applied), Replicate (no paid generation, no top-up).

---

## 21.1 Blockers

| ID     | Before                                          | After                                                                                                      |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **B1** | Nothing knew what had been spent                | **Closed.** Eight-rung breaker on every submit; four kill switches; spend accumulated per month            |
| **B2** | Read-then-write race; balance could go negative | **Closed.** One conditional UPDATE plus `CHECK (creditBalance >= 0)`                                       |
| **B5** | Motion Pro below cost; margins unmeasurable     | **Partial.** Every enabled model clears a tested floor; two were re-priced; four costs are still estimates |
| **B6** | Free credits renewed monthly, forever           | **Closed.** One-time grant; the renewal job is now an audit                                                |
| **B7** | In-memory limiter, ineffective on Vercel        | **Closed.** Postgres-backed, shared across instances                                                       |

**Still open:** B3 (worker never run in production), B4, B8, B9 (Sprint 5),
B11–B13 (Sprint 6), B14 (Sprint 7).

---

## 21.2 Schema and migration

**Migration:** `prisma/migrations/20260814000000_financial_safety/`
**Applied to production:** **No.** Pre-flight steps are in `docs/OPERATIONS.md` § 6.

| Change                                                                              | Why                                                |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| `CreditReason` gains `GENERATION_RESERVATION`, `_CAPTURE`, `_RELEASE`               | The lifecycle. Additive; old reasons keep working  |
| `CHECK (users."creditBalance" >= 0)`                                                | Backstop behind the conditional update             |
| New table `budget_usage`                                                            | The breaker's input, readable inside a transaction |
| New table `rate_limit_buckets`                                                      | Counters shared across serverless instances        |
| `credit_transactions` indexes on `(generationId, reason)` and `(userId, createdAt)` | The release lookup and the billing history         |

**Balance preservation.** No balance is rescaled and no allowance is changed.
Any negative balance — expected: none, since no generation has run in
production — is written off to zero _before_ the constraint is added, with a
`MANUAL_ADJUSTMENT` ledger row per account. The insert is keyed
`sprint4-clamp:{userId}` and guarded by `ON CONFLICT DO NOTHING`, so the whole
migration is safe to rerun.

---

## 21.3 The credit lifecycle

```
        +-- reserve --+                 balance -= cost, in the SAME
        |             |                 transaction that creates the
    submit         (fails)              generation row
        |             +--> 402, generation row rolled back
        v
  provider.submit()
        |
        +-- accepted --> capture --> amount-0 row; spend counter += estimate
        |                            from here it is BILLABLE
        |
        +-- rejected --> release --> balance += cost, in full
                                     (refused if a capture row exists)
```

**Reserving debits immediately** rather than holding a separate `reserved`
column. One number moves, `balance = SUM(amount)` stays true at every instant,
and a user cannot spend the same credits twice while a job is in flight.

**Capture writes `amount: 0`.** It changes no balance. It records the moment a
reservation stopped being reversible, without mutating the immutable row that
created it.

**Post-capture failures are not refunded automatically.** Replicate bills for
GPU time whether or not the output was usable, so refunding there means paying
for the run _and_ returning the money — a guaranteed loss, worst on the models
failing most. Those generations surface through `listCapturedFailures()` and are
refunded by hand as a `MANUAL_ADJUSTMENT`. This is a deliberate policy change
from Sprint 6's unconditional refund, and the comparison table's "automatic
refund on provider failure" row was rewritten to match.

---

## 21.4 Idempotency

Every financial mutation carries a unique key. Not an `if` somebody remembers to
write — a database constraint, because the callers are webhooks, pollers and
three browser tabs on the same job, all of which retry by design.

| Key                         | At most one per | On collision                                   |
| --------------------------- | --------------- | ---------------------------------------------- |
| `reserve:{generationId}`    | generation      | `already_reserved`, treated as success         |
| `capture:{generationId}`    | generation      | `false`, safe for a poller to call             |
| `release:{generationId}`    | generation      | `released: false`, balance unchanged           |
| `signup-grant:{clerkId}`    | account, ever   | Grant refused — this is what makes it one-time |
| `invoice:{stripeInvoiceId}` | invoice         | Existing balance returned                      |
| `sprint4-clamp:{userId}`    | account         | Migration rerun writes nothing                 |

---

## 21.5 Spending controls

| Threshold | Level                  | Effect                                       |
| --------: | ---------------------- | -------------------------------------------- |
|      $100 | `review`               | Logged only                                  |
|      $175 | `alert`                | Logged only                                  |
|      $225 | `free_stopped`         | Free-plan generations on paid providers      |
|      $275 | `expensive_restricted` | Video, everyone                              |
|      $350 | `nonessential_paused`  | Upscale, background removal                  |
|      $425 | `economical_only`      | Video and free usage; cheap images still run |
|      $475 | `emergency`            | Everything                                   |
|      $500 | ceiling                | Never reached; $475 exists so it is not      |

Paid customers keep working until $425 — a subscriber whose generations stop has
been sold something undelivered, while a throttled free user has lost nothing
they paid for.

**Manual switches**, all environment-only so no request can reach them:
`ATHEOS_KILL_SWITCH`, `ATHEOS_FREE_GENERATION_DISABLED`,
`ATHEOS_DISABLED_PROVIDERS`, `ATHEOS_DISABLED_MODELS`.

**Fail-safe:** an unreadable `budget_usage` row yields `emergency`, not
`normal`. A breaker that cannot see its input assumes the worst.

### The spend figure is honest about what it is

There is **no automatic provider spend synchronisation**, and none was faked.
The breaker reads the sum of three things:

- `budget_usage.spentMicroUsd` — our own estimate, accumulated on capture
- `budget_usage.manualBaselineMicroUsd` — a per-month operator correction
- `ATHEOS_MANUAL_SPEND_USD` — what the operator read off the invoice

Our estimate is built from cost figures that are mostly inferred rather than
invoiced, so it can read low. The manual terms are what correct it, without a
deploy. Wiring Replicate's billing API is **Sprint 5**.

---

## 21.6 Rate limiting and concurrency

Counters live in `rate_limit_buckets`, incremented by one atomic upsert. The
previous `Map` was per-instance, so the effective limit was the configured one
multiplied by the instance count — and it loosened under load.

**Redis was not adopted.** It is a second paid dependency on the budget this
system exists to protect, and one Postgres upsert per request is well inside
Supabase's capacity at this scale. The trade, and Upstash as the documented
upgrade (roughly $0–10 a month), are in `docs/OPERATIONS.md` § 8.

| Plan    | At once | Per minute | Per hour |
| ------- | ------: | ---------: | -------: |
| Free    |       1 |          3 |       10 |
| Creator |       3 |         12 |       60 |
| Pro     |       5 |         20 |      200 |
| Studio  |       8 |         40 |      500 |

**Concurrency is the free tier's real defence.** A limit of twelve a minute
permits twelve _simultaneously_, which is the audit's § 9 Critical finding. A
cap of one turns a burst into a queue.

**Fail mode is per policy.** Generation, enhancement, billing and sign-up fail
**closed** with a 5-second `Retry-After`; reads fail **open**, degrading to
per-instance counting. A limiter that gives up during a database incident is
the one an attacker is waiting for.

---

## 21.7 Unresolved provider-cost assumptions

**This is the honest gap, and it is why B5 is only partially closed.**

| Model                           | Cost basis     | Verification                             | Enabled |
| ------------------------------- | -------------- | ---------------------------------------- | ------- |
| `replicate/video-gen`           | $0.020/s       | **verified** (invoice, 2026-08-13)       | Yes     |
| `replicate/video-pro`           | $0.054/s       | **verified** (invoice, 2026-08-13)       | Yes     |
| `replicate/flux-schnell`        | $0.003/output  | estimated (list price)                   | Yes     |
| `replicate/flux-dev`            | $0.025/output  | estimated (list price)                   | Yes     |
| `replicate/real-esrgan`         | $0.0023/output | estimated (list price)                   | Yes     |
| `replicate/remove-bg`           | $0.0015/output | estimated (list price)                   | Yes     |
| `openai/gpt-image-1`            | $0.040/output  | estimated (list price)                   | Yes     |
| `replicate/music`               | $0.003/s       | estimated (run time, **not an invoice**) | Yes     |
| `replicate/sfx`                 | $0.002/s       | estimated (run time, **not an invoice**) | Yes     |
| `google/gemini-2.5-flash-image` | **none**       | **unknown**                              | **No**  |

### What follows from that

- **The credit value is $0.005**, derived from the most expensive enabled model
  at a 3× margin — not chosen to make a plan look generous. Deriving it from the
  worst unit outward is the direction that cannot produce a negative margin.
- **Two models were re-priced**: `flux-dev` 12 → 13 credits (2.4× → 2.6×) and
  `gpt-image-1` 16 → 20 (2.0× → 2.5×). Both were under the floor, and the test
  suite is what found them.
- **No existing balance changed.** The rate was picked to fit the catalogue
  rather than rescaling the catalogue to fit a round rate, so the 100 credits in
  an account today buy what they bought yesterday and no backfill was needed.
- **Paid credit allowances are `null`.** Provisional figures — Creator 500, Pro
  1,800, Studio 4,800 — are recorded server-side with their arithmetic, and the
  pricing page prints "Credit allowance confirmed at launch" instead of a
  number. A credit count on a pricing card is what a customer counts against
  later.
- **The audio costs are the weakest.** They come from watching how long a run
  took, not from a bill. If they are wrong by 3× they are still inside their
  margin; by 8× they are not.

Closing this needs about **$0.40**: one metered run per unverified model, then
`checked` and `verification` updated. `tests/unit/model-costs.test.ts` fails if a
corrected cost pushes a model under its floor — which is the signal to raise its
credit price, not to lower the floor.

---

## 21.8 Free-tier abuse — what is and is not solved

One grant per **account** is not one grant per **person**, and nothing here
pretends otherwise. A Clerk user id is available to anybody with an email
address, and disposable addresses are free.

| Signal                    | Status    | Worth                                                  |
| ------------------------- | --------- | ------------------------------------------------------ |
| Unique email              | Clerk     | Stops the laziest duplication; `+` aliasing defeats it |
| Bot detection             | Clerk     | Stops naive automation                                 |
| Sign-up rate limit per IP | **Added** | 5/hour — an afternoon's farm becomes a month's         |
| Free concurrency cap of 1 | **Added** | Caps any single account's burst value                  |
| No video on Free          | **Added** | Caps unit value: about $0.18 worst case per account    |
| Global spend breaker      | **Added** | Caps the aggregate — the number that matters           |

The last row is the real answer. Per-person identity is not achievable without
measures this product should not take: device fingerprinting, phone
verification, or a card from somebody who has not agreed to pay. So the design
does not make each account unprofitable to farm — it makes the **total**
bounded. A thousand farmed accounts cannot pass $225, because at $225 free
generation stops.

**Deliberately not built:** IP-based grant denial (one NAT blocks a whole
office), email-domain blocklists (stale weekly, catch real users), any
fingerprinting.

**Cheapest remaining improvement:** require a verified email before generating.
Recommended for Sprint 5 rather than smuggled in here.

---

## 21.9 Verification

| Check              | Result                               |
| ------------------ | ------------------------------------ |
| `prettier --check` | clean                                |
| `eslint`           | clean                                |
| `tsc --noEmit`     | clean                                |
| `vitest`           | 33 files, **407 passing, 3 skipped** |
| `next build`       | compiled successfully                |

**The 3 skipped are the parallel-concurrency tests**, and the run says so in the
reporter output rather than hiding it:

> `NOT VERIFIED — TEST_DATABASE_URL is unset, so the parallel tests were
skipped; only the sequential proof in credit-ledger.test.ts ran`

PGlite is a single connection, so genuinely simultaneous transactions cannot be
exercised there. What **was** verified against real Postgres, sequentially: the
conditional UPDATE affects zero rows on an insufficient balance; twenty attempts
at 90 credits against 100 leave exactly one success and a balance of 10; the
CHECK constraint rejects an unguarded decrement; and every idempotency key
collides on its second insert.

To run the parallel proof:

```bash
docker run --rm -e POSTGRES_PASSWORD=x -p 5433:5432 postgres:16
```

```bash
TEST_DATABASE_URL=postgres://postgres:x@localhost:5433/postgres npx vitest run tests/db
```

---

## 21.10 Recommended Sprint 5

**In priority order.**

1. **Close B3 — the worker has never run in production.** Set
   `WORKER_TRIGGER_SECRET`, confirm the cron fires, and watch one video
   generation complete with the browser closed. Everything else in this file
   assumes jobs finish.
2. **Measure the seven unverified costs.** About $0.40 and one afternoon. Then
   set the paid credit allowances, flip the three plans from `launch_disabled`
   to `active`, and delete "confirmed at launch" from the pricing page.
3. **Stripe, end to end (B4).** Products, prices, webhook secret; one test
   transaction that grants credits exactly once; refunds and disputes clawing
   back (B8).
4. **Replicate spend synchronisation.** Replace the manual baseline with the
   billing API so the breaker reads a real number.
5. **Clerk production instance (B9).**
6. **Email verification before generating** — the cheapest remaining free-tier
   defence.
7. **Admin spending panel.** The breaker's state is only visible in logs today.

**Not Sprint 5:** R2 lifecycle (B11), Sentry (B12), signed URLs (B13), mobile
Studio (B14).
