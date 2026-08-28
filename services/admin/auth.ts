import "server-only";

import { getCurrentUser, getUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import type { UserModel } from "@/lib/generated/prisma/models";

/**
 * Who may use the admin dashboard.
 *
 * This file is the most security-sensitive in the codebase. Everything behind
 * it can read any user's email, see any generation, and change any credit
 * balance. Two rules follow from that.
 *
 * ## Two independent grants, and the environment wins
 *
 * Admin access is `ADMIN_USER_IDS` **or** `User.role = ADMIN`.
 *
 * The environment list is the root of trust. It is checked without reading the
 * database, so a database compromise on its own cannot escalate anybody, and it
 * is the recovery path if the `role` column is ever wrong — including if an
 * admin removes their own access. Changing it needs a deploy, which is exactly
 * the friction that should exist around this.
 *
 * The column exists so a bootstrap admin can grant access without a deploy.
 * That is a real operational need and it is deliberately the weaker of the two.
 *
 * ## Absence is 404, not 403
 *
 * `AdminError` carries 404. A 403 confirms that `/admin` exists and that the
 * caller found a real endpoint, which is the first thing an attacker wants to
 * know. Every admin route returns "not found" to everyone who is not an admin —
 * including signed-in users, including signed-out ones.
 */

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number = 404,
    readonly code: string = "not_found",
  ) {
    super(message);
    this.name = "AdminError";
  }
}

/**
 * Clerk ids from the environment.
 *
 * Parsed on every call rather than cached at module scope. This is not a hot
 * path — an admin page load — and a cached allowlist is one that keeps a
 * revoked id alive until the process restarts.
 */
function allowlistedClerkIds(): Set<string> {
  return new Set(
    (env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

/**
 * Whether the current request is from an admin.
 *
 * Returns a boolean rather than throwing, for the one place that needs to
 * decide whether to *show* something — the nav. Everything that guards data
 * uses `requireAdmin`.
 */
/**
 * Is *this* user an admin, by clerk id?
 *
 * `isAdmin()` reads the Clerk session, which is right for a page and useless
 * for an API key: a key resolves to a user without a session, so the session
 * lookup returns nothing and every key-holder was treated as an ordinary
 * customer. That failed closed — the owner's key simply saw the public
 * catalogue — but it meant the owner could not reach their own
 * owner-evaluation models through a connector at all.
 *
 * Same two grants as `isAdmin`, in the same order, against an id the caller
 * has already authenticated. It takes a clerk id rather than a session so
 * there is exactly one place that decides what admin means; it does **not**
 * take anything a client could send.
 */
export async function isAdminClerkId(clerkId: string): Promise<boolean> {
  if (!clerkId) return false;
  if (allowlistedClerkIds().has(clerkId)) return true;

  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { role: true },
  });

  return user?.role === "ADMIN";
}

export async function isAdmin(): Promise<boolean> {
  const clerkId = await getUserId();
  if (!clerkId) return false;

  if (allowlistedClerkIds().has(clerkId)) return true;

  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { role: true },
  });

  return user?.role === "ADMIN";
}

export interface AdminActor {
  user: UserModel;
  /** True when the grant came from the environment rather than the column. */
  viaAllowlist: boolean;
}

/**
 * The current admin, or a 404.
 *
 * Every admin service function begins with this. Not the route handler — the
 * same rule the rest of this codebase follows since Sprint 3: protection lives
 * with the resource, because a route that trusts middleware is one matcher edit
 * away from being open.
 */
export async function requireAdmin(): Promise<AdminActor> {
  const clerkId = await getUserId();
  if (!clerkId) throw notFound();

  const user = await getCurrentUser();
  if (!user) throw notFound();

  const viaAllowlist = allowlistedClerkIds().has(clerkId);
  if (!viaAllowlist && user.role !== "ADMIN") throw notFound();

  return { user, viaAllowlist };
}

function notFound() {
  return new AdminError("Not found.", 404, "not_found");
}

/**
 * Whether the dashboard can be reached at all.
 *
 * With no `ADMIN_USER_IDS` and no admin row, nobody can get in — including the
 * person deploying it. The dashboard says so on the sign-in wall rather than
 * leaving somebody to conclude the feature is broken.
 */
export function isAdminConfigured(): boolean {
  return allowlistedClerkIds().size > 0;
}

// ------------------------------------------------------------------ audit ---

export interface AuditEntry {
  action: string;
  subjectType: string;
  subjectId: string;
  detail?: Record<string, unknown>;
  reason?: string;
}

/**
 * Record an admin action.
 *
 * Takes an optional transaction client so a mutation and its audit row commit
 * together. An action that can succeed unaudited is an action nobody can
 * answer for, and the answer is always needed after the fact.
 *
 * Reads are audited too, where the read is a disclosure — opening a support
 * view exposes somebody's email and their whole history, and a log that only
 * records writes cannot answer "who looked at this account".
 */
export async function audit(
  actor: AdminActor,
  entry: AuditEntry,
  tx: Pick<typeof prisma, "adminAuditLog"> = prisma,
): Promise<void> {
  await tx.adminAuditLog.create({
    data: {
      actorId: actor.user.id,
      actorEmail: actor.user.email,
      action: entry.action,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      detail: (entry.detail ?? null) as never,
      reason: entry.reason ?? null,
    },
  });
}

/** The audit trail, newest first. Readable only by admins, like everything here. */
export async function listAudit(
  options: { limit?: number; action?: string } = {},
) {
  await requireAdmin();

  const rows = await prisma.adminAuditLog.findMany({
    where: options.action ? { action: options.action } : undefined,
    orderBy: { createdAt: "desc" },
    take: Math.min(options.limit ?? 100, 500),
    select: {
      id: true,
      actorEmail: true,
      action: true,
      subjectType: true,
      subjectId: true,
      detail: true,
      reason: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.getTime(),
  }));
}
