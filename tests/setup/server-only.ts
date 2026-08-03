/**
 * Stub for the `server-only` package.
 *
 * That package's whole job is to throw at build time if a module reaches a
 * client bundle. Vitest is neither a server nor a client bundle, so importing
 * the real thing fails every service test for a reason that has nothing to do
 * with the code under test. Aliased in vitest.config.ts.
 *
 * This removes no safety: the guarantee is enforced by `next build`, which
 * still runs in CI and still fails on a violation.
 */
export {};
