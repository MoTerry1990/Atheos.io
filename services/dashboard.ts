import "server-only";

import { getClerkUser, getCurrentUser } from "@/lib/auth";
import { planConfigFor } from "@/services/billing/plan-config";
import { getEntitlement } from "@/services/billing/subscription";
import type { PlanTier } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type {
  ActivityItem,
  CreditSummary,
  DashboardData,
  NotificationItem,
  RecentProject,
  StorageSummary,
  UsageStats,
} from "@/features/dashboard/types";

/**
 * Everything the dashboard needs, in one place.
 *
 * ## Why this is a service and not queries in the page
 *
 * Authorisation lives here, with the data — the rule established in Sprint 3.
 * Every query below is scoped by `user.id` from the session; none of them takes
 * a user id from a caller. A function that accepts `userId: string` is one
 * careless call site away from being an IDOR, and this file is small enough to
 * audit in a minute.
 *
 * ## Two round trips, not eleven
 *
 * The queries are independent, so they run inside a single `$transaction`
 * array rather than sequentially — one connection acquisition and one network
 * round trip to Supabase instead of ten. That is the difference between a
 * dashboard that renders in 80ms and one that renders in 600ms, entirely from
 * latency.
 *
 * The storage `groupBy` is the one exception and runs alongside it; the reason
 * is at its call site.
 *
 * ## Free-tier constants
 *
 * Allowance and quota are hard-coded to the Starter tier for now. They belong
 * on the subscription record once Sprint 7 introduces plans; hard-coding them
 * with a named constant is honest placeholder work, whereas inventing a plans
 * table nothing writes to would not be.
 */

/**
 * The credit figures for a plan, derived rather than hardcoded.
 *
 * There used to be a `STARTER_MONTHLY_CREDITS = 200` here, alongside a
 * `planName: "Starter"`. Neither survived the plan system: no tier is called
 * Starter and no tier grants 200. The dashboard went on dividing the real
 * balance by that constant, which is how it came to read "635 of 200" — a true
 * numerator over a denominator belonging to a plan that does not exist.
 */
function creditSummaryFor(
  tier: PlanTier | null | undefined,
  balance: number,
  spentThisPeriod: number,
  renewsAt: string | null,
): CreditSummary {
  const plan = planConfigFor(tier);

  return {
    balance,
    /**
     * `creditsPerMonth` is nullable and null means **undecided**, so a plan
     * that has not settled its allowance shows no denominator at all rather
     * than a zero the bar would read as "nothing left".
     *
     * Free's grant is one-time. Labelling it monthly would promise a renewal
     * that never comes.
     */
    allowance: plan.creditsPerMonth
      ? {
          credits: plan.creditsPerMonth,
          kind: plan.tier === "FREE" ? "one-time" : "monthly",
        }
      : null,
    spentThisPeriod,
    renewsAt,
    planName: plan.displayName,
  };
}
const STARTER_STORAGE_QUOTA = 2 * 1024 * 1024 * 1024; // 2GB

const RECENT_PROJECT_LIMIT = 6;
const ACTIVITY_LIMIT = 12;

/** Deterministic hue from an id, so server and client agree. */
function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return hash;
}

function startOfPeriod(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getDashboardData(): Promise<DashboardData> {
  const [clerkUser, user] = await Promise.all([
    getClerkUser(),
    getCurrentUser(),
  ]);

  const displayName =
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
    clerkUser?.emailAddresses[0]?.emailAddress?.split("@")[0] ||
    "there";

  const base = {
    user: {
      displayName,
      imageUrl: clerkUser?.imageUrl ?? null,
      memberSince: user?.createdAt.toISOString() ?? null,
    },
  };

  // The webhook has not landed yet. Return an explicitly empty shape rather
  // than querying with no user id — and let the UI say "setting up" instead of
  // showing a confident zero for a balance that is actually 200.
  if (!user) {
    return {
      ...base,
      credits: creditSummaryFor("FREE", 0, 0, null),
      storage: {
        usedBytes: 0,
        quotaBytes: STARTER_STORAGE_QUOTA,
        breakdown: [],
      },
      projects: [],
      activity: [],
      notifications: [],
      stats: { generationsThisPeriod: 0, assetsTotal: 0, successRate: null },
      pending: true,
    };
  }

  const periodStart = startOfPeriod();

  // groupBy runs outside the `$transaction` array on purpose. Prisma types
  // transaction tuples by widening each element, which loses groupBy's
  // per-aggregate result shape and leaves `_count` as an unnarrowable union.
  // Running it alongside keeps it correctly typed for one extra round trip.
  const storageByKindPromise = prisma.asset.groupBy({
    by: ["kind"],
    where: { userId: user.id, deletedAt: null },
    orderBy: { kind: "asc" },
    _sum: { sizeBytes: true },
    _count: true,
  });

  const [
    spentAgg,
    storageAgg,
    collections,
    recentGenerations,
    recentCredits,
    recentAssets,
    generationsThisPeriod,
    assetsTotal,
    succeededCount,
    finishedCount,
  ] = await prisma.$transaction([
    // Spend is negative in the ledger; sum and flip for display.
    prisma.creditTransaction.aggregate({
      where: {
        userId: user.id,
        amount: { lt: 0 },
        createdAt: { gte: periodStart },
      },
      _sum: { amount: true },
    }),
    prisma.asset.aggregate({
      where: { userId: user.id, deletedAt: null },
      _sum: { sizeBytes: true },
    }),
    prisma.collection.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: RECENT_PROJECT_LIMIT,
      include: {
        _count: { select: { assets: true } },
        assets: {
          take: 4,
          orderBy: { addedAt: "desc" },
          select: { assetId: true },
        },
      },
    }),
    prisma.generation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_LIMIT,
      select: {
        id: true,
        status: true,
        model: true,
        prompt: true,
        createdAt: true,
        completedAt: true,
      },
    }),
    prisma.creditTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_LIMIT,
      select: { id: true, amount: true, reason: true, createdAt: true },
    }),
    prisma.asset.findMany({
      where: { userId: user.id, source: "UPLOADED", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_LIMIT,
      select: { id: true, kind: true, createdAt: true },
    }),
    prisma.generation.count({
      where: { userId: user.id, createdAt: { gte: periodStart } },
    }),
    prisma.asset.count({ where: { userId: user.id, deletedAt: null } }),
    prisma.generation.count({
      where: { userId: user.id, status: "SUCCEEDED" },
    }),
    prisma.generation.count({
      where: { userId: user.id, status: { in: ["SUCCEEDED", "FAILED"] } },
    }),
  ]);

  const storageByKind = await storageByKindPromise;

  /**
   * The plan the balance should be read against.
   *
   * Fetched here rather than assumed: the denominator is the whole reason the
   * card was wrong, and a hardcoded one is what made it wrong.
   */
  const entitlement = await getEntitlement(user.id);

  const credits = creditSummaryFor(
    entitlement.tier,
    user.creditBalance,
    Math.abs(spentAgg._sum.amount ?? 0),
    /**
     * Only a recurring plan renews. Free's grant is one-time, so it has no
     * next date and must not borrow a period end from anywhere.
     */
    entitlement.currentPeriodEnd
      ? new Date(entitlement.currentPeriodEnd).toISOString()
      : null,
  );

  const storage: StorageSummary = {
    usedBytes: storageAgg._sum.sizeBytes ?? 0,
    quotaBytes: STARTER_STORAGE_QUOTA,
    breakdown: storageByKind
      .map((row) => ({
        kind: row.kind,
        bytes: row._sum?.sizeBytes ?? 0,
        count: row._count,
      }))
      .sort((a, b) => b.bytes - a.bytes),
  };

  const projects: RecentProject[] = collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    assetCount: collection._count.assets,
    updatedAt: collection.updatedAt.toISOString(),
    previewHues: collection.assets.map((entry) => hueFromId(entry.assetId)),
  }));

  // Merge three sources into one timeline. Each is already limited, so the
  // sort is over at most 3 × ACTIVITY_LIMIT rows in memory — cheaper than a
  // UNION query and far easier to read.
  const activity: ActivityItem[] = [
    ...recentGenerations.map((generation) => ({
      id: `gen-${generation.id}`,
      type:
        generation.status === "FAILED"
          ? ("generation_failed" as const)
          : ("generation_succeeded" as const),
      title:
        generation.prompt.length > 70
          ? `${generation.prompt.slice(0, 70)}…`
          : generation.prompt,
      detail: generation.model,
      at: (generation.completedAt ?? generation.createdAt).toISOString(),
    })),
    ...recentCredits.map((entry) => ({
      id: `credit-${entry.id}`,
      type:
        entry.amount < 0
          ? ("credits_spent" as const)
          : ("credits_granted" as const),
      title:
        entry.amount < 0
          ? `${Math.abs(entry.amount)} credits spent`
          : `${entry.amount} credits added`,
      detail: entry.reason.toLowerCase().replace(/_/g, " "),
      at: entry.createdAt.toISOString(),
    })),
    ...recentAssets.map((asset) => ({
      id: `asset-${asset.id}`,
      type: "asset_uploaded" as const,
      title: `${asset.kind.toLowerCase()} uploaded`,
      detail: null,
      at: asset.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, ACTIVITY_LIMIT);

  const stats: UsageStats = {
    generationsThisPeriod,
    assetsTotal,
    // Null rather than 0 when nothing has finished: "0% success" on a new
    // account is alarming and false.
    successRate: finishedCount > 0 ? succeededCount / finishedCount : null,
  };

  return {
    ...base,
    credits,
    storage,
    projects,
    activity,
    notifications: await getNotifications(credits, storage),
    stats,
    pending: false,
  };
}

/**
 * Notifications.
 *
 * Derived from account state rather than read from a table, because there is no
 * notifications table yet and inventing one that nothing writes to would be
 * speculative. These are the two conditions the product can genuinely detect
 * today: a low balance and a nearly-full quota.
 *
 * When Sprint 6 introduces long-running video jobs there will be real events to
 * store, and this function becomes a query. The **shape** the UI consumes does
 * not change, which is the point of the DTO.
 */
async function getNotifications(
  credits: CreditSummary,
  storage: StorageSummary,
): Promise<NotificationItem[]> {
  const items: NotificationItem[] = [];
  const now = new Date().toISOString();

  if (credits.allowance && credits.balance <= credits.allowance.credits * 0.1) {
    items.push({
      id: "credits-low",
      title: "Credit balance is low",
      body: `${credits.balance} credits remaining this period.`,
      at: now,
      read: false,
      href: "/settings",
    });
  }

  if (storage.quotaBytes > 0 && storage.usedBytes / storage.quotaBytes >= 0.9) {
    items.push({
      id: "storage-full",
      title: "Storage almost full",
      body: "You are using over 90% of your quota.",
      at: now,
      read: false,
      href: "/dashboard",
    });
  }

  return items;
}

/**
 * The small slice the persistent shell needs on **every** page.
 *
 * Separate from `getDashboardData` on purpose. The shell renders on the profile
 * page, the settings page and every future route, and running the dashboard's
 * eleven aggregates to draw a credit pill and a bell would put that cost on
 * pages that display neither.
 *
 * Two cheap reads. The dashboard route does query some of the same rows, which
 * is a knowing duplication — Next dedupes within a single render pass, and the
 * alternative is threading a context through a server layout, which is worse.
 */
export async function getShellSummary(): Promise<{
  creditBalance: number;
  notifications: NotificationItem[];
}> {
  const user = await getCurrentUser();

  if (!user) {
    return { creditBalance: 0, notifications: [] };
  }

  const storageAgg = await prisma.asset.aggregate({
    where: { userId: user.id, deletedAt: null },
    _sum: { sizeBytes: true },
  });

  const entitlement = await getEntitlement(user.id);

  const credits = creditSummaryFor(
    entitlement.tier,
    user.creditBalance,
    0,
    /**
     * Only a recurring plan renews. Free's grant is one-time, so it has no
     * next date and must not borrow a period end from anywhere.
     */
    entitlement.currentPeriodEnd
      ? new Date(entitlement.currentPeriodEnd).toISOString()
      : null,
  );

  const storage: StorageSummary = {
    usedBytes: storageAgg._sum.sizeBytes ?? 0,
    quotaBytes: STARTER_STORAGE_QUOTA,
    breakdown: [],
  };

  return {
    creditBalance: user.creditBalance,
    notifications: await getNotifications(credits, storage),
  };
}
