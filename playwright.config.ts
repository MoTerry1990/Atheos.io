import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests.
 *
 * ## What these can and cannot cover
 *
 * There is no database, no Clerk instance and no Stripe account in this
 * environment. So the journeys that matter most — sign up, generate, pay —
 * cannot be driven end to end, and pretending otherwise with mocks would make
 * these integration tests wearing an E2E costume.
 *
 * What they do cover is everything reachable without a backend: the public
 * marketing and community surfaces, the security posture of every route as
 * observed over real HTTP, and the fixture-backed preview routes that render
 * the actual product components. That last group is the same surface every
 * sprint has verified by hand since Sprint 4 — this makes it repeatable.
 *
 * `webServer` builds and starts the production server, so these run against
 * the same output that would deploy, headers included.
 *
 * The build is part of the command, and RC1 is why. It used to run bare
 * `next start`, so the suite tested whatever was last left in `.next`. That is
 * a silent failure in the worst direction: a fix is made, the suite is run, it
 * goes green against the *old* bundle, and the fix is reported as verified.
 * It cost real time here — a WCAG fix appeared not to work, and the reason was
 * that the browser had never been served it.
 *
 * `reuseExistingServer` still short-circuits this locally when a server is
 * already up, so the rebuild is not paid on every iteration. It is never
 * skipped in CI.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : [["list"]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3210",
    trace: "on-first-retry",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The responsive sweep every sprint has done by hand at 375px.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx next build && npx next start -p 3210",
        url: "http://localhost:3210/api/marketplace",
        // The `(dev)` preview routes 404 in a production build unless this is
        // set — see `app/(dev)/layout.tsx`. Sprint 25 turned them off for
        // production, and this suite asserts against all eight of them, so the
        // harness opts in explicitly. It applies to the build as well as the
        // server, which matters: the guard runs at prerender time.
        env: { ENABLE_DEV_PREVIEWS: "1" },
        reuseExistingServer: !process.env.CI,
        // Raised from 120s: the timeout now has to cover the build as well as
        // the server coming up.
        timeout: 300_000,
      },
});
