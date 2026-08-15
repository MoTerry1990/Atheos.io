import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The authentication routing contract.
 *
 * ## Why this file exists
 *
 * Production started returning `MIDDLEWARE_INVOCATION_FAILED` on the
 * authenticated Clerk handshake — a 500 from the Edge middleware itself, which
 * is the one failure mode with no page, no error boundary and no useful
 * message for the person hitting it.
 *
 * Investigating it turned up no code defect, and these tests exist so that the
 * things which were *checked by hand* during that investigation stay checked:
 * the middleware bundle must not grow a Node-only import, the public-path
 * allowlist must never swallow a protected route, and nothing may log a
 * handshake token.
 *
 * The third one matters most in the specific way this incident could go wrong.
 * The obvious "fix" for a crashing handshake is to add the crashing path to the
 * allowlist, or to wrap the middleware in a `try/catch` that lets the request
 * through. Both make the 500 disappear. Both also disable authentication, and
 * neither would fail any test that existed before this file.
 */

const ROOT = resolve(import.meta.dirname, "../..");

function source(relative: string) {
  const text = readFileSync(resolve(ROOT, relative), "utf8");
  if (text.length < 200) {
    throw new Error(`${relative} is empty or unreadable`);
  }
  return text;
}

const middleware = source("middleware.ts");

/** The exact set the middleware skips Clerk for. Parsed, not restated. */
function clerkFreePaths(): string[] {
  const block = middleware.match(
    /const CLERK_FREE_PATHS = new Set\(\[([\s\S]*?)\]\)/,
  );
  if (!block) throw new Error("CLERK_FREE_PATHS not found in middleware.ts");

  return [...block[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("public paths bypass Clerk", () => {
  it("covers the marketing and legal routes", () => {
    const paths = clerkFreePaths();

    for (const path of [
      "/",
      "/es",
      "/pricing",
      "/es/precios",
      "/privacy",
      "/terms",
      "/acceptable-use",
      "/connect",
    ]) {
      expect(paths, `${path} should skip Clerk`).toContain(path);
    }
  });

  it("never contains a protected route", () => {
    /**
     * **The most important assertion in this file.**
     *
     * Adding `/profile` here would have made the reported crash stop
     * immediately — and would have made `/profile` reachable without a
     * session. The 500 is a bug; serving somebody else's profile is an
     * incident.
     *
     * The `(app)` layout's `requireUserId()` would still redirect, so this is
     * defence in depth rather than the only gate — but a public-path list that
     * quietly grew a protected route is exactly the kind of thing nobody
     * re-reads.
     */
    const paths = clerkFreePaths();

    for (const guarded of [
      "/profile",
      "/dashboard",
      "/studio",
      "/settings",
      "/projects",
      "/sequences",
      "/admin",
      "/marketplace",
    ]) {
      expect(paths, `${guarded} must not bypass Clerk`).not.toContain(guarded);
    }
  });

  it("matches whole paths, not prefixes", () => {
    // `Set.has` is exact. A prefix match would make `/pricing-internal` or
    // `/es-drafts` public by accident, which is how allowlists leak.
    expect(middleware).toMatch(/CLERK_FREE_PATHS\.has\(/);
    expect(middleware).not.toMatch(/CLERK_FREE_PATHS.*\.some\(/);
    expect(middleware).not.toMatch(/startsWith.*CLERK_FREE/);
  });
});

describe("the middleware cannot silently swallow a failure", () => {
  it("wraps nothing in a permissive catch", () => {
    /**
     * A `try { ... } catch { return NextResponse.next() }` around
     * `clerkMiddleware` turns every configuration error — a superseded secret
     * key, a mismatched instance — into a request that proceeds without a
     * verified session. The 500 is loud and correct; the catch is quiet and
     * wrong.
     */
    expect(middleware).not.toMatch(
      /catch\s*(\([^)]*\))?\s*\{[^}]*NextResponse\.next/s,
    );
    expect(middleware).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
  });

  it("still delegates to clerkMiddleware for everything else", () => {
    expect(middleware).toMatch(/clerkMiddleware\(/);
    expect(middleware).toMatch(/return withClerk\(request, event\)/);
  });
});

describe("nothing touches a handshake token", () => {
  it("never reads, parses, logs or stores the handshake parameter", () => {
    /**
     * `__clerk_handshake` carries a signed token. Reading it into a log line
     * or a database column would put a credential somewhere with different
     * access controls, and it is the copy that outlives the incident.
     *
     * Clerk's middleware consumes it internally. Nothing of ours should name
     * it outside a comment.
     */
    const code = middleware
      .split("\n")
      .filter(
        (line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"),
      )
      .join("\n");

    expect(code).not.toContain("__clerk_handshake");
    expect(code).not.toMatch(/searchParams\.get\(\s*["']__clerk/);
  });

  it("logs nothing at all from the middleware", () => {
    // A `console.log(request.url)` here would write the handshake token into
    // Vercel's logs on every authenticated redirect.
    const code = middleware
      .split("\n")
      .filter(
        (line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"),
      )
      .join("\n");

    expect(code).not.toMatch(/console\.(log|info|debug|warn|error)/);
  });
});

describe("the middleware stays Edge-compatible", () => {
  it("imports nothing Node-only", () => {
    /**
     * Edge middleware has no filesystem, no sockets and no Node built-ins. An
     * import that reaches one throws at module scope, which surfaces as
     * `MIDDLEWARE_INVOCATION_FAILED` — the same symptom this incident
     * reported, from a completely different cause.
     *
     * Checked at the source level: a transitive import would need the built
     * bundle, and that is asserted separately during the build sweep.
     */
    const imports = [...middleware.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (m) => m[1]!,
    );

    expect(imports.length).toBeGreaterThan(0);

    for (const specifier of imports) {
      expect(specifier, `${specifier} is a Node built-in`).not.toMatch(
        /^node:/,
      );
      expect(specifier).not.toMatch(
        /^(fs|path|crypto|net|tls|child_process|os)$/,
      );
    }
  });

  it("never reaches the database", () => {
    // User synchronisation belongs in `services/users/provision.ts`, called
    // from a Server Component. Prisma in Edge middleware does not work, and a
    // database round trip on every request would not be acceptable if it did.
    expect(middleware).not.toMatch(
      /@\/lib\/prisma|PrismaClient|@prisma\/client/,
    );
    expect(middleware).not.toMatch(/services\/users|provisionUser/);
  });

  it("does not import the validated env module", () => {
    // `lib/env.ts` throws at module scope when a variable is missing. In
    // middleware that is an unconditional 500 on every route, including the
    // public ones, and the message never reaches the browser.
    expect(middleware).not.toMatch(/from\s+["']@\/lib\/env["']/);
  });
});

describe("post-authentication redirect handling", () => {
  const auth = source("lib/auth.ts");

  it("rejects an open redirect", () => {
    /**
     * `x-pathname` is set by the middleware from the incoming request, so it
     * is attacker-influenced. `//evil.com` is a protocol-relative URL: it
     * starts with `/`, and a naive check passes it straight to `redirect()`.
     */
    expect(auth).toMatch(/startsWith\("\/"\)/);
    expect(auth).toMatch(/!.*startsWith\("\/\/"\)/);
  });

  it("encodes the destination it carries into sign-in", () => {
    expect(auth).toMatch(/encodeURIComponent\(path\)/);
  });
});

describe("the homepage stays public and stays put", () => {
  it("is in the Clerk-free set", () => {
    expect(clerkFreePaths()).toContain("/");
  });

  it("does not bounce an authenticated visitor to the dashboard", () => {
    // The brand link in the dashboard and Studio points at `/`. A redirect
    // back to `/dashboard` for signed-in users would make that link appear
    // broken — and would defeat the fix shipped in Sprint 4.1.
    expect(middleware).not.toMatch(/redirect\([^)]*\/dashboard/);
    expect(source("app/(marketing)/page.tsx")).not.toMatch(
      /redirect\([^)]*\/dashboard/,
    );
  });

  it("keeps both locales public", () => {
    const paths = clerkFreePaths();
    expect(paths).toContain("/");
    expect(paths).toContain("/es");
  });
});
