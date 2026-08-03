import { expect, test } from "@playwright/test";

/**
 * The security posture, observed over real HTTP against the production build.
 *
 * Every assertion here was verified by hand in Sprint 15 and then forgotten by
 * the codebase. These are the checks that stop the next change quietly removing
 * a guard — which matters more than usual, because those guards are what stands
 * between a signed-in user and our provider bill.
 */

test.describe("admin surface is undiscoverable", () => {
  // A 401 or a 403 confirms the endpoint exists. Everything must answer 404,
  // identically to a path that genuinely does not exist.
  const adminRoutes = [
    "/admin",
    "/api/admin/overview",
    "/api/admin/users",
    "/api/admin/audit",
    "/api/admin/status",
    "/api/admin/moderation",
  ];

  for (const route of adminRoutes) {
    test(`${route} answers 404 to an anonymous caller`, async ({ request }) => {
      expect((await request.get(route)).status()).toBe(404);
    });
  }

  test("a nonexistent sibling answers identically", async ({ request }) => {
    const real = await request.get("/api/admin/overview");
    const fake = await request.get("/api/adminx");
    expect(real.status()).toBe(fake.status());
  });

  test("a malformed body does not produce a different answer", async ({
    request,
  }) => {
    // The Sprint 15 leak: input was parsed before the 404 check, so a bad body
    // got 400 and a good one got 404.
    const response = await request.post("/api/admin/moderation", {
      headers: { "sec-fetch-site": "same-origin" },
      data: { garbage: true },
    });
    expect(response.status()).toBe(404);
  });
});

test.describe("authentication", () => {
  const guarded = [
    "/api/projects",
    "/api/folders",
    "/api/collections",
    "/api/billing",
    "/api/generations",
    "/api/marketplace/installed",
  ];

  for (const route of guarded) {
    test(`${route} rejects an anonymous read with 401`, async ({ request }) => {
      expect((await request.get(route)).status()).toBe(401);
    });
  }
});

test.describe("cross-origin request forgery", () => {
  test("refuses a cross-site mutation", async ({ request }) => {
    const response = await request.post("/api/projects", {
      headers: { origin: "https://evil.example" },
      data: { name: "x" },
    });
    expect(response.status()).toBe(403);
  });

  test("refuses a mutation carrying neither Origin nor Sec-Fetch-Site", async ({
    request,
  }) => {
    // A same-origin fetch always sends one. Something with neither is not our
    // UI and has no business holding a session cookie.
    const response = await request.post("/api/projects", {
      data: { name: "x" },
    });
    expect(response.status()).toBe(403);
  });

  test("a same-origin mutation passes CSRF and is stopped by auth instead", async ({
    request,
  }) => {
    // Proves the 403s above are the CSRF check and not a blanket refusal.
    const response = await request.post("/api/projects", {
      headers: { "sec-fetch-site": "same-origin" },
      data: { name: "x" },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("rate limiting", () => {
  test("refuses with 429 and Retry-After once the window is spent", async ({
    request,
  }) => {
    // The webhook policy is the tightest at 20/min, which keeps this test fast.
    // 503 is the expected pass-through here: STRIPE_WEBHOOK_SECRET is unset, so
    // the route fails closed — which is itself worth observing.
    let refused: number | null = null;

    for (let i = 0; i < 30; i++) {
      const response = await request.post("/api/webhooks/stripe", {
        data: {},
        failOnStatusCode: false,
      });
      if (response.status() === 429) {
        refused = i + 1;
        expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0);
        break;
      }
    }

    expect(refused, "expected a 429 within 30 requests").not.toBeNull();
  });
});

test.describe("security headers", () => {
  test("ships an enforcing CSP, not Report-Only", async ({ request }) => {
    const headers = (await request.get("/")).headers();
    expect(headers["content-security-policy"]).toBeTruthy();
    expect(headers["content-security-policy-report-only"]).toBeUndefined();
  });

  test("the CSP forbids framing, plugins and base rewriting", async ({
    request,
  }) => {
    const csp = (await request.get("/")).headers()["content-security-policy"];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  test("the CSP grants no unsafe-eval", async ({ request }) => {
    const csp = (await request.get("/")).headers()["content-security-policy"];
    expect(csp).not.toContain("unsafe-eval");
  });

  test("the CSP does not allow origins we removed", async ({ request }) => {
    // UploadThing went in Sprint 14. An allowed origin nobody uses is an
    // allowed origin nobody is watching.
    const csp = (await request.get("/")).headers()["content-security-policy"];
    expect(csp).not.toContain("utfs.io");
    expect(csp).not.toContain("ufs.sh");
  });

  test("sends the rest of the header set", async ({ request }) => {
    const headers = (await request.get("/")).headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["strict-transport-security"]).toContain("max-age=");
  });

  test("never caches an API response", async ({ request }) => {
    const cacheControl = (await request.get("/api/marketplace")).headers()[
      "cache-control"
    ];
    expect(cacheControl).toContain("no-store");
    expect(cacheControl).toContain("private");
  });
});
