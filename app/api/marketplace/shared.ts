import "server-only";

import { errorResponse } from "@/lib/api-response";

/**
 * Moved out of `route.ts`.
 *
 * It lived there and was imported by the sibling `[slug]` route, which made one
 * route handler depend on another's module graph for an error helper. Harmless
 * until somebody adds a side effect to the file that exports it.
 */
export function marketplaceResponse(error: unknown, fallback: string) {
  return errorResponse(error, fallback, "marketplace");
}
