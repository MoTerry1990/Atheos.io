# Database Report — Sprint 25

**Scope:** Phase 3. Schema, relations, indexes, constraints, migrations.
**Result:** the schema is the strongest asset in this project. **No changes were
needed and none were made.** No migrations are missing. No fake data was created.

---

## Schema inventory

Counted from `prisma/schema.prisma` today.

| Object                   | Count  |
| ------------------------ | ------ |
| Models                   | **17** |
| Enums                    | **11** |
| `@relation` declarations | 26     |
| `@@index`                | 35     |
| `@@unique`               | 3      |
| Field-level `@unique`    | 10     |
| Composite `@@id`         | 5      |

Reconciled against the applied SQL across all four migrations:

| Object                    | In migrations |
| ------------------------- | ------------- |
| `CREATE [UNIQUE] INDEX`   | **48**        |
| `FOREIGN KEY` constraints | **23**        |

35 `@@index` + 3 `@@unique` + 10 `@unique` = 48. **Exact match.** The index count
is not approximately right; it reconciles.

---

## Migrations

Four, all present, all previously applied in order to real Postgres (PGlite) and
introspected.

| Migration                             | Adds                                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| `0_init`                              | 16 baseline tables, 11 enums, the full FK and index set     |
| `20260802000000_generation_telemetry` | Latency, provider and token columns on `generations`        |
| `20260803000000_worker_queue`         | `generation_logs`, lease and lock columns for the queue     |
| `20260804000000_usage_metrics`        | `costMicroUsd`, `gpuTimeMs`, image/video/audio unit columns |

**Nothing is missing, so nothing was generated.** Phase 3 said to generate
migrations if any were absent; the schema and the migration chain agree, so
generating one would have produced an empty diff or, worse, a spurious fifth
migration that `migrate deploy` would then insist on.

> **Use `prisma migrate deploy`, never `migrate dev`.** `migrate dev` will try to
> create a fifth migration against an empty shadow database. The four that exist
> are the deployment artefact.

---

## What is proven, not argued

50+ behavioural assertions run against real Postgres in `tests/db/`. Structure
("an index exists") is not behaviour ("the second insert is actually rejected"),
and behaviour is what the product's correctness rests on.

**Idempotency — the guarantees money depends on**

- Replaying a webhook event id is rejected by the primary key.
- Reusing a credit `idempotencyKey` is rejected; a `null` one does not collide.

**Referential integrity**

- An asset cannot reference a non-existent user.
- A generation's lineage parent must exist.
- `follows` self-referencing FKs both resolve to users.

**Delete behaviour — deliberate per foreign key**

- `SET NULL`: deleting a generation **keeps its ledger row**, nulled. A financial
  record that vanished with the thing it paid for would not be a ledger.
- `CASCADE`: deleting a user removes everything across all six owned tables.

**Concurrency**

- `FOR UPDATE SKIP LOCKED` gives two concurrent workers disjoint job sets with
  no work lost and no job claimed twice.

**Aggregation correctness**

- Period boundaries are half-open (`>= from AND < to`), so a month boundary is
  not counted in both months.
- `COUNT("costMicroUsd")` does not drift into `COUNT(*)` — swapping them would
  silently claim every generation was priced.
- An unpriced vendor sorts last via `NULLS LAST`, not first as the cheapest.

---

## Design decisions worth preserving

**Credits are an append-only ledger.** `User.creditBalance` is a cached sum
written in the same transaction as the entry that changed it. A balance you can
only mutate is a balance you cannot audit or refund.

**External systems own their own truth.** Clerk owns identity, Stripe owns
billing state. Rows here are mirrors reconciled by webhook, never the place a
conflict is resolved.

**Generations and assets are separate tables.** One generation produces many
assets, an asset outlives the generation's metadata, and an upload has no
generation at all.

**Two connection strings, deliberately.** `DIRECT_URL` (port 5432) for Migrate,
which needs a real session to run DDL and hold advisory locks; `DATABASE_URL`
(port 6543, transaction pooler) for runtime, because serverless opens and
discards connections. Setting them to the same value will fail at migration
time — see `ENVIRONMENT_TEMPLATE.md`.

---

## Open issues

| #   | Issue                                                                                                                                                                                                                                                                | Severity |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **The schema has never been applied by Prisma's own migration machinery.** Verified against PGlite, which is real Postgres; `migrate deploy` against a provisioned database remains a genuine first.                                                                 | High     |
| 2   | **15 of 31 `findMany` calls are unbounded.** Most are bounded by an already-paginated caller — a real distinction, and one nothing verifies.                                                                                                                         | High     |
| 3   | **No backups and no tested restore.** Provision-time concern, not a schema one, and absolute before real user data exists.                                                                                                                                           | High     |
| 4   | **No `pg_trgm` index.** `contains` search is a sequential scan; fine at fixture scale, not at 100k rows.                                                                                                                                                             | Medium   |
| 5   | **`assets.thumbnailKey` exists and nothing writes it**, so galleries serve full-size originals.                                                                                                                                                                      | Medium   |
| 6   | **No organisation entity.** Usage reporting is already set-based (`userIds`, not `userId`) so the reporting half is done; there is nothing to roll up to.                                                                                                            | Medium   |
| 7   | **Service-layer coverage is near zero** for `services/community` (955 lines) and `services/projects` (742). Both need a database Prisma can reach — PGlite cannot be a Prisma target. A Postgres-backed harness is the single highest-leverage test investment left. | Medium   |

Item 1 is the one that matters at launch. Everything about this schema is
correct in a way that has been demonstrated rather than asserted — against an
engine that is genuinely Postgres, but not against the deployment path.
