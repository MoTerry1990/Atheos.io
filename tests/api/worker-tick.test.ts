import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The worker tick endpoint, as the scheduler sees it.
 *
 * ## Why this did not exist before
 *
 * The queue underneath it is well covered — nineteen PGlite tests prove
 * claiming, lease expiry, retry backoff and that two workers never take the
 * same job. The *door* was not covered at all, and the door is the entire
 * contract between this repository and the scheduler that failed 346 times.
 *
 * `runTick` is mocked. This is a test of authentication and response shape, and
 * running the real tick would touch a database and a provider — the two things
 * a test of an HTTP handler has no business doing, and one of them costs money.
 */

const SECRET = "a-test-worker-secret-long-enough";

const runTick = vi.fn();
let secret: string | undefined = SECRET;

vi.mock("@/services/worker/runner", () => ({
  runTick: (...args: unknown[]) => runTick(...args),
}));

vi.mock("@/lib/env", () => ({
  get env() {
    return { WORKER_TRIGGER_SECRET: secret };
  },
}));

const { POST, GET } = await import("@/app/api/worker/tick/route");

/** An empty queue: every counter zero, which is a successful tick. */
const IDLE = {
  workerId: "w_abc12345",
  claimed: 0,
  advanced: 0,
  completed: 0,
  failed: 0,
  retrying: 0,
  webhooksDelivered: 0,
  depth: { queued: 0, running: 0, retrying: 0 },
  freeGrants: { granted: 0, missing: 0, duplicated: 0 },
  rateLimitRowsSwept: 0,
  durationMs: 12,
};

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://atheos-io.vercel.app/api/worker/tick", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  runTick.mockReset();
  runTick.mockResolvedValue(IDLE);
  secret = SECRET;
});

describe("authentication", () => {
  it("accepts the secret as a bearer token", async () => {
    // The shape the workflow sends.
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(IDLE);
  });

  it("accepts the x-worker-secret header", async () => {
    // So the endpoint is not tied to one scheduler's conventions.
    const response = await POST(request({ "x-worker-secret": SECRET }));
    expect(response.status).toBe(200);
  });

  it("answers 404 with no credentials at all", async () => {
    /**
     * 404 rather than 401, deliberately: a 401 confirms the endpoint exists and
     * is worth attacking. A correctly configured scheduler never sees this.
     */
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(runTick).not.toHaveBeenCalled();
  });

  it("answers 404 for a wrong secret of the same length", async () => {
    const wrong = "b".repeat(SECRET.length);
    const response = await POST(request({ authorization: `Bearer ${wrong}` }));
    expect(response.status).toBe(404);
    expect(runTick).not.toHaveBeenCalled();
  });

  it("answers 404 for a wrong secret of a different length", async () => {
    // `timingSafeEqual` throws on unequal lengths, so the comparison has to
    // check length first. Getting that wrong turns a bad guess into a 500.
    const response = await POST(request({ authorization: "Bearer short" }));
    expect(response.status).toBe(404);
  });

  it("answers 404 when the deployment has no secret configured", async () => {
    /**
     * The state the workflow cannot distinguish from a wrong secret, which is
     * why its error message names both possibilities instead of guessing one.
     */
    secret = undefined;
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(404);
    expect(runTick).not.toHaveBeenCalled();
  });

  it("never runs the tick for an unauthenticated caller", async () => {
    await POST(request({ authorization: "Bearer wrong" }));
    await POST(request({ "x-worker-secret": "wrong" }));
    await POST(request());
    expect(runTick).not.toHaveBeenCalled();
  });
});

describe("an empty queue is a clean success", () => {
  it("returns 200 with the counters at zero", async () => {
    /**
     * The requirement the workflow depends on: most ticks have nothing to do,
     * and a worker with nothing to do has done its job. If this were anything
     * but a 2xx the schedule would mail on almost every run.
     */
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.claimed).toBe(0);
    expect(body.completed).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.depth).toEqual({ queued: 0, running: 0, retrying: 0 });
  });

  it("reports work when there was work", async () => {
    runTick.mockResolvedValue({ ...IDLE, claimed: 3, completed: 2 });
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    const body = await response.json();
    expect(body.claimed).toBe(3);
    expect(body.completed).toBe(2);
  });

  it("runs the tick exactly once per request", async () => {
    // The workflow must not be able to double-process by being called once.
    await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(runTick).toHaveBeenCalledTimes(1);
  });
});

describe("a failing tick is reported as a failure", () => {
  it("returns 500 when the tick throws", async () => {
    /**
     * A failed tick must not look like a successful one, or the scheduler
     * reports green while the queue backs up — which is exactly how "nothing
     * schedules the tick" went unnoticed for six sprints.
     */
    runTick.mockRejectedValue(new Error("provider unreachable"));
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(500);
  });

  it("does not leak the error text to the caller", async () => {
    runTick.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });

  it("does not retry internally", async () => {
    // Re-attempting a job is the queue's decision, with backoff, not the
    // endpoint's. A retry here would double provider spend on a failing job.
    runTick.mockRejectedValue(new Error("boom"));
    await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(runTick).toHaveBeenCalledTimes(1);
  });
});

describe("GET, because Vercel Cron sends no other verb", () => {
  function getRequest(headers: Record<string, string> = {}) {
    return new NextRequest("https://atheos-io.vercel.app/api/worker/tick", {
      method: "GET",
      headers,
    });
  }

  it("runs the tick for an authenticated GET", async () => {
    const response = await GET(
      getRequest({ authorization: `Bearer ${SECRET}` }),
    );
    expect(response.status).toBe(200);
    expect(runTick).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for an unauthenticated GET", async () => {
    // A crawler or prefetcher finding this URL gets the same nothing as anyone
    // else, which is what makes a non-safe GET acceptable here.
    const response = await GET(getRequest());
    expect(response.status).toBe(404);
    expect(runTick).not.toHaveBeenCalled();
  });
});
