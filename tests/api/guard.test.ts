import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * The gate every route handler passes through.
 *
 * Two orderings in it are load-bearing and neither is obvious from reading a
 * call site:
 *
 *   - **rate limit before the user lookup**, so a flood costs no database reads;
 *   - **admin before input parsing**, so a non-admin cannot tell an admin route
 *     apart from a nonexistent one by sending it a malformed body.
 *
 * The second was a real leak found in Sprint 15, and the first version of the
 * fix made it worse. Both are asserted here.
 */

const getUserId = vi.fn();
const getCurrentUser = vi.fn();
const isAdmin = vi.fn();

vi.mock("@/lib/auth", () => ({
  getUserId: (...a: unknown[]) => getUserId(...a),
  getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
}));

vi.mock("@/services/admin/auth", () => ({
  isAdmin: (...a: unknown[]) => isAdmin(...a),
}));

const { guard } = await import("@/lib/api-guard");

const USER = { id: "db_1", clerkId: "clerk_1", email: "a@example.com" };

let seq = 0;
const req = (
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    url?: string;
  } = {},
) =>
  new Request(init.url ?? `http://localhost:3000/api/x?n=${seq++}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

const sameOrigin = { "sec-fetch-site": "same-origin" };

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue("clerk_1");
  getCurrentUser.mockResolvedValue(USER);
  isAdmin.mockResolvedValue(false);
});

describe("cross-origin", () => {
  it("refuses a cross-site mutation with 403", async () => {
    const gate = await guard(
      req({ method: "POST", headers: { "sec-fetch-site": "cross-site" } }),
      { policy: "mutation" },
    );

    expect(gate).toBeInstanceOf(NextResponse);
    expect((gate as NextResponse).status).toBe(403);
  });

  it("does not apply the check to GET", async () => {
    // A read is not a state change; requiring an Origin on GET would break
    // ordinary navigation.
    const gate = await guard(req({ method: "GET" }), { policy: "read" });
    expect(gate).not.toBeInstanceOf(NextResponse);
  });

  it("can be disabled for webhooks, which send no Origin", async () => {
    const gate = await guard(req({ method: "POST" }), {
      policy: "sensitive",
      auth: "none",
      csrf: false,
    });
    expect(gate).not.toBeInstanceOf(NextResponse);
  });

  it("refuses before touching the database", async () => {
    await guard(
      req({ method: "POST", headers: { "sec-fetch-site": "cross-site" } }),
      { policy: "mutation" },
    );
    expect(getCurrentUser).not.toHaveBeenCalled();
  });
});

describe("authentication", () => {
  it("401s when a user row is required and absent", async () => {
    getUserId.mockResolvedValue(null);
    getCurrentUser.mockResolvedValue(null);

    const gate = await guard(req(), { policy: "read" });

    expect(gate).toBeInstanceOf(NextResponse);
    expect((gate as NextResponse).status).toBe(401);
  });

  it("passes an anonymous caller through when auth is optional", async () => {
    getUserId.mockResolvedValue(null);
    getCurrentUser.mockResolvedValue(null);

    const gate = await guard(req(), { policy: "publicRead", auth: "optional" });

    expect(gate).not.toBeInstanceOf(NextResponse);
    expect((gate as { user: unknown }).user).toBeNull();
  });

  it("never looks up a user when auth is none", async () => {
    await guard(req({ method: "POST" }), {
      policy: "sensitive",
      auth: "none",
      csrf: false,
    });
    expect(getUserId).not.toHaveBeenCalled();
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("reads the session before the database, and only once", async () => {
    await guard(req(), { policy: "read" });
    expect(getUserId).toHaveBeenCalledTimes(1);
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });
});

describe("rate limiting runs before the database read", () => {
  it("stops hitting the database once the limit is exhausted", async () => {
    // The design claim: Clerk's session read is local, so the limit can be
    // enforced before anything touches Postgres. If this regressed, a flood
    // would still cost one query per request and the limiter would be
    // protecting the expensive work while being the expensive work.
    const url = `http://localhost:3000/api/x?flood=${Date.now()}`;
    getUserId.mockResolvedValue(`clerk_flood_${Date.now()}`);

    let refused = false;
    for (let i = 0; i < 20; i++) {
      const gate = await guard(req({ url }), { policy: "billing" });
      if (gate instanceof NextResponse && gate.status === 429) {
        refused = true;
        break;
      }
    }

    expect(refused).toBe(true);

    const before = getCurrentUser.mock.calls.length;
    const gate = await guard(req({ url }), { policy: "billing" });
    expect((gate as NextResponse).status).toBe(429);
    expect(getCurrentUser.mock.calls.length).toBe(before);
  });

  it("puts Retry-After on the 429", async () => {
    const url = `http://localhost:3000/api/y?flood=${Date.now()}`;
    getUserId.mockResolvedValue(`clerk_flood2_${Date.now()}`);

    let response: NextResponse | undefined;
    for (let i = 0; i < 20; i++) {
      const gate = await guard(req({ url }), { policy: "billing" });
      if (gate instanceof NextResponse) {
        response = gate;
        break;
      }
    }

    expect(response?.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("admin routes answer 404 to everyone else", () => {
  it("404s a non-admin", async () => {
    const gate = await guard(req(), {
      policy: "admin",
      auth: "optional",
      admin: true,
    });

    expect((gate as NextResponse).status).toBe(404);
  });

  it("404s — not 400 — when a non-admin sends a malformed body", async () => {
    // The leak. Before Sprint 15 the body was parsed first, so a bad body got
    // 400 and a good one got 404. Two different answers is the same disclosure
    // the 404 rule exists to prevent.
    const gate = await guard(
      req({ method: "POST", headers: sameOrigin, body: { garbage: true } }),
      {
        policy: "admin",
        auth: "optional",
        admin: true,
        body: z.object({ action: z.literal("approve") }),
      },
    );

    expect((gate as NextResponse).status).toBe(404);
  });

  it("404s a non-admin with invalid query params too", async () => {
    const gate = await guard(
      req({ url: "http://localhost:3000/api/admin/overview?days=abc" }),
      {
        policy: "admin",
        auth: "optional",
        admin: true,
        query: z.object({ days: z.coerce.number().int().max(365) }),
      },
    );

    expect((gate as NextResponse).status).toBe(404);
  });

  it("lets an admin through", async () => {
    isAdmin.mockResolvedValue(true);

    const gate = await guard(req(), {
      policy: "admin",
      auth: "optional",
      admin: true,
    });

    expect(gate).not.toBeInstanceOf(NextResponse);
  });
});

describe("input validation", () => {
  it("400s a body that fails the schema", async () => {
    const gate = await guard(
      req({ method: "POST", headers: sameOrigin, body: { name: 42 } }),
      { policy: "mutation", body: z.object({ name: z.string() }) },
    );

    expect((gate as NextResponse).status).toBe(400);
  });

  it("400s a body that is not JSON at all", async () => {
    const bad = new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: { ...sameOrigin, "content-type": "application/json" },
      body: "{not json",
    });

    const gate = await guard(bad, {
      policy: "mutation",
      body: z.object({ name: z.string() }),
    });

    expect((gate as NextResponse).status).toBe(400);
  });

  it("returns the parsed body, not the raw one", async () => {
    const gate = await guard(
      req({
        method: "POST",
        headers: sameOrigin,
        body: { name: " x ", extra: "dropped" },
      }),
      {
        policy: "mutation",
        body: z.object({ name: z.string().trim() }),
      },
    );

    expect(gate).not.toBeInstanceOf(NextResponse);
    // Trimmed by the schema, and the unknown key stripped.
    expect((gate as { body: { name: string } }).body).toEqual({ name: "x" });
  });

  it("400s invalid query parameters", async () => {
    const gate = await guard(
      req({ url: "http://localhost:3000/api/x?days=9999" }),
      {
        policy: "read",
        query: z.object({ days: z.coerce.number().int().max(365) }),
      },
    );

    expect((gate as NextResponse).status).toBe(400);
  });
});
