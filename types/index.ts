/**
 * Shared types used across more than one feature.
 *
 * Types belonging to a single feature live with that feature. This file is for
 * the vocabulary the whole application shares — the moment it becomes a dumping
 * ground it stops being useful.
 */

/** A discriminated result, for operations whose failure is expected rather than
 *  exceptional — a provider refusing a prompt, a card being declined. Throwing
 *  for those makes the happy path unreadable and the failure path easy to
 *  forget. */
export type Result<T, E = Error> =
  { ok: true; data: T } | { ok: false; error: E };

/** Cursor pagination. Offsets drift when rows are inserted while a user is
 *  paging, which for an asset library that grows as you browse is the common
 *  case, not the edge case. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PageParams {
  cursor?: string;
  limit?: number;
}

/** Every async surface renders one of these. Enumerated as a type so that a
 *  component physically cannot forget the empty or error case. */
export type AsyncState = "idle" | "loading" | "empty" | "error" | "ready";

export type Nullable<T> = T | null;

/** Makes chosen keys required on a type where they are optional. */
export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

// Domain enums are generated from the Prisma schema — re-exported here so
// application code imports its vocabulary from one place and never reaches into
// the generated directory directly.
export type {
  Modality,
  GenerationStatus,
  AssetKind,
  AssetSource,
  CreditReason,
  SubscriptionStatus,
} from "@/lib/generated/prisma/enums";
