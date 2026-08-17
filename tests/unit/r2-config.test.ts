import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The R2 configuration guard.
 *
 * ## What this exists to catch
 *
 * Three sprints of failed deliveries, one wrong diagnosis and a purpose-built
 * production probe, for a defect visible in the values themselves:
 *
 *   R2_ACCESS_KEY_ID      55 characters, not hexadecimal
 *   R2_SECRET_ACCESS_KEY  32 hexadecimal characters + a trailing newline
 *
 * A real R2 credential pair is 32 and 64 lowercase hex. Both variables were
 * *present*, which is all `isStorageConfigured()` ever checked, so `/api/health`
 * reported storage healthy and `submitGeneration` took the customer's credits
 * while every upload was rejected with `400 InvalidArgument` — a status that
 * names none of the five variables involved.
 *
 * The first two cases below are those exact values. They must fail.
 *
 * `env` is mocked per-test because `lib/env.ts` validates at import against the
 * real process environment; the point here is to drive the checker with
 * configurations that could never be set locally.
 */

async function problemsFor(overrides: Record<string, string | undefined>) {
  vi.resetModules();

  vi.doMock("@/lib/env", () => ({
    env: {
      R2_ACCOUNT_ID: "a".repeat(32),
      R2_ACCESS_KEY_ID: "b".repeat(32),
      R2_SECRET_ACCESS_KEY: "c".repeat(64),
      R2_BUCKET_NAME: "atheos-assets",
      NEXT_PUBLIC_R2_PUBLIC_URL: "https://pub-example.r2.dev",
      ...overrides,
    },
  }));

  const { r2ConfigProblems } = await import("@/lib/r2");
  return r2ConfigProblems();
}

afterEach(() => {
  vi.doUnmock("@/lib/env");
  vi.resetModules();
});

describe("the exact production defect", () => {
  it("rejects a 55-character non-hex access key id", async () => {
    // The real value, by shape: neither 32 characters nor hexadecimal.
    const problems = await problemsFor({
      R2_ACCESS_KEY_ID: "x".repeat(55),
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].variable).toBe("R2_ACCESS_KEY_ID");
    expect(problems[0].problem).toContain("32 lowercase hexadecimal");
    // The message must say how long it actually is — that is the fact that
    // makes the defect obvious to whoever reads it.
    expect(problems[0].problem).toContain("55 characters");
  });

  it("rejects a secret with a trailing newline", async () => {
    // The other half of the real value: correct-looking, invisibly broken.
    const problems = await problemsFor({
      R2_SECRET_ACCESS_KEY: `${"c".repeat(64)}\n`,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].variable).toBe("R2_SECRET_ACCESS_KEY");
    expect(problems[0].problem).toContain("whitespace");
  });

  it("rejects the production pair as it actually stood", async () => {
    // Both defects together, which is what production held.
    const problems = await problemsFor({
      R2_ACCESS_KEY_ID: "x".repeat(55),
      R2_SECRET_ACCESS_KEY: `${"c".repeat(32)}\n`,
    });

    expect(problems.map((p) => p.variable).sort()).toEqual([
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
    ]);
  });

  it("accepts a correctly shaped configuration", async () => {
    // The state production reached after the credentials were replaced.
    expect(await problemsFor({})).toEqual([]);
  });
});

describe("every variable is checked, not just presence", () => {
  it("rejects a secret of the wrong length", async () => {
    // 32 hex is an *access key id*, not a secret. Swapping the two fields is
    // the mistake that produced the outage.
    const problems = await problemsFor({
      R2_SECRET_ACCESS_KEY: "c".repeat(32),
    });
    expect(problems[0]).toMatchObject({ variable: "R2_SECRET_ACCESS_KEY" });
    expect(problems[0].problem).toContain("64 lowercase hexadecimal");
  });

  it("rejects uppercase hex, which R2 never issues", async () => {
    const problems = await problemsFor({ R2_ACCOUNT_ID: "A".repeat(32) });
    expect(problems[0]).toMatchObject({ variable: "R2_ACCOUNT_ID" });
  });

  it("rejects a value wrapped in quotes", async () => {
    // `KEY="value"` in a dashboard field stores the quotes as part of the value.
    const problems = await problemsFor({
      R2_ACCESS_KEY_ID: `"${"b".repeat(32)}"`,
    });
    expect(problems[0].problem).toContain("quotes");
  });

  it("reports a missing variable as missing, not malformed", async () => {
    // Different defect, different fix: one is "set it", the other "fix it".
    const problems = await problemsFor({ R2_BUCKET_NAME: undefined });
    expect(problems[0]).toEqual({
      variable: "R2_BUCKET_NAME",
      problem: "is missing",
    });
  });

  it("treats an empty string as missing", async () => {
    expect(await problemsFor({ R2_SECRET_ACCESS_KEY: "   " })).toEqual([
      { variable: "R2_SECRET_ACCESS_KEY", problem: "is missing" },
    ]);
  });

  it("rejects a bucket name with uppercase or spaces", async () => {
    for (const bucket of ["Atheos-Assets", "atheos assets", "a"]) {
      const problems = await problemsFor({ R2_BUCKET_NAME: bucket });
      expect(problems[0]?.variable, bucket).toBe("R2_BUCKET_NAME");
    }
  });

  it("requires an https public URL", async () => {
    const problems = await problemsFor({
      NEXT_PUBLIC_R2_PUBLIC_URL: "http://pub-example.r2.dev",
    });
    expect(problems[0]).toMatchObject({
      variable: "NEXT_PUBLIC_R2_PUBLIC_URL",
    });
  });

  it("reports every defect at once rather than the first", async () => {
    // An operator fixing one variable per deploy is an operator doing five
    // deploys. The message names all of them.
    const problems = await problemsFor({
      R2_ACCOUNT_ID: "nope",
      R2_ACCESS_KEY_ID: undefined,
      R2_SECRET_ACCESS_KEY: "short",
      R2_BUCKET_NAME: "BAD NAME",
      NEXT_PUBLIC_R2_PUBLIC_URL: undefined,
    });
    expect(problems).toHaveLength(5);
  });
});

describe("problems never disclose the value", () => {
  it("keeps the secret out of the report", async () => {
    // These messages are thrown, logged and surfaced in health output. A
    // credential that reaches a log has left the building.
    const secret = "deadbeef".repeat(9);
    const problems = await problemsFor({ R2_SECRET_ACCESS_KEY: secret });

    const serialised = JSON.stringify(problems);
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain("deadbeef");
  });

  it("keeps a quoted value out of the report", async () => {
    const problems = await problemsFor({
      R2_ACCESS_KEY_ID: `"${"b".repeat(32)}"`,
    });
    expect(JSON.stringify(problems)).not.toContain("b".repeat(32));
  });
});

describe("storage readiness follows validity, not presence", () => {
  async function storageConfigured(
    overrides: Record<string, string | undefined>,
  ) {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: {
        R2_ACCOUNT_ID: "a".repeat(32),
        R2_ACCESS_KEY_ID: "b".repeat(32),
        R2_SECRET_ACCESS_KEY: "c".repeat(64),
        R2_BUCKET_NAME: "atheos-assets",
        NEXT_PUBLIC_R2_PUBLIC_URL: "https://pub-example.r2.dev",
        ...overrides,
      },
    }));
    const { isStorageConfigured } = await import("@/services/storage/assets");
    return isStorageConfigured();
  }

  it("reports storage unusable when the credentials are malformed", async () => {
    /**
     * The regression that matters most. Under the old presence check this
     * returned true for the production configuration, so `/api/health` said
     * storage was fine and `submitGeneration` reserved credits for a job that
     * could never be delivered. It must now refuse *before* the money moves.
     */
    expect(await storageConfigured({ R2_ACCESS_KEY_ID: "x".repeat(55) })).toBe(
      false,
    );
    expect(
      await storageConfigured({ R2_SECRET_ACCESS_KEY: `${"c".repeat(64)}\n` }),
    ).toBe(false);
  });

  it("reports storage usable when everything is well formed", async () => {
    expect(await storageConfigured({})).toBe(true);
  });
});
