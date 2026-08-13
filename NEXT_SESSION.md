# Next Session — Plan

Written at the end of the session that put Atheos.io live. Everything below is
either a known bug, a measurement we need before deciding something, or a
decision waiting on that measurement.

---

## Where things stand

**https://atheos-io.vercel.app** — live, and the product works end to end.

|            | Status                                                 |
| ---------- | ------------------------------------------------------ |
| Database   | ✅ Supabase, `us-west-2`, 17 tables, 4 ms from the app |
| Storage    | ✅ Cloudflare R2, verified with real uploads           |
| Auth       | ✅ Clerk, real instance                                |
| AI — image | ✅ FLUX Schnell + Real-ESRGAN upscale, both proven     |
| AI — video | ✅ wan-2.2-t2v-fast, real 720p clip stored in R2       |
| Billing    | ❌ Stripe placeholder key, nothing purchasable         |

**Proven by running it, not by reading it:** credits debit before the provider
call, exactly one refund on failure, assets land in R2 under the user's id, the
ledger reconstructs the balance.

---

## Bugs found tonight (all fixed, listed so they are not re-found)

1. **`markSucceeded` did not settle.** The worker marked jobs SUCCEEDED without
   downloading output, writing to R2, creating asset rows or recording cost.
   Six sprints old, invisible because the worker had never run. Now uses
   `settleSuccess`, shared with the client path.
2. **Video sent `aspect_ratio`** to a model that takes `size`. Every video
   failed with an opaque `E002`.
3. **wan-2.5-t2v-fast is broken on Replicate.** Proved it with a bare
   `{"prompt": "a cat walking"}` straight to their API. Swapped to 2.2.
4. **10s video sent 161 frames** against a 121 maximum. Introduced by the fix
   for (2).

Three of the four were payload bugs that typecheck cannot catch. **The provider
layer has no integration tests** — `AI_PROVIDER_REPORT.md` predicted this in
Sprint 19 and tonight proved it.

---

## Work, in order

### 1. Clerk webhook — blocks everything user-facing

Without it a sign-up creates a Clerk user and **no database row, no credits**.
The app shows "Finishing setup" forever. Tonight's user row was inserted by hand.

- Clerk → Webhooks → `https://atheos-io.vercel.app/api/webhooks/clerk`
- Events: `user.created`, `user.updated`, `user.deleted`
- Signing secret → Vercel env `CLERK_WEBHOOK_SIGNING_SECRET` → redeploy
- **Verify by signing up with a second email** and confirming the row and grant

### 2. Cost tracking — blocks every pricing decision

`costMicroUsd: 0` and `videoSeconds: null` on the video generation. **The cost
engine currently believes video is free**, so any margin report is fiction.

- Add a cost basis for `replicate/video-gen`
- Record `videoSeconds` on settlement
- Cross-check against the real Replicate balance

### 3. Video model comparison — blocks the 10-second promise

Current model caps at **121 frames ≈ 7.5s**. A "10 second" free tier cannot be
honoured with it.

Test for length, quality and cost:

| Model                  | Runs | Note                   |
| ---------------------- | ---- | ---------------------- |
| `google/veo-3-fast`    | 209k | 8s, Google's own       |
| `minimax/video-01`     | 743k | most used on Replicate |
| `lightricks/ltx-video` | 177k | fast, cheaper          |

### 4. Plan gating and pricing

Once 2 and 3 are done, real numbers exist. Proposed ladder:

| Tier    | Price  | Credits | $/credit | Videos | Images |
| ------- | ------ | ------- | -------- | ------ | ------ |
| Free    | —      | 100     | —        | 1      | 25     |
| Starter | $5     | 300     | $0.0167  | 3      | 75     |
| Creator | $15    | 1,000   | $0.0150  | 11     | 250    |
| Studio  | $35.99 | 3,000   | $0.0120  | 33     | 750    |

**Per-credit price must fall as tiers rise.** A first draft had $5/500 and
$15/1000, which made the middle tier worse value per credit than the cheapest —
nobody upgrades into that.

Margins at ~$0.15/video and ~$0.003/image: **~83% across all three paid tiers**,
after Stripe's 2.9% + $0.30.

Open questions for that session:

- Is 90 credits per 7.5s clip too steep? 60 gives Starter 5 videos, still ~78%.
- Free tier: one-time grant (built) or monthly reset (not built, needs a
  scheduled job and costs ~$0.23/user/month **forever**)?
- Video on free at all? It is 65% of the free tier's cost.

### 5. Then Stripe

Real key, products, prices, webhook. Nothing before this point requires it.

---

## Longer videos — the honest position

**No text-to-video model produces 1–2 minutes in one call.** The ceiling is
5–10 seconds across every vendor; it is a coherence and memory limit, not a
product decision.

Long AI video is **stitched**: N clips generated separately and concatenated.
Building it here means a storyboard UI, N generations, and server-side ffmpeg.
A full session's work, and the natural direction for a faceless-video product.

Cost check first: at 90 credits a clip, a 60-second stitched video is ~9 clips =
**810 credits ≈ $16** and ~18 minutes of rendering.

---

## Security housekeeping — overdue

Every one of these appeared in a chat log and should be rotated:

- [ ] Replicate API token
- [ ] R2 secret access key
- [ ] Supabase database password (update both connection strings after)
- [ ] Delete `vercel-env-PASTE-THIS.txt` from the Desktop — plain text, OneDrive-synced

Already done: the Vercel API token was revoked.

---

## Still open from RELEASE.md

- **No CI running** — the workflow exists at `.github/workflows/ci.yml` and has
  never run against a push
- **No error tracking** — Sentry is an afternoon and this product spends money
  per generation
- **Nothing polls `/api/health`** — the endpoint exists, no monitor watches it
- **No provider integration tests** — tonight's whole class of bug
- **Rate limiter is per-process** — N Vercel instances means N× the limit
- **No content moderation, no legal pages, no account deletion** — all required
  before opening to the public
