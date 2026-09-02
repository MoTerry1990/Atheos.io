import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "Can this deployment quote a generation?" — asked before a release, not after.
 *
 * ## What this is for
 *
 * A release shipped in which it could not. `CREATIVE_PLAN_SIGNING_SECRET` was
 * absent from the deployment, `signingKey()` refused to sign rather than
 * falling back to an empty key — which is the correct behaviour — and the only
 * outward symptom was `prepare_generation` returning "Something went wrong
 * running that tool." The database was fine, the build was fine, the health
 * check said `ok`, and the connector was unusable.
 *
 * The fix is not to make signing lenient. It is to make the condition
 * *visible*: one bit on the public health check, the full reason on the
 * authenticated admin page, and these tests pinning both shapes.
 *
 * ## Why the environment is manipulated directly
 *
 * `lib/env.ts` validates and caches `process.env` at import time, so a test
 * that merely sets a variable changes nothing. Each case below re-imports the
 * module graph with `vi.resetModules()` so the snapshot is taken again — which
 * is also the only honest way to exercise "started without the secret".
 */

const REAL = process.env.CREATIVE_PLAN_SIGNING_SECRET;

/** 64 hex characters. Structurally valid, and not a secret. */
const VALID =
  "9f2c1a7d4b6e8035c19d7f4a2b8e6c035a1d9f7b3e5c8027a4f6d1b9e3c7502a";

async function withSecret(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.CREATIVE_PLAN_SIGNING_SECRET;
  else process.env.CREATIVE_PLAN_SIGNING_SECRET = value;
  return import("@/services/ai/plan-token");
}

afterEach(() => {
  if (REAL === undefined) delete process.env.CREATIVE_PLAN_SIGNING_SECRET;
  else process.env.CREATIVE_PLAN_SIGNING_SECRET = REAL;
  vi.resetModules();
});

describe("a complete configuration can sign", () => {
  it("reports ready and issues a token", async () => {
    const mod = await withSecret(VALID);

    expect(mod.quoteSigningReady()).toBe(true);
    expect(mod.creativePlanConfigProblems()).toEqual([]);

    const { token } = mod.issuePlanToken({
      userId: "u_1",
      brief: {
        version: 1,
        originalPrompt: "a paper boat on a still pond",
        kind: "sequence",
        publicModelId: "atheos-image-fast",
        mode: "single",
        durationSeconds: 0,
        outputs: 1,
        clips: 1,
      },
      modelId: "atheos-image-fast",
      quotedCredits: 4,
      nowMs: Date.now(),
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

describe("an incomplete configuration cannot, and says so once", () => {
  it("reports not ready when the secret is absent", async () => {
    const mod = await withSecret(undefined);

    expect(mod.quoteSigningReady()).toBe(false);
    expect(mod.creativePlanConfigProblems()).toHaveLength(1);
  });

  it("refuses to sign rather than signing with nothing", async () => {
    /**
     * The property worth protecting. An empty key would still produce a
     * `<body>.<signature>` that verifies — for anyone, since the key is
     * guessable — so a token that looks signed and is not is strictly worse
     * than a refusal.
     */
    const mod = await withSecret(undefined);

    expect(() =>
      mod.issuePlanToken({
        userId: "u_1",
        brief: {
          version: 1,
          originalPrompt: "x",
          kind: "sequence",
          publicModelId: "atheos-image-fast",
          mode: "single",
          durationSeconds: 0,
          outputs: 1,
          clips: 1,
        },
        modelId: "atheos-image-fast",
        quotedCredits: 4,
        nowMs: Date.now(),
      }),
    ).toThrow(/refusing to sign/);
  });

  it("rejects a secret that is too short or looks like a placeholder", async () => {
    // Both are worse than absent, because they look configured.
    expect((await withSecret("short")).quoteSigningReady()).toBe(false);
    expect(
      (
        await withSecret("changeme-changeme-changeme-changeme")
      ).quoteSigningReady(),
    ).toBe(false);
    expect((await withSecret(` ${VALID} `)).quoteSigningReady()).toBe(false);
  });

  it("does not confuse signing with the Director's feature flag", async () => {
    /**
     * The mistake this release actually made, pinned so it cannot recur.
     *
     * `creativeDirectorReady()` needs the flag *and* the secret;
     * `quoteSigningReady()` needs only the secret. The connector runs on the
     * second, so reporting a missing flag as a missing secret — or requiring
     * the flag before a connector can quote — is wrong in both directions.
     */
    const mod = await withSecret(VALID);
    const flag = process.env.ENABLE_CREATIVE_DIRECTOR;
    delete process.env.ENABLE_CREATIVE_DIRECTOR;

    try {
      expect(mod.quoteSigningReady()).toBe(true);
      expect(mod.creativeDirectorReady().ready).toBe(false);
      expect(mod.creativeDirectorReady().configured).toBe(true);
    } finally {
      if (flag !== undefined) process.env.ENABLE_CREATIVE_DIRECTOR = flag;
    }
  });
});

describe("the public health check never names the secret", () => {
  it("exposes a boolean and no reason", async () => {
    /**
     * `/api/health` is unauthenticated. "CREATIVE_PLAN_SIGNING_SECRET is not
     * set" published to strangers is a map of which lever is loose, so the
     * route may call `quoteSigningReady()` and must not call
     * `creativePlanConfigProblems()`.
     *
     * Asserted against the route's source, because the property is that the
     * detailed function is not *reachable* from it — a future edit that wants
     * a better error message has to add the import back, visibly, in a diff.
     */
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");

    const route = readFileSync(
      path.resolve(import.meta.dirname, "../../app/api/health/route.ts"),
      "utf8",
    );

    expect(route).toContain("quoteSigningReady");
    expect(route).not.toContain("creativePlanConfigProblems");
    expect(route).not.toMatch(/CREATIVE_PLAN_SIGNING_SECRET/);
    // The three states a monitor can act on, and the flag that carries it.
    expect(route).toContain("generationReady");
    expect(route).toContain("degraded");
  });

  it("keeps the detailed reason on the authenticated page", async () => {
    // The other half: the admin status page is where the variable may be
    // named, because the only person who can set it is reading it.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");

    const status = readFileSync(
      path.resolve(import.meta.dirname, "../../services/admin/status.ts"),
      "utf8",
    );

    expect(status).toContain("creativePlanConfigProblems");
    expect(status).toContain("quote-signing");
  });
});
