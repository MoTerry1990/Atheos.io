import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * The Worker tick workflow, as configuration.
 *
 * ## Why a test file for a YAML file
 *
 * This workflow failed 346 consecutive times — every run for as long as the
 * schedule existed — in two seconds, at its own pre-flight guard, sending a
 * failure email each time. Nothing caught it, because nothing was watching: a
 * workflow is the one part of the repository that the test suite, the type
 * checker and the build all ignore completely.
 *
 * These assertions are cheap and they cover the properties whose absence was
 * actually expensive: a schedule that mails on every tick, no concurrency
 * guard, no timeout, a secret echoed into a public log.
 */

const WORKFLOW = path.join(process.cwd(), ".github/workflows/worker.yml");
const source = fs.readFileSync(WORKFLOW, "utf8");
const workflow = parse(source) as {
  on?: Record<string, unknown>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs?: Record<string, { "timeout-minutes"?: number; steps?: unknown[] }>;
};

describe("the schedule stays off until the secret exists", () => {
  it("has no active cron trigger", () => {
    /**
     * The whole point of the fix. Every scheduled run fails and emails until
     * `WORKER_TRIGGER_SECRET` is added, and re-enabling is a deliberate act by
     * someone who has just added it — not something that quietly comes back.
     */
    expect(workflow.on).toBeDefined();
    expect(workflow.on).not.toHaveProperty("schedule");
  });

  it("keeps the commented schedule so re-enabling is one uncomment", () => {
    // Deleted, the next person has to rediscover the interval and the reasoning.
    expect(source).toMatch(/#\s*schedule:/);
    expect(source).toMatch(/#\s*- cron: "\*\/15 \* \* \* \*"/);
  });

  it("can still be run by hand", () => {
    // So the secret can be proven green before the schedule mails anyone.
    expect(workflow.on).toHaveProperty("workflow_dispatch");
  });
});

describe("ticks cannot overlap", () => {
  it("declares a concurrency group", () => {
    expect(workflow.concurrency?.group).toBe("worker-tick");
  });

  it("queues rather than cancelling a tick already in flight", () => {
    // Cancelling mid-tick would abandon claimed jobs holding a five-minute
    // lease, which is strictly worse than letting the run finish.
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });
});

describe("a run cannot hang", () => {
  it("bounds the job", () => {
    const timeout = workflow.jobs?.tick?.["timeout-minutes"];
    expect(timeout).toBeDefined();
    // Long enough for a cold start, short enough not to bill for a stuck runner.
    expect(timeout).toBeLessThanOrEqual(5);
    expect(timeout).toBeGreaterThanOrEqual(2);
  });

  it("bounds the request itself", () => {
    expect(source).toMatch(/--max-time 120/);
  });
});

describe("failure detection survives the fix", () => {
  it("still fails on a non-2xx", () => {
    // "Stop the emails" must not become "stop noticing".
    expect(source).toMatch(/::error::Worker tick failed with HTTP/);
    expect(source).toMatch(/exit 1/);
  });

  it("distinguishes unreachable from rejected from thrown", () => {
    expect(source).toMatch(/Could not reach/);
    expect(source).toMatch(/returned 404/);
  });

  it("treats an empty queue as success", () => {
    // `runTick` returns its counters at zero with a 200. A worker with nothing
    // to do has done its job.
    expect(source).toMatch(/2\*\)/);
    expect(source).toMatch(/exit 0/);
  });

  it("does not retry the tick itself", () => {
    /**
     * The queue owns retrying an individual job, with backoff, in
     * `services/ai/retry.ts`. A workflow-level retry would give a failing job a
     * second attempt it has not earned and double the provider spend on it.
     */
    // Scoped to what executes. An earlier version of this grepped the whole
    // file for "retry" and failed on the comment above explaining the policy —
    // a test that reads prose rather than behaviour.
    const steps = (workflow.jobs?.tick?.steps ?? []) as {
      uses?: string;
      run?: string;
    }[];
    expect(steps.every((step) => step.uses === undefined)).toBe(true);

    const script = steps.map((step) => step.run ?? "").join("\n");
    expect(script).not.toMatch(/\b(until|while)\b/);
    expect(script).not.toMatch(/for\s+\w+\s+in\s+.*\bseq\b/);
  });
});

describe("nothing secret reaches a public log", () => {
  it("never echoes the secret", () => {
    // The repository is public; every workflow log is world-readable.
    expect(source).not.toMatch(/echo\s+.*\$SECRET/);
    expect(source).not.toMatch(/echo\s+.*secrets\./);
  });

  it("passes the secret only in the Authorization header", () => {
    expect(source).toMatch(/-H "Authorization: Bearer \$SECRET"/);
    // Never in the URL, where it would land in logs and access records.
    expect(source).not.toMatch(/\$SECRET.*\$URL|\$URL.*\?.*\$SECRET/);
  });

  it("treats the deployment URL as a variable, not a secret", () => {
    /**
     * It was a required *secret*, and half of every failure message blamed it.
     * A public deployment URL is not a secret; making it one added a way to
     * break the job without adding any protection.
     */
    expect(source).toMatch(/vars\.PRODUCTION_URL/);
    expect(source).not.toMatch(/secrets\.PRODUCTION_URL/);
  });

  it("requires exactly one secret", () => {
    const secrets = [...source.matchAll(/secrets\.([A-Z_]+)/g)].map(
      (m) => m[1],
    );
    expect([...new Set(secrets)]).toEqual(["WORKER_TRIGGER_SECRET"]);
  });
});
