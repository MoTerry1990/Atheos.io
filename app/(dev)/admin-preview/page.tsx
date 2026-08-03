"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { AdminDashboard } from "@/features/admin/components/admin-dashboard";
import {
  AdminApiProvider,
  type AdminApi,
} from "@/features/admin/lib/api-context";
import { ApiError } from "@/features/admin/lib/api";

/**
 * Admin preview.
 *
 * The production dashboard against fixtures. It earns its place harder than the
 * others: the admin surface needs an admin session *and* a populated database,
 * and this environment has neither — every number on the page is an aggregate
 * over rows that do not exist.
 *
 * ## What it deliberately cannot demonstrate
 *
 * The **gate**. `isAdmin()` runs on the server against Clerk and the database,
 * and this route bypasses the page entirely by rendering the component
 * directly. That is the one thing about this feature that matters most, and it
 * is verified by requesting `/admin` and `/api/admin/*` for real — not here.
 *
 * The banner says so, because a preview that quietly implies the gate was
 * checked would be worse than no preview.
 *
 * `noindex` via the `(dev)` layout, and excluded from Clerk's middleware
 * matcher.
 */

type Scenario = "populated" | "empty" | "degraded";

const LATENCY = 180;
const delay = <T,>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), LATENCY));

function createFixtureApi(now: number, scenario: Scenario): AdminApi {
  const populated = scenario !== "empty";
  const day = 86_400_000;

  const users = populated
    ? [
        {
          id: "u_ada",
          email: "ada@example.com",
          name: "Ada",
          handle: "fixture-ada",
          role: "USER" as const,
          creditBalance: 2140,
          createdAt: now - 40 * day,
          generationCount: 47,
          planName: "Studio",
          subscriptionStatus: "ACTIVE",
        },
        {
          id: "u_lin",
          email: "lin@example.com",
          name: "Lin",
          handle: null,
          role: "USER" as const,
          creditBalance: 118,
          createdAt: now - 9 * day,
          generationCount: 4,
          planName: null,
          subscriptionStatus: null,
        },
        {
          id: "u_staff",
          email: "staff@example.com",
          name: "Staff",
          handle: null,
          role: "ADMIN" as const,
          creditBalance: 0,
          createdAt: now - 120 * day,
          generationCount: 0,
          planName: null,
          subscriptionStatus: null,
        },
      ]
    : [];

  const balances = new Map(users.map((user) => [user.id, user.creditBalance]));
  const applied = new Set<string>();

  const reports = populated
    ? [
        {
          id: "cm_1",
          body: "Buy followers at spam-dot-example, cheapest rates",
          createdAt: now - 30 * 3_600_000,
          reportedAt: now - 26 * 3_600_000,
          author: {
            id: "u_spam",
            email: "spam@example.com",
            handle: null,
          },
          post: {
            slug: "fx1",
            caption: "Third attempt.",
            authorHandle: "fixture-ada",
          },
        },
      ]
    : [];

  return {
    async loadOverview() {
      return delay({
        overview: {
          users: {
            total: users.length,
            newThisWeek: populated ? 1 : 0,
            withHandle: users.filter((user) => user.handle).length,
          },
          generations: {
            total: populated ? 51 : 0,
            thisWeek: populated ? 12 : 0,
            succeeded: populated ? 47 : 0,
            failed: populated ? 4 : 0,
          },
          credits: {
            outstanding: [...balances.values()].reduce((a, b) => a + b, 0),
            grantedThisMonth: populated ? 3200 : 0,
            spentThisMonth: populated ? 942 : 0,
          },
          subscriptions: {
            active: populated ? 1 : 0,
            pastDue: 0,
            canceling: 0,
            byTier: populated
              ? [{ tier: "STUDIO" as const, name: "Studio", count: 1 }]
              : [],
          },
          community: {
            posts: populated ? 3 : 0,
            comments: populated ? 2 : 0,
            reported: reports.length,
          },
          recordedRevenueThisMonth: populated ? 2400 : 0,
        },
        activity: Array.from({ length: 30 }, (_, index) => ({
          date: new Date(now - (29 - index) * day).toISOString().slice(0, 10),
          generations: populated ? Math.max(0, (index * 7) % 9) : 0,
          signups: populated && index % 11 === 0 ? 1 : 0,
          credits: populated ? Math.max(0, (index * 31) % 140) : 0,
        })),
      });
    },

    async loadUsers({ search } = {}) {
      const query = search?.trim().toLowerCase();
      const filtered = users
        .map((user) => ({
          ...user,
          creditBalance: balances.get(user.id) ?? user.creditBalance,
        }))
        .filter(
          (user) =>
            !query ||
            [user.email, user.name, user.handle]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(query),
        );

      return delay({ users: filtered, nextCursor: null });
    },

    async loadUser(id) {
      const user = users.find((entry) => entry.id === id);
      if (!user) throw new ApiError("Not found.", 404, "not_found");
      return delay({
        user: {
          ...user,
          creditBalance: balances.get(user.id) ?? user.creditBalance,
          clerkId: `user_${user.id}`,
          stripeCustomerId: null,
          recentGenerations: [],
          recentCredits: [],
          subscription: null,
        },
      });
    },

    async adjustCredits(input) {
      // The idempotency key is honoured here too, so the double-submit guard
      // can actually be exercised rather than assumed.
      if (applied.has(input.idempotencyKey)) {
        return delay({
          balance: balances.get(input.userId) ?? 0,
          applied: false,
        });
      }

      const current = balances.get(input.userId) ?? 0;
      if (current + input.amount < 0) {
        throw new ApiError(
          `That would leave a negative balance. They hold ${current}.`,
          400,
          "would_go_negative",
        );
      }

      applied.add(input.idempotencyKey);
      balances.set(input.userId, current + input.amount);
      return delay({ balance: current + input.amount, applied: true });
    },

    async setRole(_userId, role) {
      return delay({ role });
    },

    async loadReports() {
      return delay({ reports: [...reports] });
    },

    async resolveReport(commentId) {
      const index = reports.findIndex((entry) => entry.id === commentId);
      if (index >= 0) reports.splice(index, 1);
      return delay({ resolved: true as const });
    },

    async loadStatus() {
      const degraded = scenario === "degraded";
      return delay({
        overall: degraded ? ("down" as const) : ("ok" as const),
        generatedAt: now,
        checks: [
          {
            id: "database",
            label: "Database",
            level: degraded ? ("down" as const) : ("ok" as const),
            detail: degraded
              ? "Not reachable. Check DATABASE_URL and the pooler."
              : "Reachable.",
            checked: true,
            latencyMs: degraded ? 5012 : 14,
          },
          {
            id: "stripe",
            label: "Billing",
            level: degraded ? ("unconfigured" as const) : ("ok" as const),
            detail: degraded
              ? "Nothing can be purchased. Plans are shown for reference only."
              : "Fully configured.",
            checked: false,
          },
          {
            id: "providers",
            label: "AI providers",
            level: degraded ? ("degraded" as const) : ("ok" as const),
            detail: degraded
              ? "No provider credentials. Falling back to the labelled mock — 1 model offered, none of them real."
              : "5 models available.",
            checked: false,
          },
        ],
      });
    },

    async loadAudit() {
      return delay({
        entries: populated
          ? [
              {
                id: "a1",
                actorEmail: "staff@example.com",
                action: "credits.adjust",
                subjectType: "user",
                subjectId: "u_ada",
                detail: { amount: 500 },
                reason: "Goodwill for the failed batch — ticket 431",
                createdAt: now - 2 * 3_600_000,
              },
              {
                id: "a2",
                actorEmail: "staff@example.com",
                action: "support.view",
                subjectType: "user",
                subjectId: "u_lin",
                detail: null,
                reason: null,
                createdAt: now - 3 * 3_600_000,
              },
            ]
          : [],
      });
    },
  };
}

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "populated", label: "Populated" },
  { id: "empty", label: "Empty" },
  { id: "degraded", label: "Degraded" },
];

export default function AdminPreviewPage() {
  const [scenario, setScenario] = useState<Scenario>("populated");
  const [now] = useState(() => Date.now());
  const [api, setApi] = useState(() => createFixtureApi(now, "populated"));

  function choose(next: Scenario) {
    setScenario(next);
    setApi(() => createFixtureApi(now, next));
  }

  return (
    <AdminApiProvider value={api}>
      <div className="min-h-dvh">
        <div className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs">
          <p className="min-w-0">
            <span className="font-medium">Preview route.</span>{" "}
            <span className="text-muted-foreground">
              Fixtures in memory. This bypasses the admin gate entirely — that
              is checked by requesting <code>/admin</code> for real, not here.
            </span>
          </p>

          <div className="ml-auto flex items-center gap-1">
            {SCENARIOS.map((entry) => (
              <Button
                key={entry.id}
                size="xs"
                variant={scenario === entry.id ? "secondary" : "ghost"}
                onClick={() => choose(entry.id)}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        </div>

        <Container size="xl" className="py-8">
          <PageHeader
            title="Admin"
            description="Everything here is logged, including reading somebody's account."
          />
          <div className="mt-2 flex min-h-0 flex-col">
            <AdminDashboard key={scenario} />
          </div>
        </Container>
      </div>
    </AdminApiProvider>
  );
}
