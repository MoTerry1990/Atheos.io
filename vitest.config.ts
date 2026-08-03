import { defineConfig } from "vitest/config";

/**
 * Two projects, because the tests have genuinely different needs.
 *
 * `node` — pure logic, service code and the Postgres-backed suites. No DOM, no
 * jsdom overhead, and `server-only` has to be stubbed because Vitest is not
 * Next's server runtime.
 *
 * `dom` — React components under Testing Library. jsdom, and a setup file that
 * installs the matchers and the browser APIs Radix expects.
 */
export default defineConfig({
  /**
   * `tsconfig.json` sets `jsx: "preserve"` because Next does its own JSX
   * transform. Vite/esbuild cannot parse preserved JSX, so it is told to use
   * the automatic runtime here. This changes nothing about how Next builds the
   * app — it applies only to files Vitest transforms.
   */
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/{unit,integration,api,db}/**/*.test.ts"],
          setupFiles: ["tests/setup/node.ts"],
        },
      },
      {
        extends: true,
        /**
         * `tsconfig.json` sets `jsx: "preserve"` because Next does its own JSX
         * transform, and Vite cannot parse preserved JSX. This applies only to
         * files Vitest transforms — it changes nothing about how Next builds.
         *
         * Set per-project rather than at the top level: with `projects`, a
         * root-level `esbuild` block is not inherited.
         */
        oxc: { jsx: { runtime: "automatic" } },
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["tests/components/**/*.test.tsx"],
          setupFiles: ["tests/setup/dom.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      // Only what the tests actually target. Including the whole tree would
      // report a coverage number dominated by UI nobody claims is tested,
      // which is worse than no number.
      include: [
        "lib/**/*.ts",
        "services/**/*.ts",
        "utils/**/*.ts",
        "features/studio/lib/**/*.ts",
      ],
      exclude: ["lib/generated/**", "**/*.d.ts"],
    },
  },
  resolve: {
    // Native `@/*` resolution from tsconfig.json. Vite supports this directly
    // now, so `vite-tsconfig-paths` was removed rather than kept as a
    // dependency that only exists to duplicate a built-in.
    tsconfigPaths: true,
    alias: {
      // `server-only` throws when imported outside a React Server Component.
      // Vitest is not one, and every service module imports it. Aliasing to an
      // empty module is the standard workaround and removes nothing under test:
      // the guard exists to fail a *build*, and the build still enforces it.
      "server-only": new URL("./tests/setup/server-only.ts", import.meta.url)
        .pathname,
    },
  },
});
