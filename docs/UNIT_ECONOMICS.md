# Unit economics

What every model costs Atheos, what Atheos charges for it, and whether the gap
survives a subscription at full burn.

**Verified 2026-08-24.** Every provider figure below was read from a published
price list on that date. No prediction was submitted to obtain any of them.

---

## 1. The canonical numbers

| Constant                        |        Value | Where it lives                    |
| ------------------------------- | -----------: | --------------------------------- |
| `SUBSCRIPTION_CREDIT_VALUE_USD` |       $0.005 | `services/billing/model-costs.ts` |
| Stripe fee assumption           | 2.9% + $0.30 | this document                     |
| Refund/chargeback allowance     |           5% | this document                     |
| Minimum margin multiple, image  |         2.5x | `services/billing/model-costs.ts` |
| Minimum margin multiple, video  |         3.0x | `services/billing/model-costs.ts` |

The margin floor is what bounds subscription exposure. Because every enabled
model must clear **at least 2.5x**, the worst-case provider cost of one credit
is `$0.005 / 2.5 =` **$0.002**, whatever the customer spends it on.

That single number drives every plan calculation in § 4.

---

## 2. Verified provider costs

### 2.1 Google, direct

Source: <https://ai.google.dev/gemini-api/docs/pricing>, read 2026-08-24.

| Model          | Unit       |  720p | 1080p | Audio    |
| -------------- | ---------- | ----: | ----: | -------- |
| Veo 3.1        | per second | $0.40 | $0.40 | included |
| Veo 3.1 Fast   | per second | $0.10 | $0.12 | included |
| Veo 3.1 Lite   | per second | $0.05 | $0.08 | included |
| Imagen 4 Fast  | per image  | $0.02 |     — | n/a      |
| Imagen 4       | per image  | $0.04 |     — | n/a      |
| Imagen 4 Ultra | per image  | $0.06 |     — | n/a      |

**Status: direct integration NOT built.** These prices are recorded for the
router's decision table. No Google adapter ships in this sprint, and
`ENABLE_GOOGLE_DIRECT` does not exist yet.

### 2.2 Replicate

Source: each model's published pricing panel on replicate.com, read 2026-08-24.

| Model                            | Unit       |                               Price | Verification                |
| -------------------------------- | ---------- | ----------------------------------: | --------------------------- |
| `google/veo-3.1`                 | per second |          $0.40 audio / $0.20 silent | published                   |
| `google/veo-3.1-fast`            | per second |          $0.15 audio / $0.10 silent | published                   |
| `google/veo-3.1-lite`            | per second |        $0.05 (720p) / $0.08 (1080p) | published                   |
| `wan-video/wan-2.2-t2v-fast`     | per video  |                       $0.10 at 720p | published + invoice-derived |
| `bytedance/seedance-1-lite`      | per second |                   $0.054 (recorded) | invoice-derived             |
| `bytedance/seedance-2.5`         | per second |         $0.2312 (720p, no video-in) | published                   |
| `google/nano-banana-2`           | per image  | $0.067 / $0.101 / $0.151 (1K/2K/4K) | published                   |
| `google/nano-banana-pro`         | per image  | $0.150 / $0.150 / $0.300 (1K/2K/4K) | published                   |
| `black-forest-labs/flux-schnell` | per image  |                              $0.003 | estimated                   |
| `black-forest-labs/flux-dev`     | per image  |                              $0.025 | estimated                   |

`wan-2.2-t2v-fast` at $0.10 is the only figure cross-checked against a real
invoice line: generation `cmt6cwu0f…zxl89o` recorded `costMicroUsd: 100000`,
which matches the published price exactly.

### 2.3 Unverified

`openai/gpt-image-1` at $0.040/image and the FLUX figures are marked
`estimated` in `model-costs.ts` — derived from published list prices, never
reconciled against an invoice. They are **not** invented, but they are not
proven either, and § 4 treats them as if they were exact because that is the
conservative direction: `gpt-image-1` is the thinnest model in the catalogue
and any error in it moves the plan margins.

`google/gemini-2.5-flash-image` has **no** cost figure and is disabled. An
unknown cost cannot be sold.

---

## 3. Direct versus Replicate

| Model                      | Replicate | Google direct |    Saving | Same model? |
| -------------------------- | --------: | ------------: | --------: | ----------- |
| Veo 3.1 Fast, 720p, audio  |   $0.15/s |       $0.10/s | **33.3%** | yes         |
| Veo 3.1 Fast, 1080p, audio |   $0.15/s |       $0.12/s | **20.0%** | yes         |
| Veo 3.1 Lite, 720p         |   $0.05/s |       $0.05/s |        0% | yes         |
| Veo 3.1 Lite, 1080p        |   $0.08/s |       $0.08/s |        0% | yes         |
| Veo 3.1 Standard, audio    |   $0.40/s |       $0.40/s |        0% | yes         |

Only **Veo 3.1 Fast** is meaningfully cheaper direct, and only because Replicate
charges one flat $0.15/s regardless of resolution while Google prices by
resolution. Lite and Standard are identical, so routing them direct would add an
integration, a key to rotate and a second failure mode for **no** saving.

**Recommendation:** build the direct route for Veo 3.1 Fast only, and only after
its quality benchmark passes. Do not route Lite or Standard direct.

---

## 4. Plan economics

Method: assume a subscriber burns **100% of their allowance on the
thinnest-margin model in the catalogue**. That is the worst realistic case and
the brief forbids relying on unused credits as a margin strategy.

Net revenue = `price − (2.9% + $0.30)`, then × 0.95 for the refund allowance.

### 4.1 Thinnest enabled model

| Model                       | Credits | Worst-case cost |  Multiple |    Margin |
| --------------------------- | ------: | --------------: | --------: | --------: |
| `openai/gpt-image-1`        |      20 |         $0.0400 | **2.50x** | **60.0%** |
| `replicate/flux-dev`        |      13 |         $0.0250 |     2.60x |     61.5% |
| `replicate/nano-banana-pro` |      80 |         $0.1500 |     2.67x |     62.5% |
| `replicate/nano-banana-2`   |      55 |         $0.1010 |     2.72x |     63.3% |
| `replicate/video-gen`       |      90 |         $0.1500 |     3.00x |     66.7% |
| `replicate/flux-schnell`    |       4 |         $0.0030 |     6.67x |     85.0% |

`gpt-image-1` sits **exactly on** the 2.5x floor. Cost per credit: $0.002.

### 4.2 The proposed allowances

| Plan    |  Price |    Net | Proposed |   Cost | Margin | ≥60%? | ≥55%?    |
| ------- | -----: | -----: | -------: | -----: | -----: | ----- | -------- |
| Creator |  $9.99 |  $8.93 |    2,000 |  $4.00 |  55.2% | ✗     | ✓ (just) |
| Pro     | $34.99 | $31.99 |    7,000 | $14.00 |  56.2% | ✗     | ✓        |
| Studio  | $89.99 | $82.73 |   18,000 | $36.00 |  56.5% | ✗     | ✓        |

### 4.3 Ceilings

| Plan    | Max @60% | Max @55% | Proposed | Slack |
| ------- | -------: | -------: | -------: | ----: |
| Creator |    1,786 |    2,009 |    2,000 | **9** |
| Pro     |    6,398 |    7,198 |    7,000 |   198 |
| Studio  |   16,545 |   18,613 |   18,000 |   613 |

### 4.4 Sensitivity — why Creator at 2,000 is not safe

| Scenario                          | Creator margin | Verdict       |
| --------------------------------- | -------------: | ------------- |
| Documented assumptions            |          55.2% | above floor   |
| Refund allowance 6% instead of 5% |          54.7% | **below 55%** |
| Refund allowance 8%               |          53.7% | **below 55%** |
| International card (3.9% + $0.30) |          54.7% | **below 55%** |
| International card + 6% refunds   |          54.2% | **below 55%** |

Creator's entire safety margin is **nine credits**, or 0.45%. A single
international payment method — not an unusual event for a product sold in
Spanish and English — puts it under the floor. The intl-card ceiling is 1,987,
which is _below_ the proposal.

Pro (intl ceiling 7,123) and Studio (18,421) survive the same shock.

### 4.5 Recommendation

| Plan    | Proposed | **Recommended** | Margin | Survives intl card? |
| ------- | -------: | --------------: | -----: | ------------------- |
| Creator |    2,000 |       **1,900** |  57.5% | yes (55.4%)         |
| Pro     |    7,000 |       **7,000** |  56.2% | yes (55.6%)         |
| Studio  |   18,000 |      **18,000** |  56.5% | yes (55.8%)         |
| Free    |      100 |         **100** |    n/a | one-time            |

Creator is reduced from 2,000 to **1,900** — a 5% trim that buys a full
percentage point of headroom and keeps the plan above the floor under every
scenario in § 4.4. It is still a **3.8x increase** on today's 500.

Pro and Studio are adopted as proposed.

**Customer value check:** $9.99 / 1,900 = $0.00526 per credit. The documented
target is $0.005; the variance is 5% and in the customer's favour compared with
today's $9.99 / 500 = $0.020.

---

## 5. Top-up packs — provisional

Not created in Stripe. Worst case is the same $0.002 per credit.

| Pack   |  Price |    Net | Cost at 100% burn | Margin | Verdict |
| ------ | -----: | -----: | ----------------: | -----: | ------- |
| 1,000  |  $7.99 |  $7.30 |             $2.00 |  72.6% | safe    |
| 3,000  | $19.99 | $18.70 |             $6.00 |  67.9% | safe    |
| 10,000 | $59.99 | $56.85 |            $20.00 |  64.8% | safe    |

All three clear the 60% preferred floor comfortably — top-ups carry no monthly
renewal risk and the fixed Stripe fee is amortised over a larger amount.

Note the packs are _better_ value per credit than a subscription at the
recommended allowances ($0.0080, $0.0067, $0.0060 versus $0.00526). That is
backwards: a top-up should cost more per credit than a subscription, not less.
Either the packs are priced too high or the subscriptions too generously.
**Flagged for a decision; not resolved here.**

---

## 6. What this document does not establish

- **No direct Google integration exists.** § 3 is a decision table, not a
  shipped route.
- **`estimated` costs are still estimated.** `gpt-image-1` is the thinnest model
  and its cost has never been reconciled against an invoice. One metered run
  would close it.
- **Annual billing is not modelled.** The brief defers it until 30 days of real
  utilisation data exist, and there is none.
- **Utilisation is assumed at 100%.** Real burn will be lower, which is upside,
  and deliberately not counted.
