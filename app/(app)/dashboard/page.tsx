import type { Metadata } from "next";

import { DashboardView } from "@/features/dashboard/components/dashboard-view";
import { getDashboardData } from "@/services/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The dashboard route.
 *
 * A Server Component that fetches and hands off. All rendering lives in
 * `DashboardView`, which takes data and nothing else — so the same component
 * is exercised by `/dashboard-preview` against fixtures.
 *
 * Deliberately thin. A page that both queries and renders cannot be verified
 * without a database, and this one can.
 */
export default async function DashboardPage() {
  const data = await getDashboardData();

  return <DashboardView data={data} />;
}
