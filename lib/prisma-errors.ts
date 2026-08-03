import "server-only";

/**
 * Prisma error codes, named.
 *
 * Four copies of `isUniqueViolation` existed by Sprint 12 — projects, billing,
 * community and admin — each checking `error.code === "P2002"` behind its own
 * type guard. Not a bug in any of them, but four places that have to agree
 * about what a constraint violation looks like, and the codes are not obvious
 * enough to guess.
 *
 * `P2002` in particular is load-bearing across this codebase: it is what makes
 * webhook grants exactly-once, what stops a duplicate handle, and what turns a
 * double-submitted credit adjustment into a no-op. Naming it once means the
 * check reads as intent rather than as a magic string.
 */

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * A unique constraint was violated.
 *
 * Very often **not** an error: it is how idempotency is enforced. Callers
 * usually treat it as "already done" rather than as a failure.
 */
export function isUniqueViolation(error: unknown): boolean {
  return codeOf(error) === "P2002";
}

/** A record required by the operation was not found. */
export function isNotFound(error: unknown): boolean {
  return codeOf(error) === "P2025";
}

/**
 * The database could not be reached.
 *
 * Distinct from a query error: the advice is "check the connection string and
 * the pooler", not "check the query". Used by the admin status page.
 */
export function isConnectionError(error: unknown): boolean {
  const code = codeOf(error);
  return code === "P1001" || code === "P1002" || code === "ECONNREFUSED";
}
