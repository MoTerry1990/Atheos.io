"use client";

import { createContext, useContext, type ReactNode } from "react";

import * as api from "@/features/admin/lib/api";

/**
 * The admin client, injectable.
 *
 * Fifth use of this pattern. Here it earns its keep for a reason the others did
 * not have: an admin dashboard cannot be exercised at all without being an
 * admin *and* having a populated database, and this environment has neither.
 * Every number on the page is an aggregate over rows that do not exist.
 *
 * The default is the real module. The preview substitutes fixtures, and is the
 * only way the moderation queue, the credit-adjustment dialog and the degraded
 * status states have been looked at.
 */

export interface AdminApi {
  loadOverview: typeof api.loadOverview;
  loadUsers: typeof api.loadUsers;
  loadUser: typeof api.loadUser;
  adjustCredits: typeof api.adjustCredits;
  setRole: typeof api.setRole;
  loadReports: typeof api.loadReports;
  resolveReport: typeof api.resolveReport;
  loadStatus: typeof api.loadStatus;
  loadAudit: typeof api.loadAudit;
}

const REAL: AdminApi = {
  loadOverview: api.loadOverview,
  loadUsers: api.loadUsers,
  loadUser: api.loadUser,
  adjustCredits: api.adjustCredits,
  setRole: api.setRole,
  loadReports: api.loadReports,
  resolveReport: api.resolveReport,
  loadStatus: api.loadStatus,
  loadAudit: api.loadAudit,
};

const AdminApiContext = createContext<AdminApi>(REAL);

export function useAdminApi(): AdminApi {
  return useContext(AdminApiContext);
}

export function AdminApiProvider({
  value,
  children,
}: {
  value: AdminApi;
  children: ReactNode;
}) {
  return (
    <AdminApiContext.Provider value={value}>
      {children}
    </AdminApiContext.Provider>
  );
}
