import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * The project-identity guard.
 *
 * ## What this prevents
 *
 * A preview command issued for Atheos started **Wasipe** — a tool resolved a
 * launch config from a third directory, found no entry matching the name it was
 * given, and fell back to the only one present. Nothing was written to the
 * wrong repository that time. A `dev`, `build` or `test` run from the same
 * wrong directory would not have been so harmless.
 *
 * ## Why these tests run the real script
 *
 * The guard is a `.mjs` file invoked by npm scripts, so importing a function
 * from it would test something the scripts never execute. Each case builds a
 * throwaway directory with a `package.json` — and where it matters, a real git
 * repository with a real remote — and runs the actual command, checking its
 * exit code the way npm will.
 *
 * Nothing here touches the Wasipe repository. The "inside Wasipe" cases are
 * simulated with fixtures, which is also the only way they can run in CI.
 */

const SCRIPT = path.join(process.cwd(), "scripts/verify-project.mjs");
const ATHEOS = {
  name: "atheos",
  remote: "MoTerry1990/Atheos.io",
  port: 3000,
  conflictsWith: ["wasipe"],
};
const WASIPE = {
  name: "wasipe",
  remote: "MoTerry1990/Wasipe",
  port: 3001,
  conflictsWith: ["atheos"],
};

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway project, optionally a git repository with a given origin. */
function fixture(options: {
  dirName?: string;
  pkg: Record<string, unknown>;
  origin?: string;
}): string {
  const base = mkdtempSync(path.join(tmpdir(), "identity-"));
  made.push(base);

  const dir = options.dirName ? path.join(base, options.dirName) : base;
  if (options.dirName) mkdirSync(dir, { recursive: true });

  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(options.pkg, null, 2),
  );

  if (options.origin) {
    const run = (args: string[]) =>
      execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    run(["init", "-q"]);
    run(["remote", "add", "origin", options.origin]);
  }

  return dir;
}

/** Run the guard in `dir`. Returns the exit code and what it said. */
function guard(dir: string, args: string[] = []) {
  /**
   * `spawnSync` rather than `execFileSync`, so both streams are available
   * whatever the exit code.
   *
   * The first version used `execFileSync` and kept only stdout on success. The
   * guard warns on **stderr** when it cannot read a remote, so the
   * no-git-repository case passed while asserting nothing — a green test for
   * the wrong reason, which is worse than a red one.
   */
  const result = spawnSync("node", [SCRIPT, ...args], {
    cwd: dir,
    encoding: "utf8",
  });
  return {
    code: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("the real repository passes", () => {
  it("verifies Atheos from the Atheos root", () => {
    const result = guard(process.cwd());
    expect(result.code).toBe(0);
    expect(result.output).toContain("atheos");
    expect(result.output).toContain("verified");
  });

  it("accepts the Atheos port", () => {
    expect(guard(process.cwd(), ["--port", "3000"]).code).toBe(0);
  });

  it("refuses Wasipe's port inside Atheos", () => {
    // The exact confusion that started this: Atheos work, port 3001.
    const result = guard(process.cwd(), ["--port", "3001"]);
    expect(result.code).toBe(1);
    expect(result.output).toContain("atheos runs on 3000");
  });

  it("prints no secret, environment value or absolute path beyond the root", () => {
    const output = guard(process.cwd()).output;
    expect(output).not.toMatch(/sk_|whsec_|r8_|password|token/i);
    expect(output).not.toMatch(/C:\\Users/);
  });
});

describe("Atheos identity refuses a simulated Wasipe", () => {
  it("fails on Wasipe's package name", () => {
    const dir = fixture({
      pkg: { name: "wasipe", projectIdentity: ATHEOS },
      origin: "https://github.com/MoTerry1990/Atheos.io.git",
    });
    const result = guard(dir);
    expect(result.code).toBe(1);
    expect(result.output).toContain('name is "wasipe"');
  });

  it("fails on Wasipe's remote", () => {
    const dir = fixture({
      pkg: { name: "atheos", projectIdentity: ATHEOS },
      origin: "https://github.com/MoTerry1990/Wasipe.git",
    });
    const result = guard(dir);
    expect(result.code).toBe(1);
    expect(result.output).toContain("moterry1990/wasipe");
  });

  it("fails when the path runs through a wasipe directory", () => {
    /**
     * Catches what identity alone would miss — a nested checkout, or a command
     * run from inside one repository against the other's manifest.
     */
    const dir = fixture({
      dirName: "wasipe",
      pkg: { name: "atheos", projectIdentity: ATHEOS },
      origin: "https://github.com/MoTerry1990/Atheos.io.git",
    });
    const result = guard(dir);
    expect(result.code).toBe(1);
    expect(result.output).toContain('path segment named "wasipe"');
  });
});

describe("Wasipe identity passes, and refuses a simulated Atheos", () => {
  it("verifies a Wasipe fixture", () => {
    // Proves the guard is genuinely reusable rather than Atheos-shaped. The
    // real Wasipe repository is not touched by this task.
    const dir = fixture({
      pkg: { name: "wasipe", projectIdentity: WASIPE },
      origin: "https://github.com/MoTerry1990/Wasipe.git",
    });
    const result = guard(dir, ["--port", "3001"]);
    expect(result.code).toBe(0);
    expect(result.output).toContain("wasipe");
  });

  it("fails on Atheos's remote under a Wasipe identity", () => {
    const dir = fixture({
      pkg: { name: "wasipe", projectIdentity: WASIPE },
      origin: "https://github.com/MoTerry1990/Atheos.io.git",
    });
    expect(guard(dir).code).toBe(1);
  });

  it("fails when the path runs through an atheos directory", () => {
    const dir = fixture({
      dirName: "atheos",
      pkg: { name: "wasipe", projectIdentity: WASIPE },
      origin: "https://github.com/MoTerry1990/Wasipe.git",
    });
    const result = guard(dir);
    expect(result.code).toBe(1);
    expect(result.output).toContain('path segment named "atheos"');
  });

  it("refuses Atheos's port under a Wasipe identity", () => {
    const dir = fixture({
      pkg: { name: "wasipe", projectIdentity: WASIPE },
      origin: "https://github.com/MoTerry1990/Wasipe.git",
    });
    expect(guard(dir, ["--port", "3000"]).code).toBe(1);
  });
});

describe("uncertainty is an error", () => {
  it("fails closed with no projectIdentity block", () => {
    // The state the real Wasipe repository is in today: it has no identity
    // block, so the Atheos guard run from there refuses rather than guessing.
    const dir = fixture({ pkg: { name: "something" } });
    const result = guard(dir);
    expect(result.code).toBe(1);
    expect(result.output).toContain("no `projectIdentity` block");
  });

  it("fails closed with no package.json at all", () => {
    const base = mkdtempSync(path.join(tmpdir(), "identity-empty-"));
    made.push(base);
    expect(guard(base).code).toBe(1);
  });

  it("fails closed when a repository exists with no origin", () => {
    const dir = fixture({ pkg: { name: "atheos", projectIdentity: ATHEOS } });
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
    const result = guard(dir);
    expect(result.code).toBe(1);
    expect(result.output).toContain("no `origin` remote");
  });
});

describe("CI and production builds stay supported", () => {
  it("passes with no git repository, on package identity alone", () => {
    /**
     * The one deliberate exception. A source tarball and some CI artifacts have
     * no `.git`, so the remote cannot be read; refusing there would break
     * legitimate builds. A repository that *does* exist and points somewhere
     * unexpected is still always an error — that is the dangerous case.
     */
    const dir = fixture({ pkg: { name: "atheos", projectIdentity: ATHEOS } });
    const result = guard(dir);
    expect(result.code).toBe(0);
    expect(result.output).toContain("no git repository");
  });

  it("accepts an SSH remote for the same repository", () => {
    // A colleague's clone, or a CI runner using a deploy key.
    const dir = fixture({
      pkg: { name: "atheos", projectIdentity: ATHEOS },
      origin: "git@github.com:MoTerry1990/Atheos.io.git",
    });
    expect(guard(dir).code).toBe(0);
  });

  it("accepts an HTTPS remote carrying a username", () => {
    // The form this machine actually uses.
    const dir = fixture({
      pkg: { name: "atheos", projectIdentity: ATHEOS },
      origin: "https://MoTerry1990@github.com/MoTerry1990/Atheos.io.git",
    });
    expect(guard(dir).code).toBe(0);
  });

  it("accepts a remote with no .git suffix", () => {
    const dir = fixture({
      pkg: { name: "atheos", projectIdentity: ATHEOS },
      origin: "https://github.com/MoTerry1990/Atheos.io",
    });
    expect(guard(dir).code).toBe(0);
  });
});
