# Staged migration — connector idempotency

**Status: written, and rehearsed by generating its SQL. Not applied to any
database, and not present in `prisma/schema.prisma`** — the model was added
there only long enough to produce the script below, then reverted, so the
committed tree has no schema drift and `prisma migrate status` stays clean.
Applying it is a separate, explicit decision.

## What it is for

`confirm_generation` has to satisfy four rules. Three of them already work
today, and the fourth is why this exists.

| Rule                                                      | Today                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Token replayed → refused                                  | **Works.** The generation's primary key is derived from the token itself, so a second confirm collides on it. |
| Two concurrent confirms → one reservation, one generation | **Works.** Same collision, resolved by Postgres.                                                              |
| Same key + same request → the _same_ generation returned  | **No.** Nothing maps an idempotency key to a generation row.                                                  |
| Same key + _different_ request → `idempotency_conflict`   | **No.** Without recording what the key was used for, a reuse is indistinguishable from a retry.               |

The last two need to remember something across requests. The first two do not,
which is worth stating plainly: **this migration is not what stops
double-charging.** Double-charging is already impossible. This is what lets the
API answer a retry correctly instead of merely refusing it.

## Why a table rather than a column

A column on `Generation` — `idempotencyKey String? @unique` — is smaller and
reuses the pattern the credit ledger already uses. It was the first option
considered and it cannot express the fourth rule: with only the key stored, a
caller reusing a key for a different request is indistinguishable from one
retrying the same request, so the honest answer would have to be a generic
conflict rather than `idempotency_conflict`.

A separate table also keeps a short-lived operational concern out of the row
that represents a customer's work. Generations are kept forever; idempotency
records are only interesting for as long as a client might retry, and having
them expire is easier when they are not a column on something permanent.

## The migration

```prisma
/// One connector confirmation, remembered so a retry is answered rather than
/// merely refused.
///
/// `requestHash` is what distinguishes a retry from a reuse: the same key with
/// the same hash is the same call arriving twice and gets the same generation
/// back; the same key with a different hash is a client bug and gets
/// `idempotency_conflict`.
model ConnectorIdempotency {
  key    String
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// Stable hash of the normalised request — public model id, settings,
  /// outputs, prompt hash, quoted price. Never the prompt itself.
  requestHash String

  /// The generation this key produced, so a retry returns it rather than
  /// creating another.
  generationId String?
  generation   Generation? @relation(fields: [generationId], references: [id], onDelete: SetNull)

  createdAt DateTime @default(now())
  /// Retention horizon. A key older than this is not worth remembering, and
  /// keeping them forever turns a retry aid into an audit surface nobody asked
  /// for.
  expiresAt DateTime

  /// Scoped per user, deliberately. Two customers may pick the same key —
  /// "1", "retry" — and neither should be able to see or collide with the
  /// other's, or to discover that a key is in use.
  @@id([userId, key])
  @@index([expiresAt])
  @@map("connector_idempotency")
}
```

`Generation` and `User` each gain the back-relation Prisma requires. No column
on `Generation` changes, and no existing row is touched: this is additive.

## Rehearsal

The model was added to `prisma/schema.prisma`, validated, and diffed against
the schema as committed:

```bash
npx prisma migrate diff --from-schema <committed> --to-schema <with-model> --script
```

No database was touched — `migrate diff` between two schema files needs none.
The script it produced, verbatim:

```sql
-- CreateTable
CREATE TABLE "connector_idempotency" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_idempotency_pkey" PRIMARY KEY ("userId","key")
);

-- CreateIndex
CREATE INDEX "connector_idempotency_expiresAt_idx" ON "connector_idempotency"("expiresAt");

-- AddForeignKey
ALTER TABLE "connector_idempotency" ADD CONSTRAINT "connector_idempotency_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_idempotency" ADD CONSTRAINT "connector_idempotency_generationId_fkey"
  FOREIGN KEY ("generationId") REFERENCES "generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

One `CREATE TABLE`, one index, two foreign keys. **No `ALTER` against an
existing table and no row rewritten** — which is the property that makes this
safe to apply during traffic, and the reason it was worth generating the script
rather than assuming.

The schema was reverted immediately afterwards.

## Applying it

Not yet. It needs, in order:

1. Sign-off on the table rather than the column.
2. `npm run db:generate` and a green suite against the isolated test schema.
3. `DIRECT_URL` — **not** `DATABASE_URL`. Migrations run through the pooler
   work in development and deadlock in production; that is written down in
   `CLAUDE.md` and is not a footnote.

## What it does not do

It does not make `confirm_generation` safe on its own. The reservation, the
release on failure and the refund on undelivered output are all existing ledger
behaviour and are unchanged by this. If this table were dropped tomorrow, the
worst outcome is that a retry gets a refusal instead of the original
generation — not a double charge.
