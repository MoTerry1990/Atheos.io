import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stripe webhook idempotency.
 *
 * `docs/LAUNCH.md` calls redelivering a webhook and confirming it grants
 * nothing "the single most important check in this document: it is the
 * difference between a working ledger and giving inventory away".
 *
 * The database half is proven in `tests/db` — the primary key rejects a
 * replayed event id. This is the **application** half: does the route treat
 * that rejection as "already processed", and — the bug Sprint 14 fixed — does
 * it correctly refuse to treat anything *else* that way?
 *
 * Prisma and Stripe are mocked. That is the point: the failure being tested is
 * how the route reacts to a specific database error, and provoking a connection
 * failure from a real database on demand is harder and less precise than
 * asserting on the reaction.
 */

const create = vi.fn();
const deleteFn = vi.fn();
const constructEvent = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    webhookEvent: { create, delete: deleteFn },
  },
}));

vi.mock("@/lib/stripe", () => ({
  stripe: { webhooks: { constructEvent } },
}));

vi.mock("@/lib/env", () => ({
  env: {
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));

// The guard is exercised in its own suite; here it must not gate the webhook.
vi.mock("@/lib/api-guard", () => ({
  guard: vi.fn(async () => ({
    user: null,
    sessionId: null,
    body: undefined,
    query: undefined,
    headers: {},
  })),
}));

vi.mock("@/services/billing/credits", () => ({ grantCredits: vi.fn() }));
vi.mock("@/services/billing/plans", () => ({
  packFor: vi.fn(),
  planFor: vi.fn(),
  resolvePriceId: vi.fn(),
}));
vi.mock("@/services/billing/subscription", () => ({
  syncSubscription: vi.fn(async () => undefined),
}));

const { POST } = await import("@/app/api/webhooks/stripe/route");

/** Prisma's unique-constraint violation. */
const uniqueViolation = () =>
  Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

/** What a dropped connection or exhausted pool looks like. */
const connectionError = () =>
  Object.assign(new Error("Can't reach database server"), { code: "P1001" });

const request = () =>
  new Request("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=abc" },
    body: "{}",
  });

beforeEach(() => {
  vi.clearAllMocks();
  constructEvent.mockReturnValue({
    id: "evt_1",
    type: "invoice.paid",
    data: { object: { id: "in_1", status: "paid" } },
  });
});

describe("signature verification", () => {
  it("refuses an event whose signature does not verify", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const response = await POST(request() as never);

    expect(response.status).toBe(400);
    // Nothing may be recorded for an event we cannot attribute to Stripe.
    expect(create).not.toHaveBeenCalled();
  });
});

describe("idempotency", () => {
  it("processes a first delivery", async () => {
    create.mockResolvedValue({});

    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: "evt_1", source: "stripe" }),
      }),
    );
  });

  it("treats a replayed event id as already processed, and grants nothing", async () => {
    create.mockRejectedValue(uniqueViolation());

    const response = await POST(request() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ duplicate: true });
  });

  it("does NOT treat a connection failure as a duplicate", async () => {
    // The bug Sprint 14 fixed. A bare `catch` returned 200 here — Stripe stops
    // retrying on 200, so the grant was lost permanently and silently, and it
    // happened under exactly the load that causes connection failures.
    create.mockRejectedValue(connectionError());

    const response = await POST(request() as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).not.toMatchObject({ duplicate: true });
  });

  it("returns 500 for an unrecognised error rather than assuming success", async () => {
    create.mockRejectedValue(new Error("something unexpected"));

    const response = await POST(request() as never);
    expect(response.status).toBe(500);
  });

  it("claims the event id BEFORE doing the work", async () => {
    // Order is the whole design. Process-then-record double-applies whenever a
    // response is lost in flight, which for a renewal means a month of credits
    // granted twice.
    const order: string[] = [];
    create.mockImplementation(async () => {
      order.push("claim");
      return {};
    });
    const { syncSubscription } =
      await import("@/services/billing/subscription");
    vi.mocked(syncSubscription).mockImplementation(async () => {
      order.push("work");
    });

    constructEvent.mockReturnValue({
      id: "evt_2",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    });

    await POST(request() as never);

    expect(order).toEqual(["claim", "work"]);
  });

  it("releases the claim when processing fails, so the retry is not rejected", async () => {
    // Without this, one transient error means the event is never processed and
    // no retry can ever fix it — the marker says "done" forever.
    create.mockResolvedValue({});
    deleteFn.mockResolvedValue({});

    const { syncSubscription } =
      await import("@/services/billing/subscription");
    vi.mocked(syncSubscription).mockRejectedValue(new Error("boom"));

    constructEvent.mockReturnValue({
      id: "evt_3",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    });

    const response = await POST(request() as never);

    expect(response.status).toBe(500);
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: "evt_3" } });
  });
});

describe("unhandled event types", () => {
  it("acknowledges without recording or processing", async () => {
    // Stripe sends a great deal. A 500 on something we do not handle puts the
    // endpoint into a retry loop that eventually gets it disabled.
    constructEvent.mockReturnValue({
      id: "evt_4",
      type: "customer.created",
      data: { object: {} },
    });

    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    expect(create).not.toHaveBeenCalled();
  });
});
