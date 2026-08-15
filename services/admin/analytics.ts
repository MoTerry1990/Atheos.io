import "server-only";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/services/admin/auth";
import { planDefinitionFor } from "@/services/billing/catalogue";
import type { PlanTier } from "@/lib/generated/prisma/enums";

/**
 * Analytics, revenue and subscriptions.
 *
 * ## Everything here is counted, never estimated
 *
 * No projections, no "annualised" figures, no MRR extrapolated from a week of
 * data. Every number is a `count` or a `sum` over rows that exist. A dashboard
 * that mixes measurements with models is one where nobody can tell which is
 * which, and the models are always the ones quoted in a meeting.
 *
 * ## Revenue is not credits
 *
 * They are different things and the dashboard shows both, labelled. Revenue is
 * money Stripe processed. Credits consumed is what users spent. They diverge —
 * by rollover, by the signup grant, by refunds, by packs bought in one month
 * and spent in the next — and presenting either as the other would misstate the
 * business in whichever direction happened to flatter it.
 *
 * **Revenue here is derived from our own ledger**, specifically the grants that
 * carry a Stripe reference. That is a proxy: it counts what we recorded, not
 * what Stripe settled, and it misses refunds and disputes entirely. Stripe is
 * the source of truth for money (§ 6), and the honest way to report revenue is
 * from Stripe's own reporting API. Until that is wired, this is labelled as an
 * approximation in the interface rather than dressed up as accounting.
 */

export interface AdminOverview {
  users: { total: number; newThisWeek: number; withHandle: number };
  generations: {
    total: number;
    thisWeek: number;
    succeeded: number;
    failed: number;
  };
  credits: {
    /** Sum of every balance held right now — a liability, not revenue. */
    outstanding: number;
    grantedThisMonth: number;
    spentThisMonth: number;
  };
  subscriptions: {
    active: number;
    pastDue: number;
    canceling: number;
    byTier: { tier: PlanTier; name: string; count: number }[];
  };
  community: { posts: number; comments: number; reported: number };
  /** Approximate — see the note above. Minor units. */
  recordedRevenueThisMonth: number;
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function weekAgo(): Date {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

export async function getOverview(): Promise<AdminOverview> {
  await requireAdmin();

  const monthStart = startOfMonth();
  const since = weekAgo();

  // One round trip for the counts that are independent of each other.
  // Deliberately *not* a `$transaction`: these are reads, nothing needs a
  // consistent snapshot across them, and Prisma's `groupBy` result types do not
  // survive being wrapped — a wart this codebase has hit before.
  const [
    users,
    newUsers,
    withHandle,
    generations,
    generationsThisWeek,
    succeeded,
    failed,
    balances,
    ledgerThisMonth,
    subscriptionsByStatus,
    subscriptionsByTier,
    canceling,
    posts,
    comments,
    reported,
    revenueLedger,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.user.count({ where: { handle: { not: null } } }),
    prisma.generation.count(),
    prisma.generation.count({ where: { createdAt: { gte: since } } }),
    prisma.generation.count({ where: { status: "SUCCEEDED" } }),
    prisma.generation.count({ where: { status: "FAILED" } }),
    prisma.user.aggregate({ _sum: { creditBalance: true } }),
    prisma.creditTransaction.groupBy({
      by: ["reason"],
      where: { createdAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.subscription.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.subscription.groupBy({
      by: ["planTier"],
      where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
      _count: { _all: true },
    }),
    prisma.subscription.count({ where: { cancelAtPeriodEnd: true } }),
    prisma.post.count({ where: { publishedAt: { not: null } } }),
    prisma.comment.count({ where: { deletedAt: null } }),
    prisma.comment.count({
      where: { reportedAt: { not: null }, deletedAt: null },
    }),
    prisma.creditTransaction.findMany({
      where: {
        createdAt: { gte: monthStart },
        stripeReference: { not: null },
        reason: { in: ["SUBSCRIPTION_GRANT", "PACK_PURCHASE"] },
      },
      orderBy: { createdAt: "desc" },
      /**
       * Bounded, not aggregated — deliberately, and this one is a compromise.
       *
       * The amount paid lives in the `metadata` JSON, not in a column, so
       * Postgres cannot sum it without a JSON expression that would have to
       * agree exactly with how the webhook writes it. Getting that subtly wrong
       * makes the revenue figure quietly incorrect, which is worse than making
       * it slow.
       *
       * So the rows are still loaded and summed in Node, with a ceiling. At
       * 10,000 purchases in a month this figure would start under-reporting —
       * and the dashboard already labels it approximate and points at Stripe as
       * the source of truth (§ 6). The real fix is a `amountMinor` column,
       * which is a schema change and belongs in its own sprint.
       */
      take: 10_000,
      select: { reason: true, metadata: true },
    }),
  ]);

  const ledgerSum = (reason: string) =>
    ledgerThisMonth.find((row) => row.reason === reason)?._sum.amount ?? 0;

  const statusCount = (status: string) =>
    subscriptionsByStatus.find((row) => row.status === status)?._count._all ??
    0;

  return {
    users: { total: users, newThisWeek: newUsers, withHandle },
    generations: {
      total: generations,
      thisWeek: generationsThisWeek,
      succeeded,
      failed,
    },
    credits: {
      outstanding: balances._sum.creditBalance ?? 0,
      grantedThisMonth:
        ledgerSum("SUBSCRIPTION_GRANT") +
        ledgerSum("PACK_PURCHASE") +
        ledgerSum("SIGNUP_GRANT") +
        ledgerSum("MANUAL_ADJUSTMENT"),
      // Spend is stored negative; adding the refunds nets it, and the sign flip
      // makes it a positive number to display.
      spentThisMonth: Math.max(
        0,
        -(ledgerSum("GENERATION_SPEND") + ledgerSum("GENERATION_REFUND")),
      ),
    },
    subscriptions: {
      active: statusCount("ACTIVE") + statusCount("TRIALING"),
      pastDue: statusCount("PAST_DUE"),
      canceling,
      byTier: subscriptionsByTier.map((row) => ({
        tier: row.planTier,
        name: planDefinitionFor(row.planTier).name,
        count: row._count._all,
      })),
    },
    community: { posts, comments, reported },
    recordedRevenueThisMonth: revenueLedger.reduce((total, row) => {
      // Reconstructed from what the grant recorded, because the ledger stores
      // credits rather than money. Approximate by construction — the interface
      // labels it as such rather than implying it reconciles with Stripe.
      const detail = row.metadata as Record<string, unknown> | null;
      const tier = detail?.tier as PlanTier | undefined;
      const interval = detail?.interval as string | undefined;

      if (row.reason === "SUBSCRIPTION_GRANT" && tier) {
        const plan = planDefinitionFor(tier);
        // Annual billing was retired in Sprint 4 and the per-month yearly
        // price went with it. A historical yearly grant is valued at twelve
        // months of the monthly price, which slightly *overstates* it — the
        // yearly rate was discounted. Overstating recognised revenue in a
        // dashboard is the wrong direction, so it is named here rather than
        // left to be discovered: the figure is an upper bound on any pre-Sprint-4
        // annual subscription, of which there are none.
        return total + plan.monthly * (interval === "YEAR" ? 12 : 1);
      }

      return total;
    }, 0),
  };
}

/**
 * Daily activity for a chart.
 *
 * Grouped in memory from one indexed range scan rather than one query per day.
 * Thirty round trips to draw thirty bars is the shape that makes a dashboard
 * feel broken, and the range is already covered by `[userId, createdAt]`.
 */
export async function getDailyActivity(
  days = 30,
): Promise<
  { date: string; generations: number; signups: number; credits: number }[]
> {
  await requireAdmin();

  const span = Math.min(Math.max(days, 7), 90);
  const since = new Date(Date.now() - span * 24 * 60 * 60 * 1000);

  /**
   * Aggregated in Postgres, not in Node.
   *
   * This previously ran three unbounded `findMany` calls and bucketed the rows
   * in a loop. It produced at most 90 numbers, and to get them it pulled **one
   * row per generation, per signup and per spend transaction** in the window
   * across the wire. At a million generations that is a million rows
   * serialised, transferred and garbage-collected to compute ninety integers,
   * and the cost grows with the product's success.
   *
   * `date_trunc('day', ...)` matches `dayKey` exactly: both are UTC, and the
   * column is `timestamp` without a zone, so no conversion happens on either
   * side. Prisma's `groupBy` cannot group by an expression, which is why this
   * is `$queryRaw` — parameterised via the tagged template, so `since` is a
   * bound parameter and never interpolated.
   */
  const [generations, signups, spend] = await Promise.all([
    prisma.$queryRaw<{ day: Date; n: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, count(*) AS n
      FROM "generations" WHERE "createdAt" >= ${since}
      GROUP BY 1`,
    prisma.$queryRaw<{ day: Date; n: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, count(*) AS n
      FROM "users" WHERE "createdAt" >= ${since}
      GROUP BY 1`,
    prisma.$queryRaw<{ day: Date; n: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, sum(abs("amount")) AS n
      FROM "credit_transactions"
      WHERE "createdAt" >= ${since} AND "reason" = 'GENERATION_SPEND'
      GROUP BY 1`,
  ]);

  const buckets = new Map<
    string,
    { generations: number; signups: number; credits: number }
  >();

  for (let index = 0; index < span; index += 1) {
    const day = new Date(since.getTime() + index * 24 * 60 * 60 * 1000);
    buckets.set(dayKey(day), { generations: 0, signups: 0, credits: 0 });
  }

  // `count()` and `sum()` come back as bigint. Number() is safe here: a daily
  // count that exceeds 2^53 is not a number this dashboard needs to be right
  // about, and `sum` is over a bounded credit amount.
  for (const row of generations) {
    const bucket = buckets.get(dayKey(row.day));
    if (bucket) bucket.generations = Number(row.n);
  }
  for (const row of signups) {
    const bucket = buckets.get(dayKey(row.day));
    if (bucket) bucket.signups = Number(row.n);
  }
  for (const row of spend) {
    const bucket = buckets.get(dayKey(row.day));
    if (bucket) bucket.credits = Number(row.n ?? 0);
  }

  return [...buckets.entries()].map(([date, values]) => ({ date, ...values }));
}

/** UTC, so a dashboard read from two timezones agrees with itself. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
