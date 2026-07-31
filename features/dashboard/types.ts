import type {
  AssetKind,
  GenerationStatus,
  Modality,
} from "@/lib/generated/prisma/enums";

/**
 * The dashboard's data contract.
 *
 * Every component below `features/dashboard` renders from these types and
 * **never** from a Prisma model. That separation buys three specific things:
 *
 * 1. **The UI is verifiable without a database.** `fixtures.ts` satisfies the
 *    same contract, so `/dashboard-preview` renders the real components with
 *    sample data. A dashboard whose layout has only ever been typechecked is a
 *    dashboard nobody has actually seen.
 * 2. **Query shape can change freely.** Denormalising, caching or moving a
 *    count into a materialised view touches `services/dashboard.ts` only.
 * 3. **No accidental over-fetching into the client.** A Prisma `User` carries
 *    `clerkId` and an email; a `DashboardUser` carries a display name. What the
 *    UI cannot receive, it cannot leak.
 *
 * Sizes are in bytes and times are ISO strings — both are serialisable across
 * the server/client boundary, which `Date` and `BigInt` are not.
 */

export interface DashboardUser {
  displayName: string;
  imageUrl: string | null;
  /** Null until the Clerk webhook has created the database row. */
  memberSince: string | null;
}

export interface CreditSummary {
  balance: number;
  /** Granted at the start of the current period — the denominator for the bar. */
  monthlyAllowance: number;
  spentThisPeriod: number;
  /** ISO date the allowance next resets. Null while on the free tier. */
  renewsAt: string | null;
  planName: string;
}

export interface StorageBreakdown {
  kind: AssetKind;
  bytes: number;
  count: number;
}

export interface StorageSummary {
  usedBytes: number;
  quotaBytes: number;
  breakdown: StorageBreakdown[];
}

export interface RecentProject {
  id: string;
  name: string;
  assetCount: number;
  updatedAt: string;
  /**
   * Hues for the preview tiles, derived from asset ids on the server.
   * Deriving them in the component would be non-deterministic across
   * server and client and hydrate with a mismatch.
   */
  previewHues: number[];
}

export type ActivityType =
  | "generation_succeeded"
  | "generation_failed"
  | "credits_spent"
  | "credits_granted"
  | "asset_uploaded"
  | "project_created";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  /** Secondary line — model name, credit delta, file count. */
  detail: string | null;
  at: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
  href: string | null;
}

export interface UsageStats {
  generationsThisPeriod: number;
  assetsTotal: number;
  /** 0–1. Null when there is nothing to compute a rate from. */
  successRate: number | null;
}

export interface DashboardData {
  user: DashboardUser;
  credits: CreditSummary;
  storage: StorageSummary;
  projects: RecentProject[];
  activity: ActivityItem[];
  notifications: NotificationItem[];
  stats: UsageStats;
  /**
   * True when the signed-in user has no database row yet — the Clerk webhook
   * is asynchronous and can land after the first page load. The dashboard
   * renders a setup state rather than a screen full of confident zeroes.
   */
  pending: boolean;
}

export type { AssetKind, GenerationStatus, Modality };
