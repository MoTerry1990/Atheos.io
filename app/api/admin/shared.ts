import "server-only";

import { errorResponse } from "@/lib/api-response";

/**
 * Kept as a named re-export rather than deleted.
 *
 * The disclosure rule now lives once, in `lib/api-response.ts` — this file was
 * three near-identical copies of it by Sprint 12. The wrapper survives so the
 * route handlers keep reading in their own vocabulary and so the log line names
 * the area without every call site repeating it.
 */
export function adminResponse(error: unknown, fallback: string) {
  return errorResponse(error, fallback, "admin");
}
