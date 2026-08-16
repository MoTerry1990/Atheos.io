import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CLERK_PARAMS,
  CONFIGURATION_FAULT,
  RETRY_MARKER,
  destinationFor,
} from "@/middleware";

/**
 * The two failures that reached production together, and the rules that stop
 * either coming back.
 *
 * ## 1. "Public route" was treated as "skip Clerk"
 *
 * Sprint 4.2 added a `CLERK_FREE_PATHS` set that returned early and never
 * invoked `clerkMiddleware` for `/`, `/es`, the pricing pages and the legal
 * pages. The reasoning — those pages read no user data, so a session is work
 * with no consumer — was factually correct and led to the wrong conclusion.
 *
 * Clerk's middleware is not only an authorisation gate. It completes the
 * handshake, sets and rotates the session cookie, and keeps the browser's view
 * of the session in step with the server's. A signed-in visitor loading the
 * homepage is still a signed-in visitor, and a request that skips Clerk is a
 * request where that synchronisation silently does not happen.
 *
 * The result was a client/server split: `/sign-in` said "You are already
 * signed in" while `/dashboard` and `/studio` bounced back to it, because
 * `getUserId()` found nothing server-side. It reproduced in fresh Incognito
 * windows and across browsers, which is what ruled out stale cookies.
 *
 * **Why the earlier synthetic tests missed it.** They fired a fake handshake
 * at `/profile`, `/dashboard` and `/studio` — none of which was in the bypass
 * set, so every one went through Clerk and passed. The bypassed paths were
 * never tested with a handshake at all. A test that exercises only the paths a
 * change did not affect will agree with the change every time.
 *
 * ## 2. Critical content shipped invisible
 *
 * `Reveal` and the hero used an opacity-zero initial state, which Next writes
 * into the server HTML as an inline style. Forty elements — the h1, every h2,
 * both CTAs, the composer — needed JavaScript to load, hydrate *and* an
 * IntersectionObserver to fire before they could be seen. One Chrome profile
 * rendered the background and header with a blank hero, and clearing site data
 * did not reliably fix it.
 */

const ROOT = resolve(import.meta.dirname, "../..");

function source(relative: string) {
  const text = readFileSync(resolve(ROOT, relative), "utf8");
  if (text.length < 150) throw new Error(`${relative} is empty or unreadable`);
  return text;
}

/**
 * The file with its comments stripped.
 *
 * Every one of these files *documents* the bug it no longer has. Asserting
 * against raw text matches those explanations and fails — which on the first
 * run made four correct behaviours look broken.
 *
 * Deleting the history to satisfy a regex would be the wrong repair: those
 * comments are why the next person does not reintroduce it. So the assertions
 * read the code instead.
 */
function code(relative: string) {
  return source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const middleware = source("middleware.ts");
const middlewareCode = code("middleware.ts");

describe("Clerk runs on every matched request", () => {
  it("reaches clerkMiddleware unconditionally, on every matched request", () => {
    /**
     * This used to assert `export default clerkMiddleware(`, on the reasoning
     * that any wrapper was the bug. That was too literal a reading of it.
     *
     * The bug was never the wrapper — it was the *condition* inside one: a
     * pathname check that returned early and never let Clerk run. The handshake
     * fix does wrap the handler, in a `try`, and calls it on every request
     * without inspecting anything first.
     *
     * So the assertion is what actually matters: nothing stands between
     * entering the middleware and calling the handler.
     */
    const body = middlewareCode.slice(
      middlewareCode.indexOf("export default async function middleware"),
    );
    const beforeHandler = body.slice(0, body.indexOf("await handler("));

    expect(beforeHandler).toMatch(/\{\s*try\s*\{\s*return\s*$/);
    expect(beforeHandler).not.toContain("if");
    expect(middlewareCode).toMatch(/clerkMiddleware\(/);
  });

  it("has no path allowlist that bypasses Clerk", () => {
    expect(middlewareCode).not.toMatch(/CLERK_FREE_PATHS/);
    expect(middlewareCode).not.toMatch(/withClerk/);
    expect(middlewareCode).not.toMatch(
      /if\s*\([^)]*pathname[^)]*\)\s*\{?\s*return/,
    );
  });

  it("keeps the public marketing routes inside the matcher", () => {
    // Excluding `/` or `/es` from the matcher is the same bug expressed as a
    // regex rather than a Set.
    const matcher = middleware.match(/matcher:\s*\[([\s\S]*?)\]/)?.[1] ?? "";

    for (const excluded of ["es$", "pricing$", "privacy$", "connect$"]) {
      expect(
        matcher,
        `the matcher excludes ${excluded}, which would skip Clerk there`,
      ).not.toContain(excluded);
    }

    expect(matcher).toContain("_next");
    expect(matcher).toContain("design-system");
  });

  it("still refuses to protect routes by path matching", () => {
    // Authorisation lives with the resource. `auth.protect()` here would
    // reintroduce the path/router drift Clerk 7 deprecated.
    expect(middlewareCode).not.toMatch(/auth\(\)\.protect|auth\.protect/);
    expect(source("app/(app)/layout.tsx")).toContain("requireUserId()");
  });

  it("cannot let a request through after an auth failure", () => {
    expect(middlewareCode).not.toMatch(
      /catch\s*(\([^)]*\))?\s*\{[^}]*NextResponse\.next/s,
    );
    expect(middlewareCode).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
  });
});

describe("the middleware handles no Clerk internals itself", () => {
  it("names the handshake parameter only in order to delete it", () => {
    /**
     * This used to forbid the string `__clerk_handshake` outright. That rule
     * held while the middleware was a pass-through; it stopped being right when
     * the fix had to *strip* the parameter, which it cannot do without naming
     * it.
     *
     * The durable rule is narrower and is the one that protects the credential:
     * the middleware may remove Clerk's parameters, and may never read, decode,
     * copy or store their values.
     */
    expect(middlewareCode).toMatch(/searchParams\.delete\(param\)/);

    // Reading a value is the prohibited operation, however it is spelled.
    expect(middlewareCode).not.toMatch(/searchParams\.get/);
    expect(middlewareCode).not.toMatch(/get\(\s*["'`]__clerk/);
    expect(middlewareCode).not.toMatch(
      /cookies\.get|headers\.get\(\s*["'`]cookie/i,
    );

    // `.has(RETRY_MARKER)` is the one membership test, and its subject is our
    // own marker, not a Clerk parameter.
    const membership = [
      ...middlewareCode.matchAll(/searchParams\.has\(([^)]*)\)/g),
    ];
    expect(membership.length).toBeGreaterThan(0);
    for (const [, subject] of membership) {
      expect(subject).toBe("RETRY_MARKER");
    }
  });

  it("never decodes a session token", () => {
    expect(middlewareCode).not.toMatch(/jwtVerify|decodeJwt|atob\(|__session/);
  });

  it("logs nothing", () => {
    // A `console.log(request.url)` here writes the handshake token into the
    // platform's logs on every authenticated redirect.
    expect(middlewareCode).not.toMatch(/console\.(log|info|debug|warn|error)/);
  });
});

describe("the middleware stays Edge-safe", () => {
  it("imports no Node built-in", () => {
    const imports = [...middleware.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (m) => m[1]!,
    );

    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(specifier).not.toMatch(/^node:/);
      expect(specifier).not.toMatch(
        /^(fs|path|crypto|net|tls|child_process|os)$/,
      );
    }
  });

  it("never reaches the database or the validated env module", () => {
    expect(middlewareCode).not.toMatch(/@\/lib\/prisma|PrismaClient/);
    expect(middlewareCode).not.toMatch(/from\s+["']@\/lib\/env["']/);
  });
});

describe("authenticated redirects", () => {
  const auth = source("lib/auth.ts");
  const signIn = source("app/(auth)/sign-in/[[...sign-in]]/page.tsx");

  it("rejects a protocol-relative open redirect", () => {
    expect(auth).toMatch(/startsWith\("\/"\)/);
    expect(auth).toMatch(/startsWith\("\/\/"\)/);
    expect(signIn).toMatch(/startsWith\("\/\/"\)/);
  });

  it("bounces a signed-in visitor off the sign-in page", () => {
    // Without this the visitor sits on a form Clerk refuses, reading "You are
    // already signed in" — which is exactly what the broken session looked
    // like from the outside.
    expect(signIn).toMatch(/getUserId\(\)/);
    expect(signIn).toMatch(/redirect\(safe\)/);
  });

  it("falls back to the dashboard when no destination was requested", () => {
    expect(signIn).toMatch(/"\/dashboard"/);
  });

  it("preserves the requested destination through sign-in", () => {
    expect(auth).toMatch(/encodeURIComponent\(path\)/);
    expect(auth).toMatch(/redirect_url=/);
  });
});

describe("critical homepage content does not need JavaScript", () => {
  const globals = source("styles/globals.css");
  const section = code("features/marketing/components/section.tsx");
  const hero = code("features/marketing/components/hero.tsx");
  const showcase = code("features/marketing/components/ai-showcase.tsx");

  it("animates entrances in CSS, from a visible resting state", () => {
    expect(globals).toMatch(/@keyframes reveal-in\b/);

    // The animation may only exist inside the no-preference guard, so a
    // reduced-motion reader gets the resting state with no animation at all.
    const afterKeyframes = globals.slice(
      globals.indexOf("@keyframes reveal-in"),
    );
    expect(afterKeyframes).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)/,
    );
  });

  it("sets no opacity-zero initial state on any marketing entrance", () => {
    for (const [name, file] of [
      ["Reveal", section],
      ["Hero", hero],
      ["AIShowcase", showcase],
    ] as const) {
      expect(file, `${name} still hides content before hydration`).not.toMatch(
        /initial=\{\{\s*opacity:\s*0/,
      );
      expect(file, `${name} uses a hidden motion variant`).not.toMatch(
        /initial="hidden"/,
      );
    }
  });

  it("renders Reveal as a plain element", () => {
    // Not a motion component. The whole point is that nothing has to run.
    expect(section).not.toMatch(/motion\./);
    expect(section).toMatch(/"reveal"/);
  });

  it("keeps the hero free of the animation library entirely", () => {
    expect(hero).not.toMatch(/from "motion\/react"/);
    expect(hero).toMatch(/reveal/);
  });
});

describe("no service worker interferes with the homepage", () => {
  it("registers none anywhere in the app", () => {
    // A stale service worker serving obsolete chunks is a classic cause of
    // "it works in Incognito but not in my normal profile". There is no PWA
    // here and none intended, so nothing should ever register one — then there
    // is no cache to go stale.
    for (const file of [
      "app/layout.tsx",
      "providers/index.tsx",
      "next.config.ts",
    ]) {
      const text = source(file);
      expect(text, `${file} registers a service worker`).not.toMatch(
        /serviceWorker|navigator\.serviceWorker|workbox|next-pwa/,
      );
    }
  });
});

describe("the handshake never reaches a header, a log or a redirect_url", () => {
  /**
   * `destinationFor` is the function that decides what `x-pathname` carries,
   * and `x-pathname` is what `lib/auth.ts` turns into `redirect_url`.
   *
   * It used to be `pathname + search`, verbatim. On a real OAuth return that
   * copied a multi-kilobyte handshake token — a credential — into a request
   * header, on the one request where the header budget is already largest.
   *
   * **Tokens here are synthetic and sized like the real thing.** The previous
   * round of tests used ~40 characters, which is why they passed against a
   * defect that only manifests at kilobyte scale.
   */
  const SYNTHETIC = "s".repeat(6000);

  function requestFor(url: string) {
    return { nextUrl: new URL(url) } as unknown as Parameters<
      typeof destinationFor
    >[0];
  }

  it("strips every Clerk parameter", () => {
    for (const param of CLERK_PARAMS) {
      const result = destinationFor(
        requestFor(`https://atheos.io/sign-in?${param}=${SYNTHETIC}`),
      );

      expect(result).toBe("/sign-in");
      expect(result).not.toContain(param);
      expect(result).not.toContain("s".repeat(50));
    }
  });

  it("keeps the parameters a destination actually needs", () => {
    // `/studio?prompt=...` is a real destination somebody was heading for.
    const result = destinationFor(
      requestFor("https://atheos.io/studio?prompt=neon+rain&modality=image"),
    );

    expect(result).toContain("/studio");
    expect(result).toContain("prompt=neon");
    expect(result).toContain("modality=image");
  });

  it("drops the query entirely rather than emitting an unbounded value", () => {
    // This becomes `redirect_url` on a later redirect. Unbounded here is
    // unbounded there.
    const result = destinationFor(
      requestFor(`https://atheos.io/studio?prompt=${SYNTHETIC}`),
    );

    expect(result).toBe("/studio");
    expect(result.length).toBeLessThanOrEqual(512);
  });

  it("returns a same-origin path, never an absolute URL", () => {
    const result = destinationFor(requestFor("https://atheos.io/dashboard"));

    expect(result).toBe("/dashboard");
    expect(result).not.toMatch(/^https?:/);
  });

  it("refuses to emit a protocol-relative path", () => {
    /**
     * The first version of this test only ever passed `/dashboard`, then
     * asserted the result did not begin with `//`. It passed, and it proved
     * nothing — `/dashboard` was never going to begin with `//`.
     *
     * `https://atheos.io//evil.com` has the pathname `//evil.com`, and that is
     * the input that matters: a browser handed `//evil.com` as a redirect
     * target navigates to `https://evil.com`. This asserts against that input.
     */
    for (const hostile of [
      "https://atheos.io//evil.com",
      "https://atheos.io//evil.com/path?next=1",
      `https://atheos.io//evil.com?__clerk_handshake=${SYNTHETIC}`,
    ]) {
      const result = destinationFor(requestFor(hostile));

      expect(result).toBe("/");
      expect(result).not.toContain("evil.com");
    }
  });
});

describe("an unresolvable handshake fails safe, not open and not fatal", () => {
  const middlewareBody = code("middleware.ts");

  it("never lets the request through after a handshake failure", () => {
    /**
     * The prohibited shape is `catch { return NextResponse.next() }` — it
     * silently proceeds as though nothing went wrong. The recovery here issues
     * a **redirect** to a cleaned URL instead, so the visitor arrives
     * unauthenticated and every protected route still gates them.
     */
    const catchBlock = middlewareBody.slice(middlewareBody.indexOf("catch"));

    expect(catchBlock).not.toMatch(/NextResponse\.next/);
    expect(catchBlock).toMatch(/NextResponse\.redirect/);
  });

  it("re-throws anything that is not a retryable handshake failure", () => {
    /**
     * A configuration error must stay loud. Swallowing every exception is how
     * a broken instance looks healthy.
     *
     * This asserted the exact source line until `isConfigurationFault` joined
     * the condition. Matching a literal line makes any edit to it a failure,
     * including a correct one — so it now pins the three things that must
     * remain true of the guard, in any order.
     */
    const guard =
      middlewareBody.match(/if \(([^)]*)\) \{\s*throw error;/)?.[1] ?? "";

    expect(guard).toContain("isConfigurationFault");
    expect(guard).toContain("!isHandshakeFailure");
    expect(guard).toContain("alreadyRetried");
  });

  it("attempts recovery exactly once", () => {
    // Without the marker, a handshake that fails every time is redirected,
    // reissued and failed again — a loop worse than the error it replaces.
    expect(middlewareBody).toMatch(/RETRY_MARKER/);
    expect(middlewareBody).toMatch(/searchParams\.has\(RETRY_MARKER\)/);
    expect(RETRY_MARKER.startsWith("__")).toBe(true);
  });

  it("strips Clerk parameters from the recovery target", () => {
    const catchBlock = middlewareBody.slice(middlewareBody.indexOf("catch"));
    expect(catchBlock).toMatch(/searchParams\.delete\(param\)/);
  });

  it("marks the recovery redirect uncacheable", () => {
    // The next visitor to this path has their own handshake; a cached redirect
    // would hand them somebody else's outcome.
    const catchBlock = middlewareBody.slice(middlewareBody.indexOf("catch"));
    expect(catchBlock).toMatch(/no-store/);
  });
});

describe("a bad Clerk key fails immediately, not after a wasted retry", () => {
  /**
   * The exact message from Vercel Runtime Logs, production deployment
   * dpl_9vm7ChUpH5sfCZBbk2UbzvZfxyax, commit e2e1f49, source edge-middleware.
   *
   * It carries no secret material: Clerk names the *kind* of key that failed
   * and a reason code, never the key. Nothing here needed redacting, and
   * nothing here is a real credential.
   */
  const PRODUCTION_MESSAGE =
    "Clerk: Handshake token verification failed: The provided Clerk Secret " +
    "Key is invalid. Make sure that your Clerk Secret Key is correct. " +
    "Contact support@clerk.com (reason=secret-key-invalid, " +
    "token-carrier=undefined).";

  it("classifies the real production exception as a configuration fault", () => {
    expect(CONFIGURATION_FAULT.test(PRODUCTION_MESSAGE)).toBe(true);
  });

  it("still matches the handshake test, which is why it needed its own rule", () => {
    /**
     * This is the whole trap. The message contains "Handshake", so the
     * transient-failure branch claimed it and retried something that cannot
     * succeed. Pinning both facts together stops anyone "simplifying" the two
     * checks back into one.
     */
    expect(/handshake/i.test(PRODUCTION_MESSAGE)).toBe(true);
    expect(CONFIGURATION_FAULT.test(PRODUCTION_MESSAGE)).toBe(true);
  });

  it("re-throws configuration faults before the retry branch is reached", () => {
    const body = code("middleware.ts");
    const guard = body.slice(
      body.indexOf("const isConfigurationFault"),
      body.indexOf("NextResponse.redirect"),
    );

    expect(guard).toMatch(/if \(isConfigurationFault \|\|/);
    expect(guard).toMatch(/throw error/);
    // The throw must come before the redirect is ever constructed.
    expect(guard).not.toMatch(/NextResponse\.redirect/);
  });

  it("leaves a genuinely corrupt handshake retryable", () => {
    // The other real exception, from the earlier local reproduction. A garbled
    // token can succeed on a second attempt; a wrong key cannot.
    const corrupt =
      "Clerk: unable to resolve handshake: SyntaxError: Unexpected end of data";

    expect(/handshake/i.test(corrupt)).toBe(true);
    expect(CONFIGURATION_FAULT.test(corrupt)).toBe(false);
  });

  it("does not classify unrelated errors as configuration faults", () => {
    for (const unrelated of [
      "TypeError: fetch failed",
      "Clerk: unable to resolve handshake: SyntaxError: Unexpected end of data",
      "Database connection terminated unexpectedly",
    ]) {
      expect(CONFIGURATION_FAULT.test(unrelated)).toBe(false);
    }
  });

  it("contains no key material in the fixture", () => {
    // A regression fixture must never carry a credential, even an expired one.
    expect(PRODUCTION_MESSAGE).not.toMatch(/sk_(test|live)_/);
    expect(PRODUCTION_MESSAGE).not.toMatch(/pk_(test|live)_/);
    expect(PRODUCTION_MESSAGE).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  });
});
