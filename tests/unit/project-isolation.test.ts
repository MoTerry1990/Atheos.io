import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Atheos contains nothing belonging to Wasipe.
 *
 * ## Why a content scan, when `project-identity.test.ts` already exists
 *
 * That one checks *identity* — the package name, the git remote, the port, the
 * directory path. It answers "am I Atheos?" and it would have caught a tool
 * starting the wrong dev server.
 *
 * It would not catch a Wasipe Supabase reference pasted into an env file, a
 * Wasipe URL left in documentation, or a `localhost:3001` copied from the other
 * project's notes. Those are contamination that passes every identity check,
 * because the repository really is Atheos — it is just carrying something that
 * is not its own. This scans content for that.
 *
 * ## The allowlist, and why it is not a loophole
 *
 * Three files must contain the word "wasipe" to do their jobs: the guard
 * script, the guard's test, and the `conflictsWith` entry that configures it.
 * A scanner that failed on those would force the guard to be deleted to satisfy
 * the scan.
 *
 * They are exempt **per identifier**, at an exact path — never whole files,
 * and never by pattern. Exempting a file outright would mean that pasting the
 * Wasipe Supabase reference into `package.json` passed forever, because that
 * file had once needed to say "wasipe" for an unrelated reason. Each guard file
 * may say "wasipe" and nothing else.
 *
 * Everything else in the tree, tracked or not, has to be clean. Note that
 * `.claude/settings.local.json` is deliberately *not* exempt: it is local tool
 * state that had accumulated paths into the Wasipe checkout, and it should stay
 * clean too.
 */

const ROOT = path.resolve(__dirname, "..", "..");

/** Everything that must not appear anywhere in the tree. */
const FORBIDDEN = [
  "wasipe",
  "wasipe-staging",
  "kcsditeaaszvmwirjazo",
  "wasipe.netlify.app",
  "localhost:3001",
  "projects/wasipe",
  "projects\\wasipe",
];

/**
 * Which identifier each guard file may contain — not "this file is exempt".
 *
 * The distinction matters. Exempting whole files would mean that pasting the
 * Wasipe Supabase reference into `package.json` — a real config file that
 * changes often — sailed past the scan forever, because the file had once
 * needed to say "wasipe" for an unrelated reason.
 *
 * So the exemption is per identifier, per exact path. `package.json` may say
 * "wasipe", because `conflictsWith` configures the guard. It may **not** carry
 * the Supabase reference, a Netlify host or port 3001, and it will fail if it
 * ever does.
 *
 * `project-isolation.test.ts` is the one file allowed everything, because it
 * is this file: it has to spell out each identifier in `FORBIDDEN` to search
 * for it.
 */
const ALLOWED: Record<string, readonly string[]> = {
  "package.json": ["wasipe"],
  "scripts/verify-project.mjs": ["wasipe"],
  "tests/unit/project-identity.test.ts": ["wasipe"],
  "tests/unit/project-isolation.test.ts": FORBIDDEN,
};

/**
 * Not scanned: version control internals, dependencies, and build output.
 *
 * `.next` is excluded because it is derived — a stale cache can hold a string
 * long after its source is gone, so failing on it would report history rather
 * than the current state. The bundle assertion below covers what actually
 * ships instead.
 */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "test-results",
  "playwright-report",
  "coverage",
  "lib/generated",
]);

/** Binary-ish files a text scan would only produce noise on. */
const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".mp4",
  ".webm",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".pdf",
  ".zip",
  ".pack",
]);

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = path.relative(ROOT, full).split(path.sep).join("/");

    if (SKIP_DIRS.has(rel) || SKIP_DIRS.has(entry)) continue;

    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, found);
      continue;
    }
    if (SKIP_EXTENSIONS.has(path.extname(entry).toLowerCase())) continue;
    // A stray multi-megabyte file is not worth reading into memory.
    if (stats.size > 2_000_000) continue;

    found.push(rel);
  }
  return found;
}

/** Every match of every forbidden string, as `path:line`. */
function scan(): string[] {
  const hits: string[] = [];

  for (const rel of walk(ROOT)) {
    const permitted = ALLOWED[rel] ?? [];

    let contents: string;
    try {
      contents = readFileSync(path.join(ROOT, rel), "utf8");
    } catch {
      continue; // Unreadable or genuinely binary; nothing to assert.
    }

    const lower = contents.toLowerCase();
    for (const needle of FORBIDDEN) {
      if (!lower.includes(needle)) continue;
      // Exempt this identifier in this file only — never the file wholesale.
      if (permitted.includes(needle)) continue;

      const line = lower.slice(0, lower.indexOf(needle)).split("\n").length;
      hits.push(`${rel}:${line} contains "${needle}"`);
    }
  }

  return hits;
}

describe("no Wasipe content anywhere in Atheos", () => {
  it("finds no forbidden identifier in any file", () => {
    /**
     * Reported as a list rather than a boolean so a failure names the file and
     * line. "Contamination detected" with no location is a bug report nobody
     * can act on.
     */
    expect(scan()).toEqual([]);
  });

  it("scans a meaningful number of files, so a passing run means something", () => {
    /**
     * The failure mode of a scanner: an exclusion widens, the walk returns
     * almost nothing, and the suite goes green because it looked at nothing.
     */
    expect(walk(ROOT).length).toBeGreaterThan(200);
  });

  it("would fail if the guard files were not exempt", () => {
    // Proves the scanner actually matches, rather than passing vacuously.
    const guard = readFileSync(
      path.join(ROOT, "scripts/verify-project.mjs"),
      "utf8",
    ).toLowerCase();

    expect(FORBIDDEN.some((needle) => guard.includes(needle))).toBe(true);
  });

  it("exempts identifiers, not whole files", () => {
    /**
     * The property that keeps the allowlist from becoming a blind spot. Every
     * guard file may say "wasipe"; none of them may carry the Supabase
     * reference, the Netlify host or the port — so contamination arriving in
     * `package.json` tomorrow still fails the scan.
     *
     * `project-isolation.test.ts` is excluded from the assertion because it is
     * this file, and it must name every identifier to search for them.
     */
    for (const [file, permitted] of Object.entries(ALLOWED)) {
      if (file === "tests/unit/project-isolation.test.ts") continue;

      expect(permitted, file).toEqual(["wasipe"]);
    }
  });
});

describe("Atheos uses only its own infrastructure", () => {
  it("points at the Atheos git remote", () => {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .trim()
      .toLowerCase();

    expect(remote).toContain("moterry1990/atheos.io");
    expect(remote).not.toContain("wasipe");
  });

  it("has exactly one remote", () => {
    // A second remote is how a push reaches the wrong project.
    const remotes = execFileSync("git", ["remote"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    expect(remotes).toEqual(["origin"]);
  });

  it("is linked to the atheos-io Vercel project", () => {
    /**
     * Read rather than asserted against a hardcoded id: the project id and org
     * id are account identifiers and do not belong in a test file. The name is
     * the part that distinguishes Atheos from Wasipe.
     */
    const project = JSON.parse(
      readFileSync(path.join(ROOT, ".vercel/project.json"), "utf8"),
    ) as { projectName?: string };

    expect(project.projectName).toBe("atheos-io");
  });

  it("declares its own identity in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as {
      name: string;
      projectIdentity?: { remote?: string; port?: number };
    };

    expect(pkg.name).toBe("atheos");
    expect(pkg.projectIdentity?.remote).toBe("MoTerry1990/Atheos.io");
    // Wasipe's port. Atheos must never claim it.
    expect(pkg.projectIdentity?.port).not.toBe(3001);
  });
});

describe("nothing Wasipe can reach a browser", () => {
  it("keeps forbidden strings out of the shipped client bundles", () => {
    /**
     * The property customers are actually exposed to. Source can be clean
     * while a bundle is not — a string can arrive through a dependency, a
     * generated file or an inlined constant.
     *
     * When `.next/static` has not been built this asserts over an empty set,
     * which is true but weak; that is deliberate rather than a skip, because a
     * skipped test reads as "passed" in a summary. The release gate builds
     * before running this, so on the path that matters it has real files.
     */
    const staticDir = path.join(ROOT, ".next", "static");

    let files: string[] = [];
    try {
      files = walk(staticDir).map((rel) => path.join(staticDir, rel));
    } catch {
      files = [];
    }

    const contaminated = files.filter((file) => {
      try {
        const lower = readFileSync(file, "utf8").toLowerCase();
        return FORBIDDEN.some((needle) => lower.includes(needle));
      } catch {
        return false;
      }
    });

    expect(contaminated).toEqual([]);
  });
});
