import { ApiError, request } from "@/lib/http";
import type { AdminOverview } from "@/services/admin/analytics";
import type { AdminUserDetail, AdminUserRow } from "@/services/admin/users";
import type { ReportedComment } from "@/services/admin/moderation";
import type { SystemStatus } from "@/services/admin/status";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * The admin client.
 *
 * Types are imported from the services. Unlike the billing catalogue or the
 * marketplace types, these modules are `server-only` — but a `import type` is
 * erased at compile time and never reaches the bundle, so the boundary holds.
 * Duplicating them would be two shapes to keep in agreement for no benefit.
 */

export { ApiError };
export type {
  AdminOverview,
  AdminUserDetail,
  AdminUserRow,
  ReportedComment,
  SystemStatus,
  Role,
};

export interface DailyActivity {
  date: string;
  generations: number;
  signups: number;
  credits: number;
}

export interface AuditEntry {
  id: string;
  actorEmail: string;
  action: string;
  subjectType: string;
  subjectId: string;
  detail: unknown;
  reason: string | null;
  createdAt: number;
}

export function loadOverview(days = 30) {
  return request<{ overview: AdminOverview; activity: DailyActivity[] }>(
    `/api/admin/overview?days=${days}`,
  );
}

export function loadUsers(options: { search?: string; cursor?: string } = {}) {
  const params = new URLSearchParams();
  if (options.search?.trim()) params.set("q", options.search.trim());
  if (options.cursor) params.set("cursor", options.cursor);

  return request<{ users: AdminUserRow[]; nextCursor: string | null }>(
    `/api/admin/users?${params}`,
  );
}

export function loadUser(id: string) {
  return request<{ user: AdminUserDetail }>(`/api/admin/users/${id}`);
}

export function adjustCredits(input: {
  userId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
}) {
  return request<{ balance: number; applied: boolean }>(
    `/api/admin/users/${input.userId}`,
    {
      method: "POST",
      body: JSON.stringify({
        action: "adjust-credits",
        amount: input.amount,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      }),
    },
  );
}

export function setRole(userId: string, role: Role, reason: string) {
  return request<{ role: Role }>(`/api/admin/users/${userId}`, {
    method: "POST",
    body: JSON.stringify({ action: "set-role", role, reason }),
  });
}

export function loadReports() {
  return request<{ reports: ReportedComment[] }>("/api/admin/moderation");
}

export function resolveReport(
  commentId: string,
  action: "remove" | "dismiss",
  reason: string,
) {
  return request<{ resolved: true }>("/api/admin/moderation", {
    method: "POST",
    body: JSON.stringify({ action, commentId, reason }),
  });
}

export function loadStatus() {
  return request<SystemStatus>("/api/admin/status");
}

export function loadAudit(action?: string) {
  const params = new URLSearchParams();
  if (action) params.set("action", action);
  return request<{ entries: AuditEntry[] }>(`/api/admin/audit?${params}`);
}
