# Worker Report — Sprint 20

**Goal:** move AI generation to server-side workers, so a job survives the user
closing their browser.

**Status:** the queue, the state machine, the lease recovery, the logs and the
webhooks are built and — for the parts that can be — verified against real
Postgres. **240 tests passing**, 37 of them new.

**The gap that remains:** `services/generation.ts` still contains the old
client-driven path. The worker owns jobs _once it is running_; wiring the studio
to stop driving them is the last step and it is not done. Details at the end.

---

## What this replaces

Since Sprint 7 the browser has been the job runner. It submitted, then polled,
and a closed tab stopped a generation advancing until somebody reopened the
studio. Every report since — the audit, Sprint 14, Sprint 16, AI_ENGINE.md —
named it as the largest structural gap in the product.

The fix is not "poll harder". It is that a **server-side worker owns the job**.
The studio still polls, but now it is _reading_ a job the server owns rather
than _driving_ one, and closing the tab changes nothing about whether the work
completes.

---

## The queue is Postgres

There is no Redis, no SQS and no broker here, and adding one to run a few
thousand jobs a day would be infrastructure to operate for no benefit. Postgres
does this correctly, and the jobs are already rows — a separate queue would mean
two systems that can disagree about whether a generation exists.

**The honest trade:** this does not scale to millions of jobs a minute. It
scales a very long way past where this product is, and when it stops, the claim
function is the only thing that changes.

### `FOR UPDATE SKIP LOCKED` is the whole design

The failure it prevents: two workers select the same QUEUED row, both submit it
to a provider, and **the user is charged twice for one generation**.

A plain `SELECT ... WHERE status='QUEUED'` followed by an `UPDATE` has exactly
that race. `SKIP LOCKED` makes the read itself exclusive — a row another
transaction holds is _invisible_ rather than blocking — so two concurrent
workers see disjoint sets and neither waits.

This is the one piece that cannot be verified by reading it. **It is verified
against real Postgres**, with two genuinely concurrent claims over 20 jobs:

```
✓ never gives the same job to two concurrent workers
    overlap: []          ← zero jobs claimed twice
    union:   20 of 20    ← and no work lost
```

Both halves matter. Zero overlap with 10 jobs claimed would mean `SKIP LOCKED`
was silently dropping work.

---

## The six states

| State          | Meaning                                          |
| -------------- | ------------------------------------------------ |
| `QUEUED`       | Accepted, waiting for a worker                   |
| `RUNNING`      | A worker holds the lease                         |
| **`RETRYING`** | Failed transiently; another attempt is scheduled |
| `SUCCEEDED`    | Complete ("Completed" in the brief)              |
| `FAILED`       | Terminal failure; credits refunded               |
| `CANCELED`     | Cancelled by the user                            |

**`RETRYING` is new and deliberately distinct from `QUEUED`.** A job waiting for
its first run and a job waiting out a backoff look identical in a status column
and are not the same thing. Merging them hides a rising retry rate — which is
the earliest signal of a provider outage, and the one number worth watching.

Backoff lives in `nextAttemptAt` on the row, not in a sleeping process. That is
the only form that survives a worker restart.

---

## Leases, not locks

A claimed job records `lockedAt` and `lockedBy`. If a worker dies mid-run — a
deploy, an OOM, a serverless timeout — nothing releases the claim.

So a claim is a **lease**: any RUNNING job whose `lockedAt` is older than five
minutes is reclaimable. Without it, one crashed worker strands a job in RUNNING
permanently and the user waits forever for something nobody is doing.

Three details that are easy to get wrong, all tested:

- **`heartbeat` is scoped by `lockedBy`.** A worker that has already lost its
  lease must not extend it, or two workers would both believe they own the job.
- **`startedAt` uses `COALESCE` on reclaim.** Overwriting it would make every
  reclaim look like a fresh start and destroy the real duration.
- **A live lease is not reclaimable.** Tested from both sides, because a
  too-eager reclaim submits a running job to a provider twice.

---

## Persistence

### Progress

`progress` is 0–100, **null where the provider does not report it**. Never
invented. A progress bar that moves on a timer rather than on real information
makes a promise about completion time that nothing is keeping.

### Logs — a new `generation_logs` table

Persisted rather than written to stdout, because these answer "what happened to
my generation" — asked by a user, days later, about a job nobody was watching.
`console.log` cannot answer that.

`context` is JSONB so it stays queryable: _"show me jobs where Replicate timed
out"_ is the question it exists to serve. Cascade-deleted with the generation —
log context carries prompts, and orphaned rows would be personal data nobody can
reach to delete.

`log()` **never throws**. A failure to write a log line must not fail the job it
is describing.

### Timestamps

`createdAt`, `startedAt`, `completedAt`, `nextAttemptAt`, `lockedAt`, plus
`attemptCount`. Combined with Sprint 19's `latencyMs` and `attempts`, a job's
whole history is answerable from the row.

---

## Webhook callbacks

The studio polls, which is fine for a browser. An API caller cannot hold a
connection open for four minutes of video generation.

**Every delivery is signed.** HMAC-SHA256 over `timestamp.body`, in the same
header shape Stripe uses. The timestamp is inside the signed material — signing
the body alone would make a captured delivery valid forever.

We are on the _receiving_ side of exactly this arrangement with Stripe and
Clerk, and those verifications are why the credit ledger is safe. It would be
strange to demand that of our vendors and not offer it ourselves.

**Without `WEBHOOK_SIGNING_SECRET` we refuse to deliver** rather than sending
unsigned. An unsigned callback is one a receiver cannot trust, and sending it
teaches them to accept unsigned ones.

### The SSRF guard is the important part

A webhook URL is attacker-supplied and we fetch it from inside our own network.
That is the textbook shape of server-side request forgery: point a webhook at
`http://169.254.169.254/` and we fetch cloud instance credentials on the
attacker's behalf.

`isDeliverableUrl` is an **allowlist of shapes**, not a blocklist of addresses —
a blocklist has to enumerate every private range and every encoding of
localhost. HTTPS only, no loopback in any form, no RFC1918, no link-local, no
`.internal`/`.local`, no IPv6 unique-local. `redirect: "manual"`, because a 302
to an internal address bypasses a guard that only checks the original URL.

Tested including the case a naive filter gets wrong: `172.32.0.1` is **public**
and must not be blocked by a `startsWith("172.")`.

**Known hole, stated rather than hidden:** a public hostname whose DNS resolves
to a private address still passes. Closing it needs resolution-time checking
via a custom agent.

---

## Running the worker

The worker is a **function**, `runTick()`. `POST /api/worker/tick` is one way to
call it; a container running `node worker.mjs` in a loop is another. Both call
the same function, so the deployment target is not decided here.

A tick claims up to 5 jobs, advances each once, and returns — it does not loop
until the queue drains. Bounded because the caller may be a serverless function
with a hard deadline. Progress is proportional to tick frequency, which is a
knob an operator can turn.

**Two ticks racing is safe and expected.** `SKIP LOCKED` means a second
concurrent tick sees the jobs the first did not take. That is what makes it safe
to over-schedule the cron.

### The trigger is authenticated

`WORKER_TRIGGER_SECRET`, compared in constant time. Without it the endpoint
**refuses to run** rather than defaulting to open — an unauthenticated worker
trigger is a free way for a stranger to make us do work, and the work submits
jobs to paid providers.

It answers **404, not 401**, for the same reason as the admin surface (§ 38): a
401 confirms the endpoint exists and is worth attacking.

---

## Verification

```
tsc --noEmit                 CLEAN
eslint . --max-warnings 0    CLEAN
prettier --check             CLEAN
next build                   SUCCESS
vitest                       240 passing (16 files)
```

| Suite                           | Tests | What it proves                                                                                                              |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| `tests/db/worker-queue.test.ts` | 17    | Claim atomicity under concurrency, retry scheduling, lease expiry, log persistence and cascade, indexes                     |
| `tests/unit/webhooks.test.ts`   | 20    | HMAC depends on body, timestamp and secret; constant-time compare survives length mismatch; SSRF guard across 20 URL shapes |

**A test I fixed rather than deleted:** `migrations.test.ts` asserted "16
tables" and failed when this sprint added `generation_logs`. That is the wrong
signal — a new table is normal, a _missing_ one is the disaster. It now asserts
the sixteen baseline tables **by name**.

### What is not verified

- **`runTick` end to end.** It needs a database Prisma can reach, and Prisma
  cannot be pointed at PGlite. The queue SQL underneath it is verified; the
  orchestration around it is not.
- **The claim test duplicates the SQL** rather than importing it. It proves the
  query is correct, not that the application sends that query. Closest available
  verification, and worth stating plainly.
- **No webhook has ever been delivered.** Signing and URL filtering are tested;
  the `fetch` is not.

---

## Remaining gaps

| #   | Gap                                                                                                                                                                                         | Severity |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **`services/generation.ts` still drives jobs from the client.** The worker can own a job, but nothing has stopped the old path. Until that migration, both exist.                           | **High** |
| 2   | **Nothing schedules the tick.** No `vercel.json` cron, no container. The endpoint waits to be called.                                                                                       | High     |
| 3   | **`runTick` is untested end to end** — see above.                                                                                                                                           | High     |
| 4   | **Webhook retries have no backoff.** Five attempts, one per tick, no spacing. A receiver that is down for an hour exhausts its attempts in five minutes.                                    | Medium   |
| 5   | **DNS-rebinding SSRF is open** — a public hostname resolving to a private address.                                                                                                          | Medium   |
| 6   | **A cancelled job is not cancelled at the provider.** `cancelJob` marks the row; the provider keeps working and we keep paying. `AIProvider.cancel` exists and the worker does not call it. | Medium   |
| 7   | **No dead-letter handling.** A job that fails permanently is FAILED and refunded, but nothing surfaces a pattern of them.                                                                   | Medium   |
| 8   | **Lease is a fixed five minutes** for every job. A fast image model holds it far longer than needed after a crash.                                                                          | Low      |

Item 1 is the one that matters: **this sprint built the worker but did not
finish moving traffic to it.** The infrastructure is real and tested; the
cutover is a change to `services/generation.ts` that its own scope did not
include, and claiming the client-driven path is gone would be false.

---

## Honest summary

The queue is real and its hardest property — no double-claim under concurrency —
is proven against actual Postgres rather than argued. Lease recovery, retry
scheduling, persisted logs and signed callbacks are all built and tested.

What is not done is the cutover. **A job can now be owned by a server-side
worker; generation does not yet go through one.** Anyone reading "workers are
complete" as "closing the tab is now safe" would be reading too much into it —
that becomes true when item 1 is done, and item 2 gives the worker a heartbeat.
