import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The private master store, checked without a bucket.
 *
 * ## What is actually at risk
 *
 * A provider master is the 44 MB original with its content credentials intact.
 * Two things must never happen to it: reaching the public bucket, and reaching
 * a browser. Both are configuration mistakes rather than logic ones, so most
 * of what follows reads the source and the environment schema rather than
 * calling anything — there is nothing to call, and that is the point.
 *
 * No network. No credentials. Nothing here can write to R2 even if a token
 * were present, because every case exercises the unconfigured path.
 */

const ROOT = resolve(import.meta.dirname, "..", "..");
const source = readFileSync(
  resolve(ROOT, "services/storage/masters.ts"),
  "utf8",
);
const envSource = readFileSync(resolve(ROOT, "lib/env.ts"), "utf8");

/**
 * The source with its comments removed.
 *
 * Every "must not appear" assertion below has to read this rather than the raw
 * file, because the module's own documentation names the things it refuses to
 * touch — `NEXT_PUBLIC_`, the public bucket, `ACL`, `ETag` — in order to
 * explain why they are absent. Matching the prose would fail a correct file
 * and, worse, could be "fixed" by deleting the explanation.
 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const PRIVATE_VARS = [
  "R2_PRIVATE_BUCKET_NAME",
  "R2_PRIVATE_ACCESS_KEY_ID",
  "R2_PRIVATE_SECRET_ACCESS_KEY",
];

const original = { ...process.env };

afterEach(() => {
  for (const name of PRIVATE_VARS) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
  vi.resetModules();
});

async function load(configured: boolean) {
  vi.resetModules();
  if (configured) {
    // The account id is shared with the public bucket and is already
    // server-only, so the store needs it too.
    process.env.R2_ACCOUNT_ID ??= "test-placeholder-account";
    process.env.R2_PRIVATE_BUCKET_NAME = "atheos-private-masters-prod";
    process.env.R2_PRIVATE_ACCESS_KEY_ID = "test-placeholder-not-a-key";
    process.env.R2_PRIVATE_SECRET_ACCESS_KEY = "test-placeholder-not-a-secret";
  } else {
    for (const name of PRIVATE_VARS) delete process.env[name];
  }
  return import("@/services/storage/masters");
}

describe("it is private by construction, not by convention", () => {
  it("declares no NEXT_PUBLIC variable for the private bucket", () => {
    /**
     * The single most damaging possible mistake here. A `NEXT_PUBLIC_` prefix
     * inlines the value into the client bundle at build time, so a private
     * bucket named that way is private for exactly one deploy.
     */
    for (const name of PRIVATE_VARS) {
      expect(envSource, name).toContain(name);
      expect(envSource, name).not.toContain(`NEXT_PUBLIC_${name}`);
    }
    expect(code).not.toMatch(/NEXT_PUBLIC_/);
  });

  it("is server-only, so a client import is a build error", () => {
    expect(source.startsWith('import "server-only";')).toBe(true);
  });

  it("never reaches for the public bucket or its URL", () => {
    /**
     * A master written to the public bucket is the accident this module
     * exists to prevent, and a fallback is how it would happen: the private
     * credentials are missing, something helpfully uses the ones that work,
     * and a 44 MB original is suddenly on a CDN.
     */
    expect(code).not.toContain("R2_BUCKET_NAME");
    expect(code).not.toContain("R2_PUBLIC_URL");
    expect(code).toContain("R2_PRIVATE_BUCKET_NAME");
  });

  it("grants no public read on upload", () => {
    // R2 objects are private unless the bucket carries a public binding. The
    // absence of an ACL is the control, so its absence is asserted.
    expect(code).not.toMatch(/ACL:/);
    expect(code).not.toMatch(/public-read/);
  });

  it("never mints a signed or public URL", () => {
    // Nothing may hand out a link to a master, signed or otherwise.
    expect(code).not.toMatch(/getSignedUrl|presign/i);
  });
});

describe("with no credentials it refuses rather than improvises", () => {
  it("reports a typed unconfigured state", async () => {
    const store = await load(false);
    const state = store.masterStoreState();

    expect(state.configured).toBe(false);
    expect(state).toMatchObject({ reason: "private_storage_not_configured" });
  });

  it("refuses to store", async () => {
    const store = await load(false);
    await expect(
      store.storeMaster(Buffer.from("not a real master"), "mp4"),
    ).rejects.toThrow(/not configured/i);
  });

  it("refuses to verify", async () => {
    const store = await load(false);
    await expect(
      store.verifyMaster(
        "masters/sha256/" + "a".repeat(64) + ".mp4",
        "a".repeat(64),
      ),
    ).rejects.toThrow(/not configured/i);
  });

  it("reports configured once every variable is present", async () => {
    const store = await load(true);
    expect(store.masterStoreState().configured).toBe(true);
  });
});

describe("the key is the hash", () => {
  it("addresses a master by its own SHA-256", async () => {
    const store = await load(false);
    const hash =
      "69d021198d72596bd2319a37ca752cb84c223f36636327bf6cbbfff6a76dfa48";

    expect(store.masterKey(hash, "mp4")).toBe(`masters/sha256/${hash}.mp4`);
    expect(store.masterKey(hash, ".MP4")).toBe(`masters/sha256/${hash}.mp4`);
  });

  it("refuses anything that is not a hash", async () => {
    /**
     * The key is built from caller input, so a path separator or a `..` in it
     * would be a way to write outside the prefix. A strict hex check is
     * simpler and stronger than escaping.
     */
    const store = await load(false);

    for (const bad of [
      "../../etc/passwd",
      "not-a-hash",
      "ABCDEF",
      "69d0211".padEnd(63, "a"),
      "z".repeat(64),
    ]) {
      expect(() => store.masterKey(bad, "mp4"), bad).toThrow();
    }
  });

  it("refuses a hostile extension", async () => {
    const store = await load(false);
    const hash = "a".repeat(64);

    for (const bad of ["../x", "mp4/../..", "", "toolongextension"]) {
      expect(() => store.masterKey(hash, bad), bad).toThrow();
    }
  });

  it("computes the hash rather than trusting one it is handed", async () => {
    // `storeMaster` takes bytes and an extension — never a hash — so a key
    // cannot claim contents it does not have.
    expect(source).toMatch(
      /export async function storeMaster\(\s*bytes: Buffer,\s*extension: string,/,
    );
  });
});

describe("verification reads the bytes back", () => {
  it("hashes the downloaded body rather than comparing an ETag", () => {
    /**
     * R2's ETag is an MD5 for a single-part upload and a hash-of-hashes for a
     * multipart one. Comparing it to a SHA-256 would be comparing two
     * different questions and calling them the same answer.
     */
    expect(code).toContain("GetObjectCommand");
    expect(code).not.toMatch(/ETag/);
    expect(source).toMatch(/for await \(const chunk of body\)/);
  });
});
