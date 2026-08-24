/**
 * The API key prefix, alone in its own module.
 *
 * `lib/request-identity.ts` needs it to recognise a bearer token *before* any
 * I/O happens — that is what lets `guard()` decide about CSRF and rate-limit
 * bucketing without a database read. Importing it from
 * `services/api-keys/index.ts` would drag Prisma into that path, which is
 * exactly the cost the ordering in `guard()` exists to avoid.
 *
 * No `server-only` here: it is a three-character string with no secret in it,
 * and marking it server-only would stop the studio ever labelling a key by its
 * prefix in the UI.
 */
export const API_KEY_PREFIX = "atk";
