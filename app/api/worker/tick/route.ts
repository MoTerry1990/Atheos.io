import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import { runTick } from "@/services/worker/runner";

/**
 * The worker trigger.
 *
 * ## Why a route and not a process
 *
 * A long-running Node process is the obvious way to run a worker and it does
 * not exist on a serverless platform. So the worker is a **function** —
 * `runTick()` — and this route is one way to call it. A container running
 * `node worker.mjs` in a loop is another, and both call the same function.
 *
 * That shape is deliberate: the deployment target is not decided here, and
 * choosing one would have made the worker unusable on the other.
 *
 * ## Authentication is a shared secret, not a session
 *
 * There is no user here. A cron has no cookie and no Clerk session, so the
 * trigger authenticates with `WORKER_TRIGGER_SECRET`.
 *
 * Without it the endpoint **refuses to run at all** rather than defaulting to
 * open. An unauthenticated worker trigger is a free way for a stranger to make
 * us do work, and the work in question submits jobs to paid providers.
 *
 * Compared in constant time. A plain `===` on a secret leaks how much of it was
 * correct through timing, and this one is guessable-by-length otherwise.
 *
 * ## Why POST, and why it is not idempotent in the usual sense
 *
 * A tick has effects, so GET would be wrong. But two ticks racing is safe and
 * expected: `claimJobs` uses `FOR UPDATE SKIP LOCKED`, so a second concurrent
 * tick sees the jobs the first did not take rather than the same ones. That is
 * the property that makes it safe to over-schedule the cron.
 */

// The tick polls providers, so it needs longer than a default request budget —
// but it is bounded, and `runTick` stops claiming work when it runs low.
export const maxDuration = 60;

/** Never cached, never prerendered. */
export const dynamic = "force-dynamic";

function authorised(request: NextRequest): boolean {
  const secret = env.WORKER_TRIGGER_SECRET;
  if (!secret) return false;

  // `Authorization: Bearer <secret>` so it works with any scheduler, plus the
  // header Vercel Cron sends.
  const header =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-worker-secret") ??
    "";

  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(secret, "utf8");

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    if (!env.WORKER_TRIGGER_SECRET) {
      console.error("worker tick called but WORKER_TRIGGER_SECRET is unset");
    }

    // 404, not 401. Same reasoning as the admin surface (§ 38): a 401 confirms
    // the endpoint exists and is worth attacking. A scheduler that is correctly
    // configured never sees this.
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const result = await runTick();
    return NextResponse.json(result);
  } catch (error) {
    // A failed tick must not look like a successful one, or a scheduler will
    // report green while the queue backs up.
    console.error("worker tick failed", error);
    return NextResponse.json({ error: "Tick failed." }, { status: 500 });
  }
}
