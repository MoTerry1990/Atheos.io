import "server-only";

import { NextResponse } from "next/server";

/**
 * One error shape for every route handler.
 *
 * ## Why this exists
 *
 * Projects, community and admin each grew a `shared.ts` with the same twelve
 * lines, and the marketplace put its copy inside a route file and imported it
 * from a sibling — which made a page route depend on another route's module
 * graph for an error helper. Three near-identical implementations plus one
 * awkward import is four places to get the disclosure rule wrong.
 *
 * ## The rule it enforces
 *
 * A **domain error** — a taken handle, an unaffordable generation, a project
 * that is not yours — carries a message written for a user and a status the
 * caller can act on. It passes through.
 *
 * **Anything else is ours.** A Prisma exception can carry query text and a
 * connection string; a Stripe exception can carry a request id and a customer
 * id. It is logged with the exception and returned as one sentence.
 *
 * Getting that backwards is how an internal identifier ends up in a browser,
 * and it is exactly the kind of thing that is written correctly once and
 * copied incorrectly five times.
 */

/**
 * The shape every domain error in `services/` implements.
 *
 * Structural rather than a base class: `GenerationError`, `ProjectError`,
 * `BillingError`, `MarketplaceError`, `CommunityError` and `AdminError` were
 * each written independently with these three fields, and a shared superclass
 * would mean editing six files to gain nothing they do not already have.
 */
export interface DomainError {
  message: string;
  status: number;
  code: string;
}

function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}

/**
 * Turn a thrown value into a response.
 *
 * `context` is for the server log only and never reaches the client — it names
 * which route failed, so a 500 in production is greppable.
 */
export function errorResponse(
  error: unknown,
  fallback: string,
  context = "request",
): NextResponse {
  if (isDomainError(error)) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error(`${context} failed`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** A 400 for a body that is not JSON. Repeated in every mutating route. */
export function malformedBody(): NextResponse {
  return NextResponse.json(
    { error: "Malformed request body." },
    { status: 400 },
  );
}

/**
 * A 400 with field-level detail from Zod.
 *
 * The paths matter: they let a form point at the offending control instead of
 * showing a generic banner above a page of inputs.
 */
export function invalidInput(
  message: string,
  // `PropertyKey[]`, not `(string | number)[]`, because that is what Zod 4
  // actually produces — a path segment can be a symbol for a symbol-keyed
  // property. Narrowing here would push a cast to every call site.
  issues?: readonly { path: readonly PropertyKey[]; message: string }[],
): NextResponse {
  return NextResponse.json(
    {
      error: message,
      ...(issues
        ? {
            issues: issues.map((issue) => ({
              path: issue.path.map(String).join("."),
              message: issue.message,
            })),
          }
        : {}),
    },
    { status: 400 },
  );
}
