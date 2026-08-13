import { describe, expect, it } from "vitest";

import { grantPeriod } from "@/services/billing/free-grant";

/**
 * The period key is the whole idempotency guarantee.
 *
 * If two runs in the same month produce different keys, the free tier pays out
 * twice. If two runs in different months produce the same key, it never pays
 * out again. Both failures are silent and both are expensive in opposite
 * directions, so the boundary is worth pinning down.
 */

describe("grantPeriod", () => {
  it("is stable across a whole month", () => {
    const first = grantPeriod(new Date("2026-08-01T00:00:00Z"));
    const last = grantPeriod(new Date("2026-08-31T23:59:59Z"));
    expect(first).toBe("2026-08");
    expect(last).toBe("2026-08");
  });

  it("changes at the month boundary", () => {
    expect(grantPeriod(new Date("2026-08-31T23:59:59Z"))).not.toBe(
      grantPeriod(new Date("2026-09-01T00:00:00Z")),
    );
  });

  it("zero-pads so keys sort and never collide", () => {
    // "2026-9" and "2026-09" would be two different keys for one month, which
    // is a double grant the moment the padding changes.
    expect(grantPeriod(new Date("2026-09-15T12:00:00Z"))).toBe("2026-09");
    expect(grantPeriod(new Date("2026-12-15T12:00:00Z"))).toBe("2026-12");
  });

  it("reads the month in UTC, not the server's timezone", () => {
    // 31 August 21:00 in Lima is 1 September 02:00 UTC. Whichever the server
    // is set to, every instance must agree on the period or one of them grants
    // a second time.
    const instant = new Date("2026-09-01T02:00:00Z");
    expect(grantPeriod(instant)).toBe("2026-09");
    expect(instant.getUTCMonth()).toBe(8);
  });

  it("rolls the year over", () => {
    expect(grantPeriod(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
    expect(grantPeriod(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01");
  });
});
