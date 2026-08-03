import "server-only";

import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { requireAdmin } from "@/services/admin/auth";
import {
  isBillingConfigured,
  billingConfigurationProblems,
} from "@/services/billing/plans";
import { isUsingMockProvider, listModels } from "@/services/ai/registry";
import { isStorageConfigured } from "@/services/storage/assets";

/**
 * System status.
 *
 * ## Measured, not declared
 *
 * The database check runs an actual query. Everything else reports whether a
 * credential is present, which is what can honestly be known without spending
 * money or hitting a rate limit on every dashboard load.
 *
 * That distinction is in the output — `checked` versus `configured` — because a
 * green light meaning "the variable is set" and a green light meaning "we just
 * talked to it" are different guarantees, and a status page that conflates them
 * is how an outage gets missed.
 *
 * ## Degraded is a state, not a failure
 *
 * No AI provider configured is not an outage: the registry falls back to the
 * mock and the studio still works, saying so. Reporting that as "down" would
 * train whoever reads this page to ignore red.
 */

export type CheckLevel = "ok" | "degraded" | "down" | "unconfigured";

export interface SystemCheck {
  id: string;
  label: string;
  level: CheckLevel;
  detail: string;
  /** True when this was verified by contacting the thing. */
  checked: boolean;
  latencyMs?: number;
}

export interface SystemStatus {
  checks: SystemCheck[];
  /** The worst level present. What a glance should land on. */
  overall: CheckLevel;
  generatedAt: number;
}

export async function getSystemStatus(): Promise<SystemStatus> {
  await requireAdmin();

  const checks: SystemCheck[] = [];

  // ---- Database: actually queried -----------------------------------------
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({
      id: "database",
      label: "Database",
      level: "ok",
      detail: "Reachable.",
      checked: true,
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    checks.push({
      id: "database",
      label: "Database",
      level: "down",
      // The exception can carry a connection string. Never returned; the
      // message is a category, and the detail goes to the server log.
      detail: "Not reachable. Check DATABASE_URL and the pooler.",
      checked: true,
      latencyMs: Date.now() - started,
    });
    console.error("System status: database unreachable", error);
  }

  // ---- Identity -----------------------------------------------------------
  checks.push({
    id: "clerk",
    label: "Authentication",
    level: env.CLERK_WEBHOOK_SIGNING_SECRET ? "ok" : "degraded",
    detail: env.CLERK_WEBHOOK_SIGNING_SECRET
      ? "Configured, webhook signing enabled."
      : "No webhook signing secret — new sign-ups will not create user rows.",
    checked: false,
  });

  // ---- Billing ------------------------------------------------------------
  const billingProblems = billingConfigurationProblems();
  checks.push({
    id: "stripe",
    label: "Billing",
    level: isBillingConfigured()
      ? billingProblems.length > 0
        ? "degraded"
        : "ok"
      : "unconfigured",
    detail: isBillingConfigured()
      ? billingProblems.length > 0
        ? `Working, but incomplete: ${billingProblems.join(", ")}.`
        : "Fully configured."
      : "Nothing can be purchased. Plans are shown for reference only.",
    checked: false,
  });

  // ---- Storage ------------------------------------------------------------
  checks.push({
    id: "storage",
    label: "Object storage",
    level: isStorageConfigured() ? "ok" : "down",
    detail: isStorageConfigured()
      ? "R2 configured."
      : "Generation is disabled — results could not be saved.",
    checked: false,
  });

  // ---- AI providers -------------------------------------------------------
  const models = listModels();
  const mock = isUsingMockProvider();
  checks.push({
    id: "providers",
    label: "AI providers",
    level: mock ? "degraded" : "ok",
    detail: mock
      ? `No provider credentials. Falling back to the labelled mock — ${models.length} model${models.length === 1 ? "" : "s"} offered, none of them real.`
      : `${models.length} model${models.length === 1 ? "" : "s"} available.`,
    checked: false,
  });

  // ---- Admin access -------------------------------------------------------
  const allowlistSize = (env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean).length;

  checks.push({
    id: "admin",
    label: "Admin access",
    level: allowlistSize > 0 ? "ok" : "degraded",
    detail:
      allowlistSize > 0
        ? `${allowlistSize} id${allowlistSize === 1 ? "" : "s"} in ADMIN_USER_IDS.`
        : "ADMIN_USER_IDS is empty. Access depends entirely on the role column, with no recovery path if it is wrong.",
    checked: false,
  });

  const rank: Record<CheckLevel, number> = {
    ok: 0,
    unconfigured: 1,
    degraded: 2,
    down: 3,
  };

  const overall = checks.reduce<CheckLevel>(
    (worst, check) => (rank[check.level] > rank[worst] ? check.level : worst),
    "ok",
  );

  return { checks, overall, generatedAt: Date.now() };
}
