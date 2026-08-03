import "server-only";

import { NextResponse } from "next/server";
import type { ZodType } from "zod";

/**
 * Response validation.
 *
 * ## The failure this prevents
 *
 * Over-disclosure by accident. Every route in this codebase builds its response
 * from Prisma rows, and a Prisma row carries more than the caller should see —
 * `users` alone holds `email`, `clerkId` and `stripeCustomerId`. Nothing about
 * `NextResponse.json(user)` looks wrong in review, and nothing in the type
 * system objects: `UserModel` is assignable to `unknown`.
 *
 * The realistic path to it is not carelessness but change. A `select` gains a
 * field for one screen, a service starts returning the whole row instead of a
 * projection, a relation is included for a count and brings its parent with it.
 * The route that serialises the result never changes, so nobody re-reads it.
 *
 * ## A schema, applied on the way out
 *
 * `jsonOut` parses the payload before sending it. Zod object schemas strip
 * unknown keys by default, so the schema is an **allowlist**: a field that is
 * not named cannot be transmitted, however it got into the object.
 *
 * That is the whole idea. It is not validating that our own code is correct —
 * it is making the set of fields a route may emit an explicit, reviewable
 * declaration instead of an emergent property of six layers of `select`.
 *
 * ## What happens when it does not match
 *
 * Extra fields are dropped silently, because that is the safe outcome and the
 * one we want in production. A *missing* required field is a real bug in our
 * own code, and it fails: a 500 rather than a response the client cannot use.
 * Both are logged with the route name.
 *
 * ## Where it is applied
 *
 * The routes that return user-shaped or account-shaped data, where the cost of
 * a leak is highest — community profiles and posts (public, unauthenticated,
 * indexable) and the admin surface (every field is a disclosure). Routes that
 * return only the caller's own rows are lower value and are not wrapped, which
 * is a deliberate scope choice rather than an oversight.
 */
export function jsonOut<T>(
  schema: ZodType<T>,
  data: unknown,
  options?: { status?: number; headers?: HeadersInit; context?: string },
): NextResponse {
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    console.error(
      `response validation failed for ${options?.context ?? "a route"}`,
      parsed.error.issues,
    );
    // Our bug, not the caller's. Say nothing about the shape — the mismatch
    // itself describes internal structure.
    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 },
    );
  }

  return NextResponse.json(parsed.data, {
    status: options?.status ?? 200,
    headers: options?.headers,
  });
}
