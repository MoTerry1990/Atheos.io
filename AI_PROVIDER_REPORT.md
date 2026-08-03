# AI Provider Report — Sprint 19

**Goal as stated:** replace every placeholder adapter with real production
integrations, for eleven providers.

**What I actually delivered:** the shared production infrastructure every
adapter needs, persistence for cost and telemetry, the eight-function engine
surface, and **one new adapter**. Not eleven.

This report explains that gap rather than dressing it up, and flags two places
where the sprint's own requirements contradict each other.

---

## Two contradictions in the brief

### 1. The eight methods vs. "do not change the provider interface"

> Every provider should expose: `generateImage()`, `generateVideo()`,
> `generateAudio()`, `generateText()`, `uploadAsset()`, `getStatus()`,
> `cancelGeneration()`, `estimateCost()`

> Do NOT change the provider interface. … Do not modify existing interfaces.

`AIProvider` is `isConfigured / listModels / submit / poll / cancel?`. Adding
eight methods to it _is_ changing the interface, and it would force every
adapter to stub the six its vendor does not do — the exact "five-method
interface" mistake `types.ts` was written to avoid.

**Resolved by putting the eight in `services/ai/engine.ts`**, an engine-level
facade above the Provider Manager. `AIProvider` is byte-for-byte unchanged. Each
function builds a `GenerationRequest` with the right operation and hands it to
the manager. This is the architecture AI_ENGINE.md already described — callers
talk to the engine, never to a provider — so it makes the documented boundary
real rather than implied.

Two of the eight are **deliberately rejecting stubs**:

- `generateAudio()` — no adapter generates audio. It rejects with
  `unsupported_operation` rather than pretending.
- `generateText()` — text is not a generation in this product's sense: no
  credits, no asset, no job to poll. Routing it through the image pipeline would
  give it a `Generation` row and a credit debit it has no business having.

### 2. "Persist token usage" vs. the same constraint

`GenerationJob` has no field for token usage, and adding one is an interface
change. **I caught myself smuggling it through with a cast:**

```ts
return { ...job, usage, latencyMs } as GenerationJob; // typechecks, drops both
```

That compiles, silently discards both values, and would have made "we persist
token usage" a claim nothing supported. It is now removed with the reasoning
written at the call site.

**Latency was salvageable** — the Provider Manager times `submit` from the
outside, which turns out to be the better measurement anyway because it includes
whatever the adapter does either side of its HTTP call.

**Token usage is not.** It is captured by `providerFetch`, discarded at the
adapter boundary, and the column exists but will always be null until the
interface gains a field. That is a real, unresolved conflict between two
requirements, not an oversight.

---

## What was built

### Persistence — verified against real Postgres

`prisma/migrations/20260802000000_generation_telemetry/` adds six columns and an
index to `generations`:

| Column                             | Purpose                                               |
| ---------------------------------- | ----------------------------------------------------- |
| `costMicroUsd`                     | What we paid, in millionths of a dollar               |
| `latencyMs`                        | Submit round-trip                                     |
| `promptTokens`, `completionTokens` | Token usage — **see contradiction 2**                 |
| `requestedProvider`                | What the user asked for, when the manager failed over |
| `attempts` (JSONB)                 | Every provider tried, with each error                 |

**Every column is nullable with no default.** NULL means "not recorded";
defaulting cost to 0 would make an unpriced model indistinguishable from a free
one in a margin report.

`attempts` is JSONB rather than text so a support query can filter it — "show me
generations where Replicate timed out" is the question this exists to answer.

**Verified**: `tests/db/migrations.test.ts` applies _both_ migrations in order to
PGlite and asserts columns, nullability, the JSONB type, the index, a fully
populated row, and a JSON containment query. 9 tests, all passing. This is the
first test in the project that proves a migration applies **on top of** its
predecessor — the failure a single-migration test cannot see.

### Shared provider transport — `services/ai/providers/http.ts`

The sprint asks every provider to have timeout handling, error handling,
logging, rate limiting and usage tracking. Written per adapter that is eleven
copies of five concerns. Written once, an adapter only does the genuinely
vendor-specific part: build the body, map the error.

- **Timeouts.** `fetch` has none. Without an `AbortSignal` a hung vendor
  connection holds a serverless function alive until the platform kills it —
  long after the user gave up and well after we have been billed. 30s default,
  60s for uploads.
- **Outbound rate limiting.** Sprint 15's limiter protects _our_ endpoints from
  callers; this protects _vendors_ from us, and us from the 429s and account
  suspensions that follow. The audit named the outbound half as missing.
- **Error mapping.** Status → `ProviderErrorCode`, conservative by default: an
  unrecognised 4xx is `invalid_request` and therefore **not retried**, because
  retrying a request the vendor rejected on its merits spends money to be told
  no again. 401/403 is never retried — a wrong key stays wrong, and hammering an
  auth endpoint is how a key gets suspended.
- **Logging.** One structured line per call, **with the query string stripped** —
  provider URLs carry job ids and signed parameters, and a log line is the
  easiest place for one to end up somewhere it should not.

### Google Gemini adapter — written, never executed

The one new adapter. Real code against the documented `generateContent` shape,
using the shared transport.

Decisions worth naming:

- **API key in a header, not the query string.** Google accepts `?key=`; a
  credential in a URL ends up in every log and proxy in between.
- **A 200 with no candidate is a safety block, not a success.** Gemini reports
  filtered prompts that way. Treating it as success would produce a "succeeded"
  generation containing nothing.
- **Input images are fetched and base64-encoded inside the adapter.** Gemini
  wants inline data where every other provider takes a URL. Keeping that inside
  the adapter is the whole point of the abstraction.
- **Synchronous, so the job id is ours** — with a bounded, TTL'd result cache,
  the same shape as the OpenAI adapter.

**It has never run against Google.** There is no key in this environment. It
stays `declared` in the catalogue, which makes it _unreachable_: the registry
will not offer it, so it cannot silently become anyone's default.

### Engine surface — `services/ai/engine.ts`

All eight functions, plus `providerHealth()`. Everything returns the same
`EngineResult` regardless of modality or provider — switching from image to
video changes one function name.

`uploadAsset` is a **re-export** of `storeUploadedAsset` rather than a
reimplementation. Two upload paths is two sets of size and MIME checks to keep
in agreement, and Sprint 15 hardened exactly one of them.

---

## Provider status — the honest table

| #   | Provider      | Adapter                                             | Ever executed | Catalogue status |
| --- | ------------- | --------------------------------------------------- | ------------- | ---------------- |
| 1   | OpenAI        | ✅ exists (Sprint 6)                                | ❌ never      | implemented      |
| 2   | Google Gemini | ✅ **new**                                          | ❌ never      | declared         |
| 3   | Anthropic     | ❌ none                                             | —             | declared         |
| 4   | Replicate     | ⚠️ exists, all 5 model versions are `PLACEHOLDER_*` | ❌ never      | implemented      |
| 5   | Fal.ai        | ❌ none                                             | —             | declared         |
| 6   | Runway        | ❌ none                                             | —             | declared         |
| 7   | Pika          | ❌ none                                             | —             | declared         |
| 8   | Luma          | ❌ none                                             | —             | declared         |
| 9   | Kling         | ❌ none                                             | —             | declared         |
| 10  | MiniMax       | ❌ none                                             | —             | declared         |
| 11  | Hailuo        | ❌ none                                             | —             | declared         |

**Two adapters existed before this sprint. Three exist now. None has ever called
its vendor.**

### Why not eleven

Three reasons, in order of weight:

1. **I cannot call any of these APIs.** No keys, no accounts, no network path to
   them from here. Eleven adapters would be eleven plausible guesses that
   typecheck and fail on first contact — and each would carry the _appearance_
   of support, which is worse than an honest gap because it is not countable.

2. **Three of them I would be guessing at, not writing.** Pika's API is gated
   and its shape unconfirmed. Kling requires request signing rather than a
   bearer token. Hailuo is expected to share Minimax's shape and that expectation
   is unverified. Writing these from assumption produces code that reads as
   authoritative and is not.

3. **Replicate's placeholders cannot be fixed from here.** All five `version`
   fields are `PLACEHOLDER_*` and a real Replicate version is a content hash you
   get from the account. There is no correct value I can supply. The adapter
   already rejects them loudly at submit rather than sending nonsense — which is
   the right behaviour and stays.

The infrastructure built this sprint is what makes each remaining adapter a
small, single-file job: `providerFetch` handles the five cross-cutting concerns,
`catalogue.ts` has the descriptor, and flipping `status` to `implemented` is the
whole promotion.

---

## Provider Manager — what it does automatically

Unchanged from Sprint 18 except for latency measurement, per the instruction not
to modify it.

- **Detects availability** — circuit breaker, three states, half-open probe.
- **Fails over** — same family only, never to the mock, opt-in, and **reported**
  via `fellBack` so the user can be told their generation ran elsewhere.
- **Retries** — classified by normalised error code with full jitter.
- **Standardises responses** — `EngineResult`, identical across providers.

---

## Verification

```
tsc --noEmit                 CLEAN
eslint . --max-warnings 0    CLEAN
prettier --check             CLEAN
vitest                       198 passing (13 files)
```

| Suite                                        | What it proves                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `tests/db/migrations.test.ts`                | Both migrations apply in order to real Postgres; telemetry columns are nullable, JSONB is queryable, index exists |
| `tests/unit/ai-engine.test.ts`               | Catalogue invariants, retry classification, breaker state machine, cost                                           |
| `tests/integration/provider-manager.test.ts` | Retry-before-fallback, family constraints, circuit skipping                                                       |

**What is not verified:** every line of `http.ts` and `google.ts` that touches
the network. No test mocks `fetch` for them, and a mocked test of an API shape I
guessed would only prove my guess is self-consistent.

---

## Remaining gaps

| #   | Gap                                                                                                                                                                                                                           | Severity     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | **Eight adapters unwritten**; three of those (Pika, Kling, Hailuo) need API access or documentation I do not have.                                                                                                            | High         |
| 2   | **No adapter has ever called its vendor.** Everything about real integration is unproven.                                                                                                                                     | **Critical** |
| 3   | **Replicate's five model versions are still `PLACEHOLDER_*`.** Unfixable without an account.                                                                                                                                  | High         |
| 4   | **Token usage cannot be persisted** without an interface change the sprint forbids. Columns exist and will stay null.                                                                                                         | Medium       |
| 5   | **Nothing writes the telemetry columns yet.** The migration and the manager's `latencyMs` exist; `services/generation.ts` still needs to persist them, which is a change to the pipeline this sprint's scope did not include. | High         |
| 6   | **`google.ts` result cache is process-local.** On serverless, a poll can land on an instance that never saw the submit. It fails cleanly rather than hanging, but it fails.                                                   | Medium       |
| 7   | **Outbound rate limit is one shared policy** (20/min) for every provider, borrowed from `sensitive`. Real per-vendor quotas differ by orders of magnitude.                                                                    | Medium       |

Item 5 is the one I would do next: the columns and the measurement both exist,
and until the pipeline writes them, this sprint's persistence work is a schema
with nothing in it.

---

## Honest summary

The infrastructure is real: shared transport with timeouts and outbound
throttling, verified telemetry persistence, and an eight-function engine surface
that satisfies the brief without touching the provider interface.

The integrations are not. **One new adapter, zero vendor calls, and a provider
count that went from two to three rather than to eleven.** Anyone reading
"production-ready" into this sprint would be misreading it — and the two
contradictions in the brief are worth resolving before the next attempt, because
one of them (token usage) cannot be satisfied as written.
