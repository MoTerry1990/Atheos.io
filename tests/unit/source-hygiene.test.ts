import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No stray control characters in source. Written after two got in.
 *
 * ## What happened
 *
 * A regex meant to read `/\b(static shot|…)\b/i` was written through a
 * generation step that interpreted `\b` as an escape, so what reached disk was
 * a literal **backspace character** (code 8) where the word boundary belonged.
 * The file looked right in every editor, TypeScript compiled it, ESLint passed
 * it, Prettier formatted it — and the regex could never match anything.
 *
 * That one was caught by a test asserting behaviour. The second was not: the
 * same corruption sat inside
 * `tests/components/shot-plan.test.tsx`'s "never renders a bare credit total"
 * assertion, so the regex was `(?<!from )<BS>\d+ credits`, which matches
 * nothing. **The test had been passing vacuously** — it was the very
 * safeguard added to stop a bare price being rendered, and it had no teeth.
 *
 * ## Why a whole-tree scan rather than a lint rule
 *
 * The failure is not about any particular character or file. It is that a
 * non-printing byte can sit inside a string or a regex, change its meaning
 * completely, and be invisible to every tool that reads source as text. A scan
 * is the only check that sees bytes rather than tokens.
 *
 * Tabs, newlines and carriage returns are allowed — they are legitimate
 * whitespace. Everything else below 0x20 is not.
 */

const ROOTS = ["app", "features", "lib", "services", "store", "tests", "utils"];
const SKIP = new Set(["node_modules", ".next", "generated", "dist"]);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(path);
  }
  return found;
}

describe("source files contain no invisible control characters", () => {
  const root = resolve(import.meta.dirname, "..", "..");

  const files = ROOTS.flatMap((dir) => {
    try {
      return sourceFiles(join(root, dir));
    } catch {
      // A root that does not exist is not a failure; the list is generous on
      // purpose so a new top-level directory is covered without an edit here.
      return [];
    }
  });

  it("scans a meaningful number of files, so a broken walk is visible", () => {
    // A scan that silently found nothing to scan would pass forever.
    expect(files.length).toBeGreaterThan(100);
  });

  it("finds none", () => {
    const offences: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");

      for (let i = 0; i < source.length; i++) {
        const code = source.charCodeAt(i);
        if (code >= 32) continue;
        if (code === 9 || code === 10 || code === 13) continue;

        const line = source.slice(0, i).split("\n").length;
        offences.push(
          `${file.slice(root.length + 1)}:${line} — control character ${code}`,
        );
      }
    }

    expect(offences).toEqual([]);
  });
});
