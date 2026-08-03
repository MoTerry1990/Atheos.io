import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { AdminDashboard } from "@/features/admin/components/admin-dashboard";
import { isAdmin, isAdminConfigured } from "@/services/admin/auth";

export const metadata: Metadata = {
  title: "Admin",
  // Belt and braces. The route is already unreachable for non-admins; this
  // stops it appearing in a crawl of an authenticated session.
  robots: { index: false, follow: false },
};

/**
 * The admin dashboard.
 *
 * ## Three gates, none of them sufficient alone
 *
 * `app/(admin)/layout.tsx` calls `isAdmin()` and 404s. This page repeats it.
 * Every function in `services/admin` calls `requireAdmin()` itself.
 *
 * That is not redundancy for its own sake — it is the Sprint 3 rule. A layout
 * check is one refactor away from being bypassed by a route that renders the
 * same component, and a page check does nothing for the API. Protection lives
 * with the resource; the outer gates only make the surface undiscoverable.
 */
export default async function AdminPage() {
  if (!(await isAdmin())) notFound();

  return (
    <Container size="xl" className="py-8 sm:py-12">
      <PageHeader
        title="Admin"
        description="Everything here is logged, including reading somebody's account."
      />

      {!isAdminConfigured() ? (
        <p className="mb-6 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
          <span className="font-medium">ADMIN_USER_IDS is empty.</span>{" "}
          <span className="text-muted-foreground">
            Access depends entirely on the role column. If it is ever wrong
            there is no recovery path — set the environment variable.
          </span>
        </p>
      ) : null}

      <div className="mt-2 flex min-h-0 flex-col">
        <AdminDashboard />
      </div>
    </Container>
  );
}
