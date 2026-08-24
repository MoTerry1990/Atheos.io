import { vi } from "vitest";

/**
 * Environment for the node suites.
 *
 * `lib/env.ts` validates at import time and fails hard on a missing required
 * variable — which is exactly what it is for, and exactly what would stop any
 * test that transitively imports it. These are structurally valid placeholders,
 * never real credentials.
 */
// NODE_ENV is set to "test" by Vitest itself and is read-only in Next's
// ambient types, so it is deliberately not assigned here.
process.env.DATABASE_URL ??= "postgresql://u:p@localhost:6543/test";
process.env.DIRECT_URL ??= "postgresql://u:p@localhost:5432/test";
process.env.CLERK_SECRET_KEY ??= "sk_test_placeholder";
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= "pk_test_placeholder";
process.env.STRIPE_SECRET_KEY ??= "sk_test_placeholder";
/**
 * A test-only plan signing secret.
 *
 * 64 characters of fixed hex so `creativePlanConfigProblems` is satisfied and
 * tokens verify deterministically. It is not a secret and is not used anywhere
 * a real one would be — but it must not read like a placeholder, because the
 * validator rejects those on purpose.
 */
process.env.CREATIVE_PLAN_SIGNING_SECRET ??=
  "9f2c1a7d4b6e8035c19d7f4a2b8e6c035a1d9f7b3e5c8027a4f6d1b9e3c7502a";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

// Deterministic time for anything that buckets by day or computes a window.
vi.stubGlobal("__TEST__", true);
