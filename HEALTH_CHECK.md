# Health Checks

**Phase 4 · Final Sprint** — per-provider health verification.

Two endpoints, deliberately separate, plus a live probe result for every
provider taken today.

---

## `/api/health` — new in this sprint

Public, unauthenticated, for uptime monitors.

```
GET /api/health   →  200 healthy   |   503 unhealthy
```

**The status code is the contract.** Monitors alert on codes, not bodies — one
that has to parse JSON to notice an outage will miss one. The body is for a
human already looking.

**Live result from this environment:**

```json
HTTP 503
{
  "status": "unhealthy",
  "dependencies": [
    { "name": "database", "ok": false, "probed": true, "latencyMs": 12 },
    { "name": "auth",     "ok": true,  "probed": false },
    { "name": "billing",  "ok": false, "probed": false },
    { "name": "storage",  "ok": false, "probed": false },
    { "name": "ai",       "ok": true,  "probed": false }
  ]
}
```

That 503 is **correct** — there is no database. The endpoint is working
precisely by refusing to claim health it cannot verify.

### Three design decisions worth keeping

**Only the database can fail the check.** An unconfigured Stripe or a mock AI
provider is reported honestly but does not return 503: the pages render and a
visitor can still sign up. Paging someone at 3am about an intentional state is
how a monitor gets muted, which is worse than not having one.

**No configuration detail is returned.** `ok: true|false` and nothing else — no
versions, no variable names, no remedies. The admin view's value is exactly the
detail it gives; published unauthenticated, that detail is a map of how the
deployment is misconfigured.

**Only the database is genuinely probed.** Contacting Clerk, Stripe and R2 on
every poll would make thousands of vendor calls a day to learn what a local
check already knows, and would eventually trip their rate limits.

---

## `/api/admin/status` — pre-existing, admin only

The diagnostic view. Same dependencies, but with the detail a human needs:

| Level          | Meaning                                        |
| -------------- | ---------------------------------------------- |
| `ok`           | Working                                        |
| `degraded`     | Works, but something is missing that will bite |
| `down`         | Not usable                                     |
| `unconfigured` | Deliberately not set up                        |

It returns remedies — _"No webhook signing secret — new sign-ups will not create
user rows"_ — which is why it requires an admin session and `/api/health` does
not.

`unconfigured` as a level distinct from `down` is the good idea in this design:
a Stripe that was never set up is not an outage, and reporting it as red trains
people to ignore red.

---

## Per-provider status, probed today

| Provider          | Method            | Result              | Detail                                                                                                                    |
| ----------------- | ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Replicate**     | Live API call     | ✅ **VERIFIED**     | Authenticated as `moterry1990`. Submission reached the billing gate (402) — token, version hash and payload all accepted  |
| **Clerk**         | Live browser load | ❌ **DOWN**         | Publishable key points at `placeholder-not-a-real-instance.clerk.accounts.dev`; the dev handshake 400s `/` and `/explore` |
| **Supabase**      | `SELECT 1`        | ❌ **DOWN**         | No instance. `/api/health` returns 503 on this alone                                                                      |
| **Stripe**        | Config check      | ⛔ **UNCONFIGURED** | Placeholder key. **Zero API calls ever made**                                                                             |
| **Cloudflare R2** | Config check      | ⛔ **UNCONFIGURED** | All four variables missing. `isStorageConfigured()` false                                                                 |

**Replicate is the only provider that has ever been contacted successfully** —
and that happened in this sprint, for the first time in the project's history.

---

## The circuit breaker

`services/ai/health.ts` implements per-provider health independent of the
endpoints above: three states (`closed` → `open` → `half-open`), a failure
threshold, and a single probe request before closing again.

Two behaviours worth knowing:

- **`insufficient_provider_credit` counts as a failure that opens the circuit.**
  Correct — an unfunded account will not fix itself by being retried, and
  hammering it delays the alert without spending anything useful.
- **The store is in-memory and per-process.** On Vercel's horizontal scaling
  each instance discovers a dead provider separately. `HealthStore` exists as an
  interface so Redis is one implementation and no call-site changes.

---

## Gaps

| #   | Gap                                                                                                                                                                               | Severity |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **No external monitor is polling `/api/health`.** The endpoint exists; nothing watches it. Better Stack or UptimeRobot, 5 minutes                                                 | High     |
| 2   | **Circuit-breaker state is per-process** — N instances rediscover the same outage N times                                                                                         | High     |
| 3   | **No alerting on any of this.** Health is observable and unobserved; see `MONITORING.md`                                                                                          | High     |
| 4   | **Clerk, Stripe and R2 are config-checked, not probed.** A revoked Stripe key reports `ok` until a real call fails. Deliberate (see above), and it means "configured" ≠ "working" | Medium   |
| 5   | **No historical record.** Each call is a point in time; nothing stores a series, so "was it down at 3am" is unanswerable                                                          | Medium   |

Item 1 is the one to close on launch day. The endpoint was the missing piece and
now exists; pointing a monitor at it is a five-minute job that converts every
future outage from _"a user told us"_ into _"we knew first"_.
