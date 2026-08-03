# AI Engine

**Sprint 18.** The layer that turns "eleven vendors" into one interface.

---

## Read this first

**Two providers are implemented. Nine are declared and unreachable.**

`services/ai/catalogue.ts` records all eleven with a `status` field, and the
registry offers only `implemented` ones. A declared provider cannot be selected,
cannot be billed for, and cannot fail at submit — it is a commitment to an
interface, not a claim of support.

That number is asserted by a test, so it cannot drift from this document:

```ts
expect(
  implementedProviders()
    .map((p) => p.id)
    .sort(),
).toEqual(["openai", "replicate"]);
```

Writing nine adapters against APIs I cannot call would produce nine plausible
guesses that typecheck and fail on first contact. The engine around them is
real, tested, and ready for each adapter as it is written — that is the useful
half, and it is the half that does not need vendor credentials.

**The two "implemented" adapters have still never called their vendor.** All
five Replicate model versions are `PLACEHOLDER_*` and rejected at submit. This
document describes an engine, not a running system.

---

## Architecture

```
                      ┌────────────────────────┐
 services/generation  │   Provider Manager     │  ← the only entry point
    (the pipeline) ──▶│   manager.ts           │
                      └───────────┬────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
      ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
      │ health.ts    │    │ retry.ts     │    │ catalogue.ts │
      │ circuit      │    │ backoff +    │    │ who exists,  │
      │ breaker      │    │ classify     │    │ who is wired │
      └──────────────┘    └──────────────┘    └──────────────┘
                                  │
                      ┌───────────▼────────────┐
                      │  registry.ts           │  model → adapter
                      └───────────┬────────────┘
                                  │
        ┌─────────────┬───────────┼───────────┬─────────────┐
        ▼             ▼           ▼           ▼             ▼
   replicate.ts   openai.ts    mock.ts    (fal.ts)     (runway.ts)
    implemented  implemented   fallback    declared      declared

      pricing.ts  → what we charge (credits)
      cost.ts     → what we pay    (micro-USD)
```

**The rule, unchanged since Sprint 0:** nothing outside `services/ai` imports a
vendor SDK, and nothing outside it branches on which provider is in use. Users
never touch a provider API; they submit a `GenerationRequest` in our vocabulary
and the manager decides everything else.

---

## The eleven providers

| Provider      | Status          | Families                 | Env var               | Priority |
| ------------- | --------------- | ------------------------ | --------------------- | -------- |
| Replicate     | **implemented** | image, video             | `REPLICATE_API_TOKEN` | 10       |
| OpenAI        | **implemented** | image, multimodal        | `OPENAI_API_KEY`      | 20       |
| Fal           | declared        | image, video             | `FAL_API_KEY`         | 30       |
| Google Gemini | declared        | image, video, multimodal | `GOOGLE_AI_API_KEY`   | 40       |
| Anthropic     | declared        | **multimodal only**      | `ANTHROPIC_API_KEY`   | 50       |
| Runway        | declared        | video                    | `RUNWAY_API_KEY`      | 60       |
| Luma          | declared        | video                    | `LUMA_API_KEY`        | 70       |
| Kling         | declared        | video                    | `KLING_API_KEY`       | 80       |
| Minimax       | declared        | video                    | `MINIMAX_API_KEY`     | 90       |
| Hailuo        | declared        | video                    | `HAILUO_API_KEY`      | 100      |
| Pika          | declared        | video                    | `PIKA_API_KEY`        | 110      |

**Anthropic is deliberately not listed as an image or video provider.** Its
models reason about images; they do not generate them. Listing it under `image`
would let the fallback resolver route a generation to a vendor that cannot serve
it — a bug that would only appear during an outage, which is the worst time to
find it. There is a test asserting this specifically.

Priority is **operational** preference — catalogue breadth and observed
reliability — not price. Price lives in `cost.ts`. Mixing them would make a
cheap-but-flaky vendor the default.

---

## The eight components

### 1. Provider Manager — `manager.ts`

The single entry point. `submitWithResilience()` does, in order:

1. **Resolve** the model to its adapter.
2. **Check the circuit.** Open → do not even try.
3. **Submit.** Success records health, closing a half-open circuit.
4. **On failure**, classify: retry the _same_ provider, or fall back, or throw.

**Retry-then-fallback, in that order.** A transient blip resolves on the model
the user actually chose. Switching vendors on the first hiccup would silently
change what they get.

### 2. Generation Queue

**The queue is the existing job model, not a new one.** `Generation` rows carry
`status`, `providerJobId` and `provider`; submit-then-poll is the queue, and it
predates this sprint.

What Sprint 18 adds is that the manager records which provider actually ran and
every attempt along the way, so a job's history is answerable.

**What is still missing, and it matters:** the _runner_ is the browser. A job
whose tab closes stops advancing. Sprint 14 and the audit both named this; it is
unchanged, and it is the largest remaining gap in the engine. The manager is
written so that a server-side worker calling `submitWithResilience` and
`pollWithHealth` on a schedule is a drop-in — no call site changes.

### 3. Retry Logic — `retry.ts`

Driven by the **normalised error code**, never by a vendor's message. Eleven
vendors describe a rate limit eleven ways; this file knows about one.

| Code                           | Retry?      | Why                                     |
| ------------------------------ | ----------- | --------------------------------------- |
| `rate_limited`                 | yes, slowly | The request is fine; we asked too fast  |
| `provider_unavailable`         | yes         | Their problem, likely transient         |
| `timeout`                      | yes         | Unknown, not wrong                      |
| `unknown`                      | yes         | Cheap to try, expensive to assume fatal |
| `content_filtered`             | **no**      | The same prompt is refused again        |
| `invalid_request`              | **no**      | Still invalid                           |
| `unsupported_operation`        | **no**      | Still unsupported                       |
| `insufficient_provider_credit` | **no**      | Our account, not their capacity         |

**Full jitter, not plain exponential.** When a provider 429s everyone at once,
plain backoff makes every client retry at the same instant — reproducing the
overload that caused the 429. Full jitter spreads them.

An adapter may be **more pessimistic** than this table (its `retryable: false`
wins) and may **not** be more optimistic — otherwise a vendor could talk us into
retrying a content filter forever. Both directions are tested.

### 4. Fallback Provider

Constrained deliberately:

- **Never across families.** A video request cannot land on an image-only vendor.
- **Never to the mock.** Handing someone a placeholder they paid for is worse
  than failing.
- **Never by default.** `allowFallback` is opt-in, because falling back runs a
  _different model_ and produces a different image.
- **Always reported.** `SubmitOutcome.fellBack` and `.attempts` exist so the
  interface can say a generation ran elsewhere. A substitution the user is not
  told about is not resilience.

### 5. Credit Tracking

Unchanged and already correct: the append-only ledger from Sprint 6, with
`idempotencyKey` making refunds exactly-once. Verified against real Postgres in
`tests/db/schema.test.ts`.

The manager throws `ProviderUnavailableError` rather than refunding itself —
only `services/generation.ts` knows whether credits were debited yet.

### 6. Cost Tracking — `cost.ts` (new)

`PROJECT_AUDIT.md` recorded that unit economics were unmeasurable: we could see
revenue and usage, and not whether a generation made or lost money.

Two currencies, deliberately not unified:

- **Credits** — a product abstraction, ours to define.
- **Cost** — real money, in **micro-USD**. Per-image costs are genuinely
  sub-cent, so cents would round most of the catalogue to zero. Integers,
  because floating-point money is how a ledger stops adding up.

**A model with no recorded basis reports `null`, never zero.** Assuming zero is
how a loss-making model looks like the most profitable one in the table.

These figures are **estimates** and the type says so. Vendor prices change
without notice and vary by account; the authoritative number is the invoice, and
nothing reconciles against one.

### 7. Generation History

Unchanged. `Generation` rows with self-referencing lineage (`parentId`) for
variations and upscales. What is new is `SubmitOutcome.attempts`, which records
every provider tried — the data a support conversation actually needs.

### 8. Provider Health Monitor — `health.ts` (new)

A circuit breaker, three states:

- **closed** — normal.
- **open** — 3 consecutive provider-side failures. Requests refused instantly.
- **half-open** — after a 60s cooldown, exactly **one** probe is allowed.

**Half-open is the important state.** Without it, the moment the cooldown
expires every queued request hits a provider that may still be down and knocks
it over again.

**Only provider failures count.** A content filter is evidence one request was
bad, not that the vendor is unwell. Counting those would open the breaker on a
healthy provider because a user wrote a prompt it refused.

**A failed probe re-opens immediately — one strike, not three.** Making a
known-bad provider earn three more failures would send two more users into it.

---

## Adding a provider

1. Add a descriptor to `PROVIDER_CATALOGUE` with `status: "declared"`.
2. Write `services/ai/providers/<id>.ts` implementing `AIProvider`:
   `isConfigured`, `listModels`, `submit`, `poll`, and optionally `cancel`.
   Map every vendor error onto a `ProviderErrorCode` — that mapping is what the
   retry policy and the breaker consume.
3. Add cost basis entries to `COST_BASIS`.
4. Register it in `REAL_PROVIDERS`.
5. Flip `status` to `"implemented"`.

Step 5 is what makes it reachable. Until then the engine treats it as
non-existent, which is the correct treatment for an adapter nobody has run.

---

## What is tested

**43 new tests, all passing.**

| Suite                                        | Tests | Covers                                                                           |
| -------------------------------------------- | ----- | -------------------------------------------------------------------------------- |
| `tests/unit/ai-engine.test.ts`               | 33    | Catalogue invariants, retry classification, backoff, breaker state machine, cost |
| `tests/integration/provider-manager.test.ts` | 10    | Retry-before-fallback, fallback constraints, circuit skipping, attempt trail     |

Assertions worth naming:

- A declared provider is **never** returned as a fallback candidate.
- A video request never resolves to an image-only provider.
- The breaker ignores `content_filtered` entirely but still counts it in totals.
- A failed half-open probe re-opens the circuit on the first failure.
- After a circuit opens, the primary adapter is **not called at all**.
- Cost is `null` for an unpriced model, and `formatMicroUsd(null)` is
  `"unknown"`, not `"$0.00"`.

---

## Honest gaps

| #   | Gap                                                                                                                                                           | Severity |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **Nine adapters unwritten.** Declared and unreachable.                                                                                                        | High     |
| 2   | **No adapter has ever called its vendor.** Replicate's model versions are all `PLACEHOLDER_*`.                                                                | High     |
| 3   | **The job runner is still the browser.** A closed tab stalls a generation. The manager is shaped for a server-side worker; the worker does not exist.         | High     |
| 4   | **Cost is never persisted.** `RecordedCost` defines the shape; there is no column and no migration. Margin cannot be reported until there is.                 | High     |
| 5   | **Health is in-memory, per process.** Behind N instances a dead provider is discovered N times. `HealthStore` exists so a shared implementation is a drop-in. | Medium   |
| 6   | **Cost figures are unverified estimates**, checked against published pricing in 2026-08 and never reconciled against an invoice.                              | Medium   |
| 7   | **`pollWithHealth` resolves a provider by finding any model it owns** — correct today, wrong the moment a provider is registered with no models.              | Low      |
| 8   | **No per-provider rate limiting.** Sprint 15's limiter protects _our_ endpoints; nothing budgets our request rate _to_ a vendor.                              | Medium   |

---

## What changed in the code

**New:** `catalogue.ts`, `retry.ts`, `health.ts`, `cost.ts`, `manager.ts`.
**Unchanged:** `types.ts` — the Sprint 0 contract absorbed all eleven providers
without modification, which is the strongest evidence available that it was
worth defining up front.

`registry.ts` is also unchanged. The manager sits above it rather than replacing
it, so existing callers keep working while `services/generation.ts` migrates to
`submitWithResilience` — which is follow-up work, not done here.
