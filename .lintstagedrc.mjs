/**
 * Pre-commit tasks.
 *
 * ## Why this is a file rather than a `lint-staged` key in package.json
 *
 * lint-staged appends every matching staged path to the command. On Windows the
 * whole command line is capped at roughly 32,000 characters, and a large commit
 * blows straight through it:
 *
 *   ✖ eslint --fix --max-warnings=0:
 *     The command line is too long.
 *
 * That is exactly what happened committing Sprints 7–24 in one go — 256 staged
 * files — and it forced a `--no-verify` commit, which is the outcome a
 * pre-commit hook exists to prevent. It fails on the *largest* commits, which
 * are the ones most worth checking.
 *
 * ## The fix
 *
 * Above a threshold, stop passing filenames and check the whole project
 * instead. Slower, but it is a rare path and it terminates: `eslint .` and
 * `prettier --write .` take a fixed argument list no matter how many files are
 * staged. Below the threshold nothing changes — the usual small commit still
 * gets the fast, file-scoped run.
 *
 * 60 is well under the limit for realistic path lengths in this repo (~60 chars
 * average, so ~4 KB) while being far more files than a normal commit touches.
 */
const BULK_THRESHOLD = 60;

/** Quote each path so spaces in a filename cannot split an argument. */
const quote = (files) => files.map((f) => JSON.stringify(f)).join(" ");

const config = {
  "*.{ts,tsx}": (files) =>
    files.length > BULK_THRESHOLD
      ? ["eslint . --fix --max-warnings=0", "prettier --write ."]
      : [
          `eslint --fix --max-warnings=0 ${quote(files)}`,
          `prettier --write ${quote(files)}`,
        ],

  "*.{js,jsx,mjs,cjs}": (files) =>
    files.length > BULK_THRESHOLD
      ? ["eslint . --fix", "prettier --write ."]
      : [`eslint --fix ${quote(files)}`, `prettier --write ${quote(files)}`],

  "*.{json,md,css,yml,yaml}": (files) =>
    files.length > BULK_THRESHOLD
      ? ["prettier --write ."]
      : [`prettier --write ${quote(files)}`],

  // Always project-wide: `prisma format` takes a schema, not a file list.
  "*.prisma": () => ["prisma format"],
};

export default config;
