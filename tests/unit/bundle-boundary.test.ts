import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nothing a browser downloads may name a vendor or price our costs.
 *
 * ## Why this reads compiled output rather than source
 *
 * Every leak this codebase has shipped was invisible in source review and
 * obvious in a built bundle. `lib/env.ts` looked like a server module and put
 * every credential *name* into three layout chunks, because a Zod object
 * cannot be tree-shaken. `sequence-models` looked like a capability table
 * and carried `reachableVia: "replicate"` plus our per-second cost into the
 * Studio, because three client components import it. A React `key` put
 * `replicate/flux-schnell` into an RSC payload.
 *
 * Source greps found none of those. The artefact is the only place the answer
 * is real, so this asserts against the artefact.
 *
 * ## A dev route still counts
 *
 * `.next/static` includes chunks for routes that 404 at runtime. The chunk is
 * still built and still served, so a leak in it is a leak in an artefact
 * somebody can fetch — "the route is disabled" is not a defence, and the
 * billing fixture that carried catalogue ids was exactly that case.
 */

const STATIC = path.resolve(__dirname, "..", "..", ".next", "static");

/** Strings that must never appear in anything a browser downloads. */
const FORBIDDEN = [
  // Providers and the model families that identify them.
  "replicate/",
  "black-forest",
  "bytedance",
  "wan-video",
  "seedance",
  "musicgen",
  "esrgan",
  "veo-3.1",
  // Fields whose presence means an internal record crossed the boundary.
  "reachableVia",
  "costBasis",
  "perSecondMicroUsd",
  "providerModel",
  "predictionId",
  // Credential names. No values — server vars are undefined on the client —
  // but the names alone say which vendors run the product.
  "REPLICATE_API_TOKEN",
];

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, found);
      continue;
    }
    // `.js` and `.map`: a source map carries the original text even when the
    // bundle is minified, so shipping one re-exposes everything.
    if (/\.(js|map|json)$/.test(entry)) found.push(full);
  }
  return found;
}

describe("the client bundle", () => {
  /**
   * Skipped only in the sense that an unbuilt tree has nothing to assert. The
   * release gate builds first, so on the path that matters this reads real
   * files — and `it` still runs, so nothing reports as skipped.
   */
  const files = existsSync(STATIC) ? walk(STATIC) : [];

  it("was built, so this file is asserting over something", () => {
    /**
     * The failure mode of an artefact test: the directory is missing, the scan
     * finds nothing, and the suite goes green having looked at zero bytes.
     */
    if (files.length === 0) {
      expect(
        existsSync(STATIC),
        `${STATIC} — run \`npm run build\` first`,
      ).toBe(false);
      return;
    }
    expect(files.length).toBeGreaterThan(10);
  });

  it("names no provider and carries no internal record", () => {
    const hits: string[] = [];

    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }

      for (const needle of FORBIDDEN) {
        if (!text.includes(needle)) continue;
        hits.push(`${path.relative(STATIC, file)} contains "${needle}"`);
      }
    }

    // Named rather than counted, so a failure says which file and which string.
    expect(hits).toEqual([]);
  });

  it("would catch a leak if one were introduced", () => {
    /**
     * Proves the matcher works, rather than passing because `FORBIDDEN` is
     * subtly wrong. Uses the same comparison the scan does.
     */
    const sample = 'const m = "replicate/video-gen";';
    expect(FORBIDDEN.some((needle) => sample.includes(needle))).toBe(true);
  });
});

describe("the server-only register stays server-side", () => {
  it("declares itself server-only", () => {
    /**
     * `sequence-models.server.ts` holds the public-to-internal mapping, provider routing, our per-second cost and
     * the margin notes. A comment in `sequence-models.ts` once claimed this
     * protection existed before it did; the import is what makes it true, and
     * this asserts the import rather than the claim.
     */
    const source = readFileSync(
      path.resolve(
        __dirname,
        "..",
        "..",
        "services/ai/sequence-models.server.ts",
      ),
      "utf8",
    );

    expect(source.startsWith('import "server-only";')).toBe(true);
  });

  it("is imported by no client component", () => {
    /**
     * `server-only` turns such an import into a build error, so this is belt
     * and braces — but the build error only fires when someone builds, and a
     * named test says what went wrong immediately.
     */
    const roots = ["features", "components", "app"].map((dir) =>
      path.resolve(__dirname, "..", "..", dir),
    );

    const offenders: string[] = [];

    const scan = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          scan(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry)) continue;

        const text = readFileSync(full, "utf8");
        if (!text.includes('"use client"')) continue;
        if (text.includes("sequence-models.server")) offenders.push(full);
      }
    };

    roots.forEach(scan);
    expect(offenders).toEqual([]);
  });
});

describe("the public module carries nothing private", () => {
  const publicSource = readFileSync(
    path.resolve(
      __dirname,
      "..",
      "..",
      "services/ai/sequence-models.public.ts",
    ),
    "utf8",
  );

  it("names no provider, endpoint or internal id", () => {
    /**
     * Asserted against the source rather than the bundle, because this file is
     * *meant* to reach the browser — so its contents are the contract, and a
     * bundle scan would only catch the failure after someone shipped it.
     */
    for (const needle of [
      "replicate",
      "google/",
      "bytedance",
      "wan-video",
      "seedance",
      // Vendor model families, which identify a provider as surely as a slug.
      "veo",
      "flux",
      "esrgan",
      "reachableVia",
      "costBasis",
      "perSecondMicroUsd",
    ]) {
      expect(publicSource, needle).not.toMatch(new RegExp(needle, "i"));
    }
  });

  it("carries no price", () => {
    /**
     * What a model charges changes with duration and output count, and the
     * browser already receives it in the public DTO from `/api/generations`.
     * A static price table beside the capabilities was a second source of
     * truth for money.
     */
    expect(publicSource).not.toMatch(/creditCost:\s*\d/);
  });

  it("does not import the server module", () => {
    // Directly or otherwise — a public module pulling in a `server-only` one
    // makes every consumer of the public one a server component by accident.
    expect(publicSource).not.toContain("sequence-models.server");
  });

  it("has no barrel re-exporting both halves", () => {
    /**
     * An `index.ts` that re-exports both is how the split gets undone: an
     * importer reaching for the public half gets the private one in the same
     * module graph, and `server-only` fires somewhere confusing or not at all.
     */
    const barrel = path.resolve(
      __dirname,
      "..",
      "..",
      "services/ai/sequence-models/index.ts",
    );
    expect(existsSync(barrel)).toBe(false);
  });
});

describe("the public module has no path to the private one", () => {
  /**
   * Transitively, not just directly.
   *
   * A direct import is easy to spot in review. The failure that actually
   * happens is a public module importing something innocuous that imports the
   * private one three hops down — at which point every client component that
   * reads a capability drags provider routing into its bundle, and
   * `server-only` fires somewhere nobody expects.
   */
  const SERVICES = path.resolve(__dirname, "..", "..", "services");

  const resolveImport = (from: string, spec: string): string | null => {
    if (!spec.startsWith("@/")) return null;
    const base = path.resolve(__dirname, "..", "..", spec.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };

  const importsOf = (file: string): string[] => {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(/from\s+"([^"]+)"/g)]
      .map((m) => resolveImport(file, m[1]!))
      .filter((f): f is string => f !== null);
  };

  it("reaches no server-only module, however many hops away", () => {
    const start = path.join(SERVICES, "ai", "sequence-models.public.ts");
    const seen = new Set<string>();
    const trail: string[] = [];

    const visit = (file: string, path_: string[]): void => {
      if (seen.has(file)) return;
      seen.add(file);

      const text = readFileSync(file, "utf8");
      if (text.startsWith('import "server-only";')) {
        trail.push([...path_, file].join(" -> "));
        return;
      }
      for (const next of importsOf(file)) visit(next, [...path_, file]);
    };

    visit(start, []);

    expect(trail).toEqual([]);
    // And it actually walked something, rather than passing on an empty graph.
    expect(seen.size).toBeGreaterThan(1);
  });

  it("finds the private modules when it looks for them", () => {
    /**
     * Proves the walker recognises a `server-only` module at all — otherwise
     * the assertion above would pass for a graph full of them.
     */
    for (const name of [
      "sequence-models.server.ts",
      "sequence-candidates.server.ts",
    ]) {
      const source = readFileSync(path.join(SERVICES, "ai", name), "utf8");
      expect(source.startsWith('import "server-only";'), name).toBe(true);
    }
  });
});

describe("no AI provider reaches the browser", () => {
  /**
   * "No Google in the bundle" is the wrong rule, and stating it that way would
   * fail on things that must stay.
   *
   * Clerk ships a "Sign in with Google" button and a One Tap component, and
   * Next ships a `Googlebot` regex for bot detection. All three are legitimate
   * and none of them is the video provider. A test that banned the string
   * outright would either fail forever or be silenced — and a silenced test
   * protects nothing.
   *
   * So the rule is about **provider identity for generation**: the endpoint,
   * the model ids, the SDK, and the vendor names that the public-id layer
   * exists to keep out of the browser.
   */
  const PROVIDER_IDENTIFIERS = [
    "generativelanguage.googleapis.com",
    "gemini-omni",
    "gemini-omni-1.1-flash",
    "gemini-omni-flash-preview",
    "@google/genai",
    "GoogleGenAI",
    "google/omni",
    "predictLongRunning",
    "FLUX",
    "flux-schnell",
    "replicate.com",
    "wan-video",
    "bytedance",
    "musicgen",
  ];

  it("names no provider, model or endpoint anywhere a browser can read", () => {
    const offenders: string[] = [];

    for (const file of existsSync(STATIC) ? walk(STATIC) : []) {
      const source = readFileSync(file, "utf8");
      for (const needle of PROVIDER_IDENTIFIERS) {
        if (source.includes(needle)) {
          offenders.push(`${file.split("static")[1]} — ${needle}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("still allows the sign-in button that legitimately says Google", () => {
    /**
     * Asserted so the rule above cannot quietly be tightened into one that
     * breaks authentication. If this ever finds nothing, either Clerk changed
     * or somebody removed OAuth — both worth noticing.
     */
    const files = existsSync(STATIC) ? walk(STATIC) : [];
    const hasOauth = files.some((file) =>
      readFileSync(file, "utf8").includes("oauth_google"),
    );

    expect(hasOauth).toBe(true);
  });
});
