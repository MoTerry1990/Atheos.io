#!/usr/bin/env node
/**
 * Refuse to run if this is not the project we think it is.
 *
 * ## What happened
 *
 * A preview command was issued for Atheos and started **Wasipe** instead. The
 * mechanism was mundane: the tool resolved `.claude/launch.json` relative to a
 * third directory entirely, found no configuration matching the name it was
 * given, and fell back to the only entry present — which was Wasipe's, on port
 * 3001. Nothing was written to the wrong repository, but for several minutes
 * the thing being looked at was not the thing being worked on.
 *
 * That failure is not specific to one tool. Any command run from an unexpected
 * working directory has the same shape, and the ones that write — `dev`,
 * `build`, `test`, a deploy — are worse than the one that only rendered a page.
 *
 * ## Identity, not location
 *
 * Deliberately not a path check against a home directory. Paths differ between
 * this machine, a CI runner and a colleague's laptop, and a guard that only
 * passes on one of them is a guard that gets deleted. What is stable is who the
 * repository *is*: the name in its own `package.json` and the remote it pushes
 * to.
 *
 * ## Fail closed
 *
 * Every uncertainty is an error, with one deliberate exception. A missing
 * `projectIdentity` block, a name mismatch, a wrong remote, a conflicting
 * project name in the path — all stop the command. The exception is a working
 * tree with no git repository at all, which is what a source tarball or some
 * CI artifacts look like; there the remote cannot be read and refusing would
 * break legitimate builds. A repository that *does* exist and points somewhere
 * unexpected is always an error, because that is the dangerous case.
 *
 * Usage:
 *   node scripts/verify-project.mjs
 *   node scripts/verify-project.mjs --port 3000
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** Read a package.json field without importing the package. */
function readPackage(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

/** `git` output, or null when there is no repository to ask. */
function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * `https://user@github.com/Owner/Repo.git` → `owner/repo`.
 *
 * Normalised because the same repository is written several ways — SSH, HTTPS,
 * with and without a username, with and without `.git` — and a guard that only
 * recognises one of them fails on a colleague's clone.
 */
function normaliseRemote(url) {
  if (!url) return null;
  const match = url.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

const problems = [];
const cwd = process.cwd();

const pkg = readPackage(cwd);
if (!pkg) {
  problems.push(`no package.json in ${cwd}`);
}

/**
 * The expectations live in package.json, so this file is identical in every
 * repository that uses it. Copying a script is cheap; copying a script and then
 * editing its hardcoded constants is how the two copies drift.
 */
const identity = pkg?.projectIdentity;
if (!identity) {
  problems.push(
    "package.json has no `projectIdentity` block — cannot verify which project this is",
  );
}

if (pkg && identity) {
  if (pkg.name !== identity.name) {
    problems.push(
      `package.json name is "${pkg.name}", expected "${identity.name}"`,
    );
  }

  const root = git(["rev-parse", "--show-toplevel"]);
  const remote = normaliseRemote(git(["remote", "get-url", "origin"]));

  if (root === null) {
    // No repository. A tarball or a bare CI artifact — see "Fail closed".
    console.warn(
      "verify-project: no git repository here, checking package identity only",
    );
  } else if (remote === null) {
    problems.push("a git repository exists but has no `origin` remote");
  } else if (remote !== identity.remote.toLowerCase()) {
    problems.push(
      `origin is "${remote}", expected "${identity.remote.toLowerCase()}"`,
    );
  }

  /**
   * The other project must not appear anywhere in this path.
   *
   * Catches the case identity alone would miss: a nested checkout, or a command
   * run from inside one repository against another's manifest.
   */
  const segments = cwd.toLowerCase().split(/[\\/]+/);
  for (const other of identity.conflictsWith ?? []) {
    if (segments.includes(other.toLowerCase())) {
      problems.push(
        `working directory is inside a path segment named "${other}" — this is ${identity.name}`,
      );
    }
  }

  const portIndex = process.argv.indexOf("--port");
  if (portIndex !== -1) {
    const requested = Number(process.argv[portIndex + 1]);
    if (requested !== identity.port) {
      problems.push(
        `port ${requested} was requested, but ${identity.name} runs on ${identity.port}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`\nWrong project. Refusing to run.\n`);
  console.error(`  cwd: ${cwd}`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  process.exit(1);
}

// Sanitised on purpose: a name, a remote and a port. No paths beyond the root,
// no environment, no secrets.
//
// `console.warn` rather than `console.log`: this is a guard, its one line of
// output belongs on the same stream as its refusals, and the repository lints
// `console.log` out of source for exactly the reason it should not be here.
console.warn(
  `${identity.name} @ ${identity.remote} (port ${identity.port}) — verified`,
);
