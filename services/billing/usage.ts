import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * The cost engine's reporting layer.
 *
 * ## Two numbers that must never be confused
 *
 *   - **Credits** are what a *user* spent. A product abstraction, ours to
 *     define, recorded in the append-only ledger.
 *   - **Cost** is what *we* paid a vendor, in micro-USD, recorded per
 *     generation.
 *
 * Margin is the gap. Reporting them from one function is what makes the gap
 * visible; `PROJECT_AUDIT.md` recorded that it was not, and that a product
 * priced in credits with an unknown provider cost "can be sold enthusiastically
 * at a loss, and the enthusiasm is what makes the loss large".
 *
 * ## Aggregation happens in Postgres
 *
 * Sprint 16 moved the admin daily series out of a JavaScript loop for exactly
 * this reason: producing thirty numbers should not transfer thirty thousand
 * rows. Every function here is a `GROUP BY`, and every one is bounded by a date
 * range the caller supplies.
 *
 * ## Unknown cost is null, never zero
 *
 * A model with no cost basis contributes `null`, and a period containing one
 * reports `costKnown: false`. Summing nulls as zero would make an unpriced
 * model look like the most profitable thing in the catalogue — which is the
 * specific way a cost report becomes worse than no cost report.
 */

export interface UsageTotals {
  /** Credits debited for generations in the period. */
  creditsUsed: number;
  /** What we paid vendors, in micro-USD. Null when nothing is priced. */
  costMicroUsd: number | null;
  /**
   * How many generations in the period had a known cost.
   *
   * Reported alongside the total so a reader can tell "we spent $12" from
   * "we spent $12 on the third of the jobs we can price".
   */
  costedGenerations: number;
  totalGenerations: number;
  /** Units of work, so a cost change can be attributed to what caused it. */
  images: number;
  videoSeconds: number;
  audioSeconds: number;
  gpuTimeMs: number;
  promptTokens: number;
  completionTokens: number;
}

export interface MarginReport extends UsageTotals {
  /** Credits × the value of a credit. Null without a credit value. */
  revenueMicroUsd: number | null;
  /** revenue − cost. Null when either side is unknown. */
  grossMicroUsd: number | null;
  /** gross ÷ revenue, 0–1. Null when revenue is zero or cost is unknown. */
  marginRatio: number | null;
  /** True when every generation in the period had a cost basis. */
  costComplete: boolean;
}

/** Rows Postgres returns from the aggregate. All bigint or null. */
interface RawTotals {
  credits: bigint | null;
  cost: bigint | null;
  costed: bigint | null;
  total: bigint | null;
  images: bigint | null;
  video: bigint | null;
  audio: bigint | null;
  gpu: bigint | null;
  prompt_tokens: bigint | null;
  completion_tokens: bigint | null;
}

const num = (value: bigint | null | undefined): number => Number(value ?? 0);

function shape(raw: RawTotals | undefined): UsageTotals {
  return {
    creditsUsed: num(raw?.credits),
    // Null, not zero, when nothing in the period had a cost basis.
    costMicroUsd:
      raw?.cost === null || raw?.cost === undefined ? null : Number(raw.cost),
    costedGenerations: num(raw?.costed),
    totalGenerations: num(raw?.total),
    images: num(raw?.images),
    videoSeconds: num(raw?.video),
    audioSeconds: num(raw?.audio),
    gpuTimeMs: num(raw?.gpu),
    promptTokens: num(raw?.prompt_tokens),
    completionTokens: num(raw?.completion_tokens),
  };
}

/**
 * Totals for a set of users over a period.
 *
 * Takes user ids rather than a single user so the same function serves an
 * individual, a team and the whole platform. See the note on organisations in
 * `organizationUsage`.
 *
 * Only `SUCCEEDED` generations count. A failed job was refunded, so charging it
 * to a usage report would double-count a refund the ledger already made.
 */
export async function usageTotals(
  userIds: readonly string[],
  from: Date,
  to: Date,
): Promise<UsageTotals> {
  if (userIds.length === 0) return shape(undefined);

  const rows = await prisma.$queryRaw<RawTotals[]>`
    SELECT
      COALESCE(SUM("creditsCost"), 0)          AS credits,
      SUM("costMicroUsd")                      AS cost,
      COUNT("costMicroUsd")                    AS costed,
      COUNT(*)                                 AS total,
      COALESCE(SUM("imageCount"), 0)           AS images,
      COALESCE(SUM("videoSeconds"), 0)         AS video,
      COALESCE(SUM("audioSeconds"), 0)         AS audio,
      COALESCE(SUM("gpuTimeMs"), 0)            AS gpu,
      COALESCE(SUM("promptTokens"), 0)         AS prompt_tokens,
      COALESCE(SUM("completionTokens"), 0)     AS completion_tokens
    FROM "generations"
    WHERE "userId" = ANY(${userIds})
      AND "status" = 'SUCCEEDED'
      AND "createdAt" >= ${from}
      AND "createdAt" < ${to}`;

  return shape(rows[0]);
}

/**
 * Totals plus margin.
 *
 * `creditValueMicroUsd` is what one credit is worth in real money, derived from
 * the plan the user is on. A parameter rather than a constant because it
 * changes with pricing, and a hard-coded value would silently make every
 * historical margin figure wrong.
 */
export async function marginReport(
  userIds: readonly string[],
  from: Date,
  to: Date,
  creditValueMicroUsd?: number,
): Promise<MarginReport> {
  const totals = await usageTotals(userIds, from, to);

  const revenueMicroUsd = creditValueMicroUsd
    ? totals.creditsUsed * creditValueMicroUsd
    : null;

  const costComplete =
    totals.totalGenerations > 0 &&
    totals.costedGenerations === totals.totalGenerations;

  // Margin is only meaningful when *every* generation is priced. A partial
  // cost figure produces a flattering ratio, and a flattering ratio nobody
  // knows is partial is worse than no ratio at all.
  const grossMicroUsd =
    revenueMicroUsd !== null && totals.costMicroUsd !== null && costComplete
      ? revenueMicroUsd - totals.costMicroUsd
      : null;

  return {
    ...totals,
    revenueMicroUsd,
    grossMicroUsd,
    marginRatio:
      grossMicroUsd !== null && revenueMicroUsd && revenueMicroUsd > 0
        ? grossMicroUsd / revenueMicroUsd
        : null,
    costComplete,
  };
}

export interface PeriodRow extends UsageTotals {
  /** `YYYY-MM-DD` for a daily row, `YYYY-MM` for a monthly one. */
  period: string;
}

interface RawPeriodRow extends RawTotals {
  bucket: Date;
}

/**
 * Usage bucketed by day or month.
 *
 * `date_trunc` in Postgres, matching the UTC convention Sprint 16 established
 * for the admin series — both sides slice an ISO string, and the column is a
 * timestamp without a zone, so neither converts.
 *
 * Empty buckets are filled in by the caller-facing wrappers below. A chart with
 * missing days silently redraws the x-axis, which makes a quiet week look like
 * a busy one.
 */
async function bucketed(
  userIds: readonly string[],
  from: Date,
  to: Date,
  unit: "day" | "month",
): Promise<RawPeriodRow[]> {
  if (userIds.length === 0) return [];

  // `unit` is not user input — it is one of two literals chosen by the caller
  // — but it is still interpolated into SQL, so it is switched rather than
  // passed through. A parameter cannot be used for an identifier here.
  const truncated =
    unit === "day"
      ? prisma.$queryRaw<RawPeriodRow[]>`
          SELECT date_trunc('day', "createdAt") AS bucket,
            COALESCE(SUM("creditsCost"), 0) AS credits,
            SUM("costMicroUsd") AS cost,
            COUNT("costMicroUsd") AS costed,
            COUNT(*) AS total,
            COALESCE(SUM("imageCount"), 0) AS images,
            COALESCE(SUM("videoSeconds"), 0) AS video,
            COALESCE(SUM("audioSeconds"), 0) AS audio,
            COALESCE(SUM("gpuTimeMs"), 0) AS gpu,
            COALESCE(SUM("promptTokens"), 0) AS prompt_tokens,
            COALESCE(SUM("completionTokens"), 0) AS completion_tokens
          FROM "generations"
          WHERE "userId" = ANY(${userIds})
            AND "status" = 'SUCCEEDED'
            AND "createdAt" >= ${from} AND "createdAt" < ${to}
          GROUP BY 1 ORDER BY 1`
      : prisma.$queryRaw<RawPeriodRow[]>`
          SELECT date_trunc('month', "createdAt") AS bucket,
            COALESCE(SUM("creditsCost"), 0) AS credits,
            SUM("costMicroUsd") AS cost,
            COUNT("costMicroUsd") AS costed,
            COUNT(*) AS total,
            COALESCE(SUM("imageCount"), 0) AS images,
            COALESCE(SUM("videoSeconds"), 0) AS video,
            COALESCE(SUM("audioSeconds"), 0) AS audio,
            COALESCE(SUM("gpuTimeMs"), 0) AS gpu,
            COALESCE(SUM("promptTokens"), 0) AS prompt_tokens,
            COALESCE(SUM("completionTokens"), 0) AS completion_tokens
          FROM "generations"
          WHERE "userId" = ANY(${userIds})
            AND "status" = 'SUCCEEDED'
            AND "createdAt" >= ${from} AND "createdAt" < ${to}
          GROUP BY 1 ORDER BY 1`;

  return truncated;
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const monthKey = (date: Date) => date.toISOString().slice(0, 7);

/**
 * A row per day in the range, including days with no activity.
 *
 * Zero-filling is not cosmetic. A chart drawn from sparse rows silently
 * rescales its x-axis, so a quiet week and a busy one look identical.
 */
export async function dailyUsage(
  userIds: readonly string[],
  from: Date,
  to: Date,
): Promise<PeriodRow[]> {
  const rows = await bucketed(userIds, from, to, "day");
  const found = new Map(rows.map((row) => [dayKey(row.bucket), row]));

  const out: PeriodRow[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );

  while (cursor < to) {
    const key = dayKey(cursor);
    out.push({ period: key, ...shape(found.get(key)) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return out;
}

/** A row per calendar month in the range, including empty months. */
export async function monthlyUsage(
  userIds: readonly string[],
  from: Date,
  to: Date,
): Promise<PeriodRow[]> {
  const rows = await bucketed(userIds, from, to, "month");
  const found = new Map(rows.map((row) => [monthKey(row.bucket), row]));

  const out: PeriodRow[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1),
  );

  while (cursor < to) {
    const key = monthKey(cursor);
    out.push({ period: key, ...shape(found.get(key)) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return out;
}

/**
 * Usage for an organisation.
 *
 * ## There is no organisation in this product, and this does not pretend there is
 *
 * `docs/DECISIONS.md` defers teams and shared workspaces until there is demand
 * from paying single users. There is no `Organization` model, no membership
 * table, and Clerk's organisations are not wired up.
 *
 * Inventing one here would be building a teams feature inside a billing sprint
 * — a schema, a membership model, an invitation flow and a permission model,
 * none of which was asked for and all of which would then need maintaining.
 *
 * So this takes the **members** of an organisation as an explicit list. Every
 * function above is already set-based for this reason, so the reporting half of
 * organisation usage is finished and correct *today*; the only missing piece is
 * something that can answer "who is in this organisation", and that is one
 * function whenever teams exist.
 */
export async function organizationUsage(
  memberUserIds: readonly string[],
  from: Date,
  to: Date,
  creditValueMicroUsd?: number,
): Promise<MarginReport & { members: number }> {
  const report = await marginReport(
    memberUserIds,
    from,
    to,
    creditValueMicroUsd,
  );

  return { ...report, members: memberUserIds.length };
}

/** Cost split by provider. Answers "which vendor is the bill". */
export async function costByProvider(
  from: Date,
  to: Date,
): Promise<
  { provider: string; costMicroUsd: number | null; generations: number }[]
> {
  const rows = await prisma.$queryRaw<
    { provider: string; cost: bigint | null; total: bigint }[]
  >`
    SELECT "provider",
           SUM("costMicroUsd") AS cost,
           COUNT(*) AS total
    FROM "generations"
    WHERE "status" = 'SUCCEEDED'
      AND "createdAt" >= ${from} AND "createdAt" < ${to}
    GROUP BY "provider"
    ORDER BY SUM("costMicroUsd") DESC NULLS LAST`;

  return rows.map((row) => ({
    provider: row.provider,
    costMicroUsd: row.cost === null ? null : Number(row.cost),
    generations: Number(row.total),
  }));
}

// `formatMicroUsd` used to live here as well, with a subtly different rounding
// rule. One canonical copy now lives beside `MICRO_USD` in `services/ai/cost.ts`
// — import it from there.
