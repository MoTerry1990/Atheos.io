import { describe, expect, it } from "vitest";

import {
  isDeliverableUrl,
  signPayload,
  verifySignature,
} from "@/services/worker/webhooks";

/**
 * Outbound webhook signing and the SSRF guard.
 *
 * Both are pure functions, and both are the kind of thing that is silently
 * wrong: a signature that does not actually depend on the body still looks like
 * a signature, and a URL filter that misses one encoding of localhost still
 * looks like a filter.
 */

const SECRET = "test-secret-at-least-16-chars";

describe("signPayload", () => {
  it("produces a hex HMAC", () => {
    const sig = signPayload('{"a":1}', 1_700_000_000, SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same input", () => {
    expect(signPayload("body", 1, SECRET)).toBe(signPayload("body", 1, SECRET));
  });

  it("changes when the body changes", () => {
    expect(signPayload('{"a":1}', 1, SECRET)).not.toBe(
      signPayload('{"a":2}', 1, SECRET),
    );
  });

  it("changes when the timestamp changes", () => {
    // This is what stops replay. Signing the body alone would make a captured
    // delivery valid forever.
    expect(signPayload("body", 1, SECRET)).not.toBe(
      signPayload("body", 2, SECRET),
    );
  });

  it("changes when the secret changes", () => {
    expect(signPayload("body", 1, SECRET)).not.toBe(
      signPayload("body", 1, "another-secret-16-chars"),
    );
  });
});

describe("verifySignature", () => {
  it("accepts a signature it produced", () => {
    const body = '{"event":"generation.completed"}';
    const ts = 1_700_000_000;
    expect(
      verifySignature(body, ts, SECRET, signPayload(body, ts, SECRET)),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const ts = 1_700_000_000;
    const sig = signPayload('{"credits":1}', ts, SECRET);
    expect(verifySignature('{"credits":9999}', ts, SECRET, sig)).toBe(false);
  });

  it("rejects a replayed timestamp", () => {
    const body = "x";
    const sig = signPayload(body, 1_700_000_000, SECRET);
    expect(verifySignature(body, 1_700_000_999, SECRET, sig)).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // `timingSafeEqual` throws on a length mismatch. Handling it is what stops
    // a malformed header becoming a 500.
    expect(() => verifySignature("x", 1, SECRET, "short")).not.toThrow();
    expect(verifySignature("x", 1, SECRET, "short")).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(verifySignature("x", 1, SECRET, "")).toBe(false);
  });
});

describe("isDeliverableUrl — the SSRF guard", () => {
  it("accepts an ordinary public HTTPS URL", () => {
    expect(isDeliverableUrl("https://example.com/hooks/atheos")).toBe(true);
    expect(isDeliverableUrl("https://api.customer.io:8443/x?y=1")).toBe(true);
  });

  it("refuses plaintext HTTP", () => {
    // A signed payload over plaintext is a signed payload anyone on the path
    // can read.
    expect(isDeliverableUrl("http://example.com/hook")).toBe(false);
  });

  it("refuses non-HTTP schemes", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com",
      "gopher://example.com",
    ]) {
      expect(isDeliverableUrl(url), url).toBe(false);
    }
  });

  it("refuses the cloud metadata address", () => {
    // The one that matters most: fetching this on an attacker's behalf hands
    // them our instance credentials.
    expect(isDeliverableUrl("https://169.254.169.254/latest/meta-data/")).toBe(
      false,
    );
  });

  it("refuses loopback in every form it accepts", () => {
    for (const url of [
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://0.0.0.0/hook",
      "https://api.localhost/hook",
      "https://[::1]/hook",
    ]) {
      expect(isDeliverableUrl(url), url).toBe(false);
    }
  });

  it("refuses RFC1918 private ranges", () => {
    for (const url of [
      "https://10.0.0.5/hook",
      "https://172.16.0.1/hook",
      "https://172.31.255.254/hook",
      "https://192.168.1.1/hook",
    ]) {
      expect(isDeliverableUrl(url), url).toBe(false);
    }
  });

  it("does not over-block addresses that only look private", () => {
    // 172.32 is public; a naive `startsWith("172.")` would block it.
    expect(isDeliverableUrl("https://172.32.0.1/hook")).toBe(true);
    expect(isDeliverableUrl("https://11.0.0.1/hook")).toBe(true);
  });

  it("refuses internal-looking hostnames", () => {
    for (const url of [
      "https://db.internal/hook",
      "https://printer.local/hook",
    ]) {
      expect(isDeliverableUrl(url), url).toBe(false);
    }
  });

  it("refuses IPv6 unique-local and link-local", () => {
    expect(isDeliverableUrl("https://[fd00::1]/hook")).toBe(false);
    expect(isDeliverableUrl("https://[fe80::1]/hook")).toBe(false);
  });

  it("refuses a malformed URL rather than throwing", () => {
    expect(isDeliverableUrl("not a url")).toBe(false);
    expect(isDeliverableUrl("")).toBe(false);
  });
});
