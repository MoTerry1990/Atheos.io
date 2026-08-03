/**
 * The browser-side HTTP client.
 *
 * ## Why this exists
 *
 * By Sprint 12 there were **six** copies of the same `request<T>()` — studio,
 * projects, billing, marketplace, community, admin — each with its own
 * `ApiError` re-export and its own subtly different comment about network
 * failures. They were copied because the first one was not exported, and every
 * feature after it needed the same nine lines.
 *
 * Six copies is six places to fix a bug in error parsing, and five of them
 * would be missed. This is that code, once.
 *
 * ## Deliberately not `server-only`, and deliberately not a hook
 *
 * Client components import it directly. It holds no state, so wrapping it in a
 * hook would add a render dependency to something that is a function call.
 *
 * ## What it guarantees
 *
 * Every failure is an `ApiError` with a message safe to show a user. Callers
 * never touch `response.ok`, never parse a body twice, and never leak a raw
 * exception into an interface.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * A JSON request that either returns `T` or throws `ApiError`.
 *
 * `cache: "no-store"` on everything. These are all per-user reads behind
 * authentication; a cached response served to the wrong person is the one
 * failure mode worth defending against unconditionally, and no call site here
 * benefits from caching a response the server marks private anyway.
 */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
  } catch (cause) {
    // An abort is the caller superseding its own request, not a failure. It is
    // re-thrown unchanged so `cause.name === "AbortError"` still works at the
    // call site, which several of them check for.
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw cause;
    }

    // Network-level failure. Distinguished from an API error because the advice
    // differs: check your connection, not your settings.
    throw new ApiError(
      "Could not reach the server. Check your connection and try again.",
      0,
      "network",
    );
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      body?.error ?? "Something went wrong.",
      response.status,
      body?.code,
    );
  }

  return body as T;
}

/**
 * A multipart upload.
 *
 * Separate because `FormData` must be allowed to set its own `Content-Type`
 * with its boundary — passing an explicit JSON content type is the classic way
 * to make an upload fail with a parse error on the server.
 */
export async function upload<T>(
  url: string,
  body: FormData,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, { method: "POST", body, signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw cause;
    }
    throw new ApiError("Could not reach the server.", 0, "network");
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      payload?.error ?? "The upload failed.",
      response.status,
      payload?.code,
    );
  }

  return payload as T;
}
