# Cost Engine Report — Sprint 21

**Goal:** a production-ready billing engine — persist every generation cost,
track the units behind it, and report on it.

**Status:** built, and the aggregation is verified against real Postgres.
**255 tests passing**, 15 of them new.

**One requirement could not be met as written:** organisation usage. There is no
organisation in this product. What that means, and what I built instead, is
below.

---

## The gap this closes

Sprint 19 added `costMicroUsd`, `latencyMs` and the token columns, and its own
report closed with:

> **Nothing writes the telemetry columns yet.** The migration and the manager's
> `latencyMs` exist; `services/generation.ts` still needs to persist them. Until
> then, this sprint's persistence work is a schema with nothing in it.

That is now closed. `settleSuccess` writes cost and units **inside the same
transaction** as the status change — a generation that is SUCCEEDED but has no
cost row is a hole in the margin report that nothing will ever fill, because the
provider response is gone by then.

---

## Two numbers that must never be confused

|             | What it is                                                  | Where it lives                                 |
| ----------- | ----------------------------------------------------------- | ---------------------------------------------- |
| **Credits** | What a _user_ spent. A product abstraction, ours to define. | `credit_transactions` — the append-only ledger |
| **Cost**    | What _we_ paid a vendor, in micro-USD.                      | `generations.costMicroUsd`                     |

Margin is the gap between them. `PROJECT_AUDIT.md` recorded that the gap was
invisible, and that a product priced in credits with an unknown provider cost
"can be sold enthusiastically at a loss, and the enthusiasm is what makes the
loss large".

They are deliberately **not** unified into one ledger. Mixing supplier costs
into the credit ledger would make "explain this balance" ambiguous, and that
ledger's entire purpose is that it can answer exactly that.

---

## What is tracked

| Requirement   | Column                             | Notes                                                  |
| ------------- | ---------------------------------- | ------------------------------------------------------ |
| Credits Used  | `creditsCost`                      | Existed since Sprint 6                                 |
| Provider Cost | `costMicroUsd`                     | Sprint 19; **now written**                             |
| Profit Margin | derived                            | `revenue − cost`, computed not stored                  |
| Tokens        | `promptTokens`, `completionTokens` | **See the caveat below**                               |
| GPU Time      | `gpuTimeMs`                        | **New.** Distinct from `latencyMs` and from wall-clock |
| Image Count   | `imageCount`                       | **New.** Derived from assets actually stored           |
| Video Seconds | `videoSeconds`                     | **New.** Summed from output durations                  |
| Audio Seconds | `audioSeconds`                     | **New.** Recorded although nothing generates audio yet |

**Every new column is nullable with no default.** A video job has no image
count; defaulting it to `0` makes "zero images" and "not an image job"
indistinguishable inside a `SUM`, which is exactly the kind of quiet wrongness a
billing report must not have.

`audioSeconds` exists now despite audio not being implemented, because adding it
later means a second migration on a table that will be much larger by then.

**Counts come from what was stored, not what was requested.** A model that
returned three images when four were asked for costs three, and a report built
on the request would overstate it.

### The token caveat, carried forward

Sprint 19 found that `GenerationJob` has no field for token usage, and that
adding one is an interface change that sprint forbade. The columns exist; they
will stay null until the provider contract gains a field. That is unchanged, and
it is a real conflict between two requirements rather than an oversight.

---

## Reporting — `services/billing/usage.ts`

| Function            | Answers                                                        |
| ------------------- | -------------------------------------------------------------- |
| `usageTotals`       | Credits, cost and every unit, for a set of users over a period |
| `marginReport`      | The above plus revenue, gross and margin ratio                 |
| `dailyUsage`        | A row per day, **including empty days**                        |
| `monthlyUsage`      | A row per calendar month, including empty months               |
| `organizationUsage` | Totals for a set of members — see below                        |
| `costByProvider`    | Which vendor is the bill                                       |

### Three decisions that keep the numbers honest

**Only `SUCCEEDED` generations count.** A failed job was refunded, so counting
it as usage would double-count a refund the ledger already made. Tested from
both directions.

**Unknown cost is `null`, never zero — and the report says how many rows it
could price.** `costedGenerations` alongside `totalGenerations` is what lets a
reader tell "we spent $12" from "we spent $12 on the third of the jobs we can
price". A `SUM` that silently treats nulls as zero makes an unpriced model look
like the most profitable thing in the catalogue.

**Margin is null unless _every_ generation in the period is priced.**
`costComplete` gates it. A partial cost figure produces a flattering ratio, and
a flattering ratio nobody knows is partial is worse than no ratio at all.

**Empty periods are zero-filled.** A chart drawn from sparse rows silently
rescales its x-axis, so a quiet week and a busy one look identical.

### Aggregation is in Postgres

Every function is a `GROUP BY` bounded by a caller-supplied date range. Sprint
16 moved the admin daily series out of a JavaScript loop for exactly this
reason: producing thirty numbers should not transfer thirty thousand rows.

---

## Organisation usage — the requirement I could not meet as written

**There is no organisation in this product.** No `Organization` model, no
membership table, and Clerk's organisations are not wired up. `docs/DECISIONS.md`
defers teams and shared workspaces until there is demand from paying single
users.

Building one here would mean a schema, a membership model, an invitation flow
and a permission model — a teams feature delivered inside a billing sprint,
none of it asked for and all of it then needing maintenance.

**What I did instead:** every reporting function is **set-based**. It takes
`userIds`, not a `userId`. So the reporting half of organisation usage is
finished and correct _today_ — the same function serves one person, a team, or
the whole platform. `organizationUsage` takes the members explicitly and returns
their rollup plus a member count.

The only missing piece is something that can answer _"who is in this
organisation"_, and that is one function whenever teams exist. That seemed a
better answer than either ignoring the requirement or inventing a teams feature
to satisfy it.

---

## Verification

```
tsc --noEmit                 CLEAN
eslint . --max-warnings 0    CLEAN
prettier --check             CLEAN
vitest                       255 passing (17 files)
```

`tests/db/usage-reporting.test.ts` — 15 tests against **real Postgres**, chosen
for the failures that produce a _believable_ wrong answer:

- Failed, cancelled, running and retrying jobs are all excluded.
- Period boundaries are half-open: `>= from AND < to`. An inclusive upper bound
  would count September's first moment in both August and September.
- `COUNT("costMicroUsd")` does not drift into `COUNT(*)` — swapping them would
  silently claim every generation was priced.
- An unpriced vendor sorts **last** via `NULLS LAST`, not first as the cheapest.
- Set-based scoping actually sums across users, which is what makes org rollup
  work.

### What is not verified

- **`usage.ts` itself.** As with the worker queue, the SQL is duplicated into
  the test rather than imported, because Prisma cannot be pointed at PGlite.
  This proves the queries are correct, not that the application sends them.
- **`settleSuccess` writing cost.** It needs a database Prisma can reach.
  Typechecked only.
- **Every cost figure is an estimate.** `COST_BASIS` was checked against
  published pricing in 2026-08 and has never been reconciled against an invoice.

---

## Remaining gaps

| #   | Gap                                                                                                                                                                                                                     | Severity                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | **No organisation entity.** Reporting is ready; membership is not.                                                                                                                                                      | High (as a requirement) |
| 2   | **`gpuTimeMs` is never written.** The column exists; no adapter reports billable compute, and `ProviderModel` has no field to carry it. Same interface constraint as tokens.                                            | High                    |
| 3   | **Tokens will stay null** until the provider contract gains a field.                                                                                                                                                    | Medium                  |
| 4   | **Cost figures unreconciled** against a vendor invoice.                                                                                                                                                                 | Medium                  |
| 5   | **No UI.** These are service functions; the admin dashboard does not call them. Out of scope here, and worth stating so nobody assumes a screen exists.                                                                 | Medium                  |
| 6   | **Nine of eleven providers have no cost basis**, so any period touching them reports `costComplete: false` and no margin. Correct behaviour, and it means margin is unavailable in practice until those adapters exist. | High                    |
| 7   | **No spend alerting.** Nothing notices a provider getting more expensive.                                                                                                                                               | Medium                  |

Item 6 is the one to understand: the engine is correct and will refuse to report
a margin, because refusing is the honest answer while most of the catalogue is
unpriced. It becomes useful as adapters and their cost bases land.

---

## Honest summary

The engine is real: cost is now written where it was previously a schema with
nothing in it, four new unit columns explain _why_ a bill moved, and the
aggregation is verified against actual Postgres including the cases that produce
plausible wrong answers.

Two things stop it being useful yet, and neither is a defect in this sprint's
work: **most of the catalogue has no cost basis**, so margin correctly reports
as unavailable; and **there is no organisation to roll usage up to**, so the
set-based reporting is waiting on a concept that does not exist.
