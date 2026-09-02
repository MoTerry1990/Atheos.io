import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { isBillingConfigured } from "@/services/billing/plans";
import { isStorageConfigured } from "@/services/storage/assets";
import { isUsingMockProvider } from "@/services/ai/registry";
import { quoteSigningReady } from "@/services/ai/plan-token";

/**
 * Liveness and dependency health, for uptime monitors.
 *
 * ## Why this exists separately from `/api/admin/status`
 *
 * `getSystemStatus()` already checks every dependency and is the better page
 * for a human — it explains *what is wrong and what to set*. It also requires
 * an admin session, and an uptime monitor does not have one.
 *
 * The two must not be merged. The admin view's value is exactly the detail it
 * returns ("no webhook signing secret — new sign-ups will not create user
 * rows"), and that detail is a description of how the deployment is
 * misconfigured. Published without authentication it is a map for an attacker.
 *
 * So this endpoint answers a deliberately smaller question: **is each
 * dependency usable, yes or no.** No versions, no variable names, no remedies,
 * no connection details. `MONITORING.md` sets that constraint and this honours
 * it.
 *
 * ## The status code is the contract
 *
 * `200` healthy, `503` not. Uptime monitors alert on status codes, not on
 * response bodies — a monitor that has to parse JSON to notice an outage is a
 * monitor that will miss one. The body is for a human who is already looking.
 *
 * Only the **database** can fail this endpoint. An unconfigured Stripe or a
 * mock AI provider is reported honestly but does not make the site "down": the
 * pages still render and a visitor can still sign up. Returning 503 for those
 * would page someone at 3am about a state that is intentional during a staged
 * rollout — and a monitor that cries wolf gets muted, which is worse than not
 * having one.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Dependency {
  name: string;
  ok: boolean;
  /** True when this was verified by contacting the thing, not inferred. */
  probed: boolean;
  latencyMs?: number;
}

export async function GET() {
  const dependencies: Dependency[] = [];

  // The only genuinely probed dependency, and the only one that can fail the
  // check. `SELECT 1` is the cheapest query that proves a working connection
  // through the pooler rather than merely a parsable connection string.
  const startedAt = Date.now();
  let databaseOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseOk = true;
  } catch (error) {
    // Logged, never returned: the exception text can carry the connection
    // string, and this response is public.
    console.error("Health check: database unreachable", error);
  }
  dependencies.push({
    name: "database",
    ok: databaseOk,
    probed: true,
    latencyMs: Date.now() - startedAt,
  });

  // Configuration-derived. Contacting Clerk, Stripe and R2 on every probe
  // would turn a health check into a source of load and of third-party rate
  // limiting — a monitor polling every 30s would make thousands of vendor
  // calls a day to learn something a local check already knows.
  /**
   * Can a generation be quoted?
   *
   * Added after a release shipped in which it could not. Every connector
   * quote is signed, an unsigned quote is refused rather than issued, and the
   * only outward symptom was a generic tool error — so the deployment looked
   * healthy while `prepare_generation` was returning a failure to every
   * caller. Nothing here contacts anything: it is one bit derived from local
   * configuration, which is all a monitor needs to notice.
   *
   * A **boolean**, never the reason. The reason names an environment variable
   * and belongs on the authenticated admin status page.
   */
  const generationReady = quoteSigningReady();

  dependencies.push(
    { name: "auth", ok: Boolean(env.CLERK_SECRET_KEY), probed: false },
    { name: "billing", ok: isBillingConfigured(), probed: false },
    { name: "storage", ok: isStorageConfigured(), probed: false },
    { name: "ai", ok: !isUsingMockProvider(), probed: false },
    { name: "generation", ok: generationReady, probed: false },
  );

  const healthy = databaseOk;

  return NextResponse.json(
    {
      /**
       * `degraded` is a third state, and it is still a 200.
       *
       * The rule above holds: only the database fails this endpoint, because
       * a monitor that pages someone at 3am about a staged rollout gets muted.
       * But "up and unable to quote" is not the same as "ok", and a monitor
       * that only ever sees two values cannot alert on the difference. So the
       * body distinguishes them and the status code does not.
       */
      status: !healthy ? "unhealthy" : generationReady ? "ok" : "degraded",
      generationReady,
      dependencies,
      timestamp: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      // A cached health check reports the past. `next.config.ts` already sets
      // `no-store` on `/api/*`; repeated here because this is the one route
      // where a stale answer is actively harmful.
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    },
  );
}
