import "server-only";

import { isAdmin } from "@/services/admin/auth";

/**
 * Who sees Studio V2.
 *
 * ## Two conditions, and both are load-bearing
 *
 * The flag alone would expose an unfinished interface to every signed-in user
 * the moment it is set in an environment. The admin check alone would ship V2
 * the instant the code merged. Requiring both means neither a deploy nor a
 * config change can release it by accident, and turning it on for real is a
 * deliberate act in two places.
 *
 * ## Decided on the server, every time
 *
 * The route resolves this before rendering and hands the client a finished
 * decision. There is no flag in a public DTO, no `?v2=1` escape hatch, and
 * nothing a browser can set — a client-readable toggle would be an
 * announcement that the interface exists and an invitation to try to reach it.
 *
 * ## Why the flag is read at call time
 *
 * `createEnv` snapshots `process.env` at module load, which is right for a
 * connection string and wrong for a feature flag: a flag is runtime state that
 * a deploy flips, and a cached copy keeps serving the old answer for the life
 * of the process.
 */
export async function canUseStudioV2(): Promise<boolean> {
  if (process.env.ENABLE_STUDIO_V2_OWNER_BETA !== "1") return false;
  return isAdmin();
}

/**
 * Whether the beta is switched on at all, regardless of who is asking.
 *
 * Used only to explain the two conditions in admin diagnostics. It must never
 * decide what a customer sees — that is `canUseStudioV2`, which also asks who
 * the caller is.
 */
export function studioV2FlagEnabled(): boolean {
  return process.env.ENABLE_STUDIO_V2_OWNER_BETA === "1";
}
