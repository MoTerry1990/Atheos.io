"use client";

import {
  Activity,
  AlertTriangle,
  Check,
  Coins,
  CreditCard,
  Gavel,
  LifeBuoy,
  ScrollText,
  ServerCog,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { Textarea } from "@/components/ui/textarea";
import { CreditDialog } from "@/features/admin/components/credit-dialog";
import {
  ApiError,
  type AdminOverview,
  type AdminUserRow,
  type AuditEntry,
  type DailyActivity,
  type ReportedComment,
  type SystemStatus,
} from "@/features/admin/lib/api";
import { useAdminApi } from "@/features/admin/lib/api-context";
import { formatMoney } from "@/services/billing/catalogue";
import { formatRelativeTime } from "@/utils/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * The admin dashboard.
 *
 * ## Nine sections, one shell
 *
 * Sections rather than routes: an admin moves between users, moderation and
 * status constantly, and a route change per section loses the search and the
 * scroll each time.
 *
 * ## Numbers say what they are
 *
 * "Credits outstanding" is labelled a liability, not revenue — it is what we
 * owe people in unspent inference. "Recorded revenue" is labelled approximate,
 * because it is reconstructed from our own ledger rather than reconciled with
 * Stripe. A dashboard that lets those two read as the same kind of number is
 * how a business misstates itself to itself.
 *
 * ## Anything touching money asks twice
 *
 * Credit adjustments go through a dialog that requires a written reason and
 * shows the resulting balance before committing. The reason is not decoration —
 * it is the only thing that makes the audit entry reviewable.
 */

type Section = "analytics" | "users" | "moderation" | "status" | "audit";

const SECTIONS: { id: Section; label: string; icon: typeof Activity }[] = [
  { id: "analytics", label: "Analytics", icon: Activity },
  { id: "users", label: "Users & support", icon: Users },
  { id: "moderation", label: "Moderation", icon: Gavel },
  { id: "status", label: "System status", icon: ServerCog },
  { id: "audit", label: "Audit log", icon: ScrollText },
];

export function AdminDashboard() {
  const [section, setSection] = useState<Section>("analytics");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row">
      <nav aria-label="Admin sections" className="lg:w-52 lg:shrink-0">
        <ul className="space-y-0.5">
          {SECTIONS.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => setSection(entry.id)}
                aria-current={section === entry.id ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                  section === entry.id
                    ? "bg-secondary font-medium text-secondary-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <entry.icon className="size-4 shrink-0" aria-hidden />
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 flex-1">
        {section === "analytics" ? <AnalyticsSection /> : null}
        {section === "users" ? <UsersSection /> : null}
        {section === "moderation" ? <ModerationSection /> : null}
        {section === "status" ? <StatusSection /> : null}
        {section === "audit" ? <AuditSection /> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- analytics ----

function AnalyticsSection() {
  const api = useAdminApi();
  const [data, setData] = useState<{
    overview: AdminOverview;
    activity: DailyActivity[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.loadOverview());
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "Could not load analytics.",
      );
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <ErrorState
        title="Could not load analytics"
        description={error}
        onRetry={() => void load()}
      />
    );
  }

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  const { overview, activity } = data;
  const peak = Math.max(1, ...activity.map((day) => day.generations));

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Users" value={overview.users.total} icon={Users}>
          {overview.users.newThisWeek} new this week
        </Metric>
        <Metric
          label="Generations"
          value={overview.generations.total}
          icon={Activity}
        >
          {overview.generations.thisWeek} this week ·{" "}
          {overview.generations.failed} failed
        </Metric>
        <Metric
          label="Active subscriptions"
          value={overview.subscriptions.active}
          icon={CreditCard}
        >
          {overview.subscriptions.pastDue} past due ·{" "}
          {overview.subscriptions.canceling} cancelling
        </Metric>
        <Metric
          label="Recorded revenue"
          value={formatMoney(overview.recordedRevenueThisMonth)}
          icon={Coins}
        >
          {/* Said on the card, not in a footnote. This number is reconstructed
              from our ledger and misses refunds and disputes entirely. */}
          <span className="text-warning">Approximate</span> — this month, from
          our ledger, not reconciled with Stripe
        </Metric>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Credits outstanding"
          value={overview.credits.outstanding}
          icon={Coins}
        >
          {/* A liability, and labelled as one. It is unspent inference we owe. */}
          Held by users — a liability, not revenue
        </Metric>
        <Metric
          label="Granted this month"
          value={overview.credits.grantedThisMonth}
          icon={Coins}
        />
        <Metric
          label="Spent this month"
          value={overview.credits.spentThisMonth}
          icon={Coins}
        >
          Net of refunds
        </Metric>
      </section>

      {overview.subscriptions.byTier.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Subscriptions by plan</h2>
          <ul className="flex flex-wrap gap-2">
            {overview.subscriptions.byTier.map((row) => (
              <li
                key={row.tier}
                className="rounded-lg border border-border px-3 py-1.5 text-xs tabular-nums"
              >
                {row.name} <span className="font-medium">{row.count}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Generations, last 30 days</h2>
        {/* Bars, not a charting library. Thirty values with no interaction does
            not justify 40kB of JavaScript in a bundle only staff ever load. */}
        <div
          className="flex h-24 items-end gap-0.5"
          role="img"
          aria-label={`Daily generations over ${activity.length} days, peaking at ${peak}`}
        >
          {activity.map((day) => (
            <div
              key={day.date}
              title={`${day.date}: ${day.generations} generations, ${day.signups} signups`}
              className="min-w-0 flex-1 rounded-t bg-primary/60"
              style={{
                height: `${Math.max(2, (day.generations / peak) * 100)}%`,
              }}
            />
          ))}
        </div>
        <p className="text-2xs text-muted-foreground tabular-nums">
          {activity[0]?.date} – {activity[activity.length - 1]?.date} · peak{" "}
          {peak}
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="Published posts" value={overview.community.posts} />
        <Metric label="Comments" value={overview.community.comments} />
        <Metric
          label="Awaiting moderation"
          value={overview.community.reported}
          tone={overview.community.reported > 0 ? "warning" : undefined}
        />
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone,
  children,
}: {
  label: string;
  value: number | string;
  icon?: typeof Activity;
  tone?: "warning";
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        tone === "warning" ? "border-warning/40 bg-warning/5" : "border-border",
      )}
    >
      <p className="flex items-center gap-1.5 text-2xs font-medium tracking-wider text-muted-foreground uppercase">
        {Icon ? <Icon className="size-3" aria-hidden /> : null}
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">
        {typeof value === "number" ? value.toLocaleString("en-US") : value}
      </p>
      {children ? (
        <p className="mt-1 text-2xs text-muted-foreground">{children}</p>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------- users ----

function UsersSection() {
  const api = useAdminApi();
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<AdminUserRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.loadUsers({ search });
      setUsers(data.users);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "Could not load users.",
      );
    }
  }, [api, search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  return (
    <div className="space-y-4">
      <SearchInput
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onClear={() => setSearch("")}
        placeholder="Search by email, name or handle"
        aria-label="Search users"
      />

      {/* Said once, at the top. Opening an account is a disclosure and it is
          recorded — the person doing it should know that before they do it. */}
      <p className="text-2xs text-muted-foreground">
        Opening an account writes an entry to the audit log, including your
        email and theirs.
      </p>

      {error ? (
        <ErrorState
          title="Could not load users"
          description={error}
          onRetry={() => void load()}
        />
      ) : !users ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          icon={Users}
          title={search ? "Nobody matches that" : "No users yet"}
          description={
            search
              ? "Try an email, a name or a handle."
              : "Accounts appear here once somebody signs up."
          }
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {users.map((user) => (
            <li
              key={user.id}
              className="flex flex-wrap items-center gap-3 p-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{user.email}</span>
                  {user.role === "ADMIN" ? (
                    <Badge variant="brand" size="sm">
                      Admin
                    </Badge>
                  ) : null}
                  {user.subscriptionStatus === "PAST_DUE" ? (
                    <Badge variant="warning" size="sm">
                      Past due
                    </Badge>
                  ) : null}
                </p>
                <p className="text-2xs text-muted-foreground tabular-nums">
                  {user.handle ? `@${user.handle} · ` : ""}
                  {user.planName ?? "No plan"} · {user.generationCount}{" "}
                  generations · joined {formatRelativeTime(user.createdAt)}
                </p>
              </div>

              <span className="shrink-0 text-sm tabular-nums">
                {user.creditBalance.toLocaleString("en-US")}
              </span>

              <Button
                size="xs"
                variant="outline"
                onClick={() => setAdjusting(user)}
              >
                <Coins />
                Adjust
              </Button>
            </li>
          ))}
        </ul>
      )}

      <CreditDialog
        user={adjusting}
        onClose={() => setAdjusting(null)}
        onAdjusted={() => void load()}
      />
    </div>
  );
}

// ------------------------------------------------------------ moderation ----

function ModerationSection() {
  const api = useAdminApi();
  const [reports, setReports] = useState<ReportedComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.loadReports();
      setReports(data.reports);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "Could not load the queue.",
      );
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(
    report: ReportedComment,
    action: "remove" | "dismiss",
  ) {
    const reason = (reasons[report.id] ?? "").trim();
    if (reason.length < 3) {
      toast.error("State a reason", {
        description: "Both outcomes need one on the record.",
      });
      return;
    }

    setBusy(report.id);
    try {
      await api.resolveReport(report.id, action, reason);
      toast.success(
        action === "remove" ? "Comment removed" : "Report dismissed",
      );
      await load();
    } catch (cause) {
      toast.error("Could not apply that", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load the queue"
        description={error}
        onRetry={() => void load()}
      />
    );
  }

  if (!reports) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-lg" />
        ))}
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <EmptyState
        icon={Check}
        title="Nothing reported"
        description="Reported comments arrive here oldest first. There is no automated moderation — this queue is the review."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Oldest first. Dismissing is recorded too — a report nobody acted on and
        one somebody reviewed should not look the same.
      </p>

      <ul className="space-y-3">
        {reports.map((report) => (
          <li
            key={report.id}
            className="space-y-3 rounded-lg border border-border p-3"
          >
            <div>
              <p className="text-2xs text-muted-foreground">
                {report.author.handle
                  ? `@${report.author.handle}`
                  : report.author.email}{" "}
                · on /p/{report.post.slug} · reported{" "}
                {formatRelativeTime(report.reportedAt)}
              </p>
              <p className="mt-1 text-sm break-words">{report.body}</p>
            </div>

            <Textarea
              value={reasons[report.id] ?? ""}
              onChange={(event) =>
                setReasons((current) => ({
                  ...current,
                  [report.id]: event.target.value,
                }))
              }
              placeholder="Why — required for either outcome"
              rows={2}
              maxLength={500}
            />

            <div className="flex flex-wrap gap-2">
              <Button
                size="xs"
                variant="destructive"
                loading={busy === report.id}
                onClick={() => void resolve(report, "remove")}
              >
                Remove comment
              </Button>
              <Button
                size="xs"
                variant="outline"
                loading={busy === report.id}
                onClick={() => void resolve(report, "dismiss")}
              >
                Dismiss report
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- status ----

const LEVEL_STYLES: Record<
  SystemStatus["overall"],
  { label: string; variant: "success" | "warning" | "danger" | "outline" }
> = {
  ok: { label: "Healthy", variant: "success" },
  degraded: { label: "Degraded", variant: "warning" },
  down: { label: "Down", variant: "danger" },
  unconfigured: { label: "Unconfigured", variant: "outline" },
};

function StatusSection() {
  const api = useAdminApi();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStatus(await api.loadStatus());
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not run the status checks.",
      );
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <ErrorState
        title="Could not run the checks"
        description={error}
        onRetry={() => void load()}
      />
    );
  }

  if (!status) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={LEVEL_STYLES[status.overall].variant} size="sm" dot>
          {LEVEL_STYLES[status.overall].label}
        </Badge>
        <p className="text-2xs text-muted-foreground">
          Checked {formatRelativeTime(status.generatedAt)}
        </p>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => void load()}
        >
          Re-check
        </Button>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {status.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-3 p-3">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                check.level === "ok"
                  ? "bg-success"
                  : check.level === "degraded"
                    ? "bg-warning"
                    : check.level === "down"
                      ? "bg-destructive"
                      : "bg-muted-foreground",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {check.label}
                {/* The distinction between "we asked it" and "the variable is
                    set" is the whole value of a status page. */}
                <span className="text-2xs font-normal text-muted-foreground">
                  {check.checked
                    ? `verified${check.latencyMs !== undefined ? ` · ${check.latencyMs}ms` : ""}`
                    : "configuration only"}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {check.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------- audit ----

function AuditSection() {
  const api = useAdminApi();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.loadAudit();
      setEntries(data.entries);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not load the audit log.",
      );
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <ErrorState
        title="Could not load the audit log"
        description={error}
        onRetry={() => void load()}
      />
    );
  }

  if (!entries) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        title="Nothing recorded yet"
        description="Every admin action writes here, including opening somebody's account. Nothing deletes from it."
      />
    );
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {entries.map((entry) => (
        <li key={entry.id} className="p-3 text-xs">
          <p className="flex flex-wrap items-baseline gap-2">
            <code className="font-mono font-medium">{entry.action}</code>
            <span className="text-muted-foreground">
              {entry.subjectType}/{entry.subjectId.slice(-8)}
            </span>
            <span className="ml-auto text-2xs text-muted-foreground">
              {formatRelativeTime(entry.createdAt)}
            </span>
          </p>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {entry.actorEmail}
            {entry.reason ? ` — ${entry.reason}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

export { AlertTriangle, LifeBuoy };
