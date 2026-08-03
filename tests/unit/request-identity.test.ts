import { describe, expect, it } from "vitest";

import { callerKey, clientIp, verifyCsrf } from "@/lib/request-identity";

const request = (headers: Record<string, string>, method = "POST") =>
  new Request("http://localhost:3000/api/projects", { method, headers });

/**
 * CSRF is a pure function of request headers, which makes "did we get the
 * verdict right" fully testable — and it is the one control where a wrong
 * verdict is invisible until someone exploits it.
 */
describe("verifyCsrf", () => {
  it("accepts a same-origin fetch", () => {
    expect(verifyCsrf(request({ "sec-fetch-site": "same-origin" })).ok).toBe(
      true,
    );
  });

  it("refuses cross-site", () => {
    const verdict = verifyCsrf(request({ "sec-fetch-site": "cross-site" }));
    expect(verdict.ok).toBe(false);
  });

  it("refuses same-site (a sibling subdomain is not us)", () => {
    expect(verifyCsrf(request({ "sec-fetch-site": "same-site" })).ok).toBe(
      false,
    );
  });

  it("refuses `none` — a direct navigation cannot be one of our mutations", () => {
    expect(verifyCsrf(request({ "sec-fetch-site": "none" })).ok).toBe(false);
  });

  it("trusts Sec-Fetch-Site over a forged Origin", () => {
    // Script cannot set Sec-Fetch-Site; it can set neither in a real browser,
    // but an attacker replaying with curl controls Origin entirely. When both
    // are present the unforgeable one has to win.
    const verdict = verifyCsrf(
      request({
        "sec-fetch-site": "cross-site",
        origin: "http://localhost:3000",
      }),
    );
    expect(verdict.ok).toBe(false);
  });

  it("falls back to an Origin allowlist when Sec-Fetch-Site is absent", () => {
    expect(verifyCsrf(request({ origin: "http://localhost:3000" })).ok).toBe(
      true,
    );
  });

  it("refuses a foreign Origin", () => {
    expect(verifyCsrf(request({ origin: "https://evil.example" })).ok).toBe(
      false,
    );
  });

  it("refuses a request carrying neither header", () => {
    // Deliberate: a same-origin fetch always sends one of them, so a request
    // with neither is not our UI and has no business holding a session cookie.
    const verdict = verifyCsrf(request({}));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/no origin/i);
  });

  it("does not accept an Origin that merely starts with ours", () => {
    expect(
      verifyCsrf(request({ origin: "http://localhost:3000.evil.example" })).ok,
    ).toBe(false);
  });
});

describe("clientIp", () => {
  it("prefers x-real-ip", () => {
    expect(
      clientIp(
        request({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "1.2.3.4" }),
      ),
    ).toBe("203.0.113.5");
  });

  it("takes the leftmost x-forwarded-for entry", () => {
    // The platform appends, so with a trusted proxy the leftmost is the origin
    // client. Taking the last would key every request to our own load balancer.
    expect(
      clientIp(
        request({
          "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178",
        }),
      ),
    ).toBe("203.0.113.5");
  });

  it("trims whitespace", () => {
    expect(
      clientIp(request({ "x-forwarded-for": "  203.0.113.5  , 1.1.1.1" })),
    ).toBe("203.0.113.5");
  });

  it("returns a single shared bucket when no proxy header exists", () => {
    // Over-limits rather than under-limits, and is visible immediately in dev.
    expect(clientIp(request({}))).toBe("unknown");
  });
});

describe("callerKey", () => {
  it("prefers the user id over the IP", () => {
    // An authenticated caller has proven who they are: the key cannot be
    // spoofed, is not shared behind a NAT, and survives an IP change.
    expect(callerKey(request({ "x-real-ip": "203.0.113.5" }), "user_abc")).toBe(
      "u:user_abc",
    );
  });

  it("falls back to the IP when anonymous", () => {
    expect(callerKey(request({ "x-real-ip": "203.0.113.5" }), null)).toBe(
      "ip:203.0.113.5",
    );
  });

  it("cannot be made to collide across the two namespaces", () => {
    // Without the `u:`/`ip:` prefixes, a user whose id happened to look like an
    // IP would share a bucket with that IP.
    expect(callerKey(request({}), "203.0.113.5")).not.toBe(
      callerKey(request({ "x-real-ip": "203.0.113.5" }), null),
    );
  });
});
