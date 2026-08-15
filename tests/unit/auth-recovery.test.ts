import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
  it("exports clerkMiddleware directly, with nothing in front of it", () => {
    // The regression, stated as code. A wrapper that inspects the pathname and
    // conditionally calls Clerk is what broke the session, whatever list of
    // paths happens to sit inside it.
    expect(middlewareCode).toMatch(/export default clerkMiddleware\(/);
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
  it("never names, parses or stores the handshake parameter", () => {
    expect(middlewareCode).not.toContain("__clerk_handshake");
    expect(middlewareCode).not.toMatch(/searchParams\.get/);
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
