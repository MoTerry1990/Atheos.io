/**
 * Put a provider master into the private bucket and prove it arrived intact.
 *
 * One-off, run by hand, with the production credentials injected rather than
 * written anywhere:
 *
 *   npx vercel env run -e production -- npx tsx scripts/preserve-master.ts \
 *     media-source/hero-coastal-drive.master.mp4 <expected-sha256> <expected-bytes>
 *
 * ## Why a script and not a route or a migration
 *
 * Preserving a master happens once per master, by a person who has the file on
 * disk. A route would mean uploading 44 MB through the app to reach storage the
 * app never reads from; a migration would re-run it on every deployment of the
 * codebase. Neither is the shape of "keep this original safely".
 *
 * ## Why the expected hash is an argument
 *
 * The point of the exercise is that the bytes going in are the bytes recorded
 * in `docs/MEDIA-PROVENANCE.md`. If the script computed the expectation from
 * the file it was handed, it would confirm only that a file hashes to its own
 * hash. The caller states what it must be; the script refuses if it is not.
 *
 * ## What "verified" means here
 *
 * Not an ETag comparison — that is an MD5 for a single-part upload and a
 * hash-of-hashes for a multipart one, so it answers a different question.
 * `verifyMaster` downloads the whole object through an authenticated client and
 * hashes what actually came back. This script additionally checks the negative:
 * that the same object is *not* retrievable without credentials, and not
 * reachable through the public CDN that fronts the other bucket.
 *
 * Nothing here prints a credential, a bucket name, an account id or a URL that
 * contains one. It prints hashes, byte counts and HTTP status codes.
 */

import { readFileSync, statSync } from "node:fs";

import {
  masterKey,
  masterStoreState,
  sha256Of,
  storeMaster,
  verifyMaster,
} from "@/services/storage/masters";

const HEX64 = /^[0-9a-f]{64}$/;

let failed = false;

function step(name: string, ok: boolean, detail: string): void {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(34)} ${detail}`);
}

/**
 * A request made deliberately without credentials.
 *
 * A network error counts as a refusal too: if the host will not talk to an
 * anonymous client at all, the object is not anonymously retrievable, which is
 * the property being tested.
 */
async function statusWithoutCredentials(url: string): Promise<string> {
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual" });
    return String(response.status);
  } catch {
    return "network refused";
  }
}

async function main(): Promise<void> {
  const [path, expectedSha256, expectedBytesArg] = process.argv.slice(2);

  if (!path || !expectedSha256 || !expectedBytesArg) {
    console.error(
      "usage: preserve-master.ts <file> <expected-sha256> <expected-bytes>",
    );
    process.exit(2);
  }
  if (!HEX64.test(expectedSha256)) {
    console.error("The expected SHA-256 must be lowercase hex, 64 characters.");
    process.exit(2);
  }

  const expectedBytes = Number(expectedBytesArg);
  const state = masterStoreState();

  step(
    "private store configured",
    state.configured,
    state.configured ? "credentials present" : state.reason,
  );
  if (!state.configured) process.exit(1);

  // ---- 1. size ----------------------------------------------------------
  const size = statSync(path).size;
  step(
    "local size",
    size === expectedBytes,
    `${size.toLocaleString("en-US")} bytes (expected ${expectedBytes.toLocaleString("en-US")})`,
  );

  // ---- 2. hash ----------------------------------------------------------
  const bytes = readFileSync(path);
  const localSha = sha256Of(bytes);
  step("local sha-256", localSha === expectedSha256, localSha);
  if (failed) process.exit(1);

  // ---- 3. upload --------------------------------------------------------
  const stored = await storeMaster(bytes, "mp4");
  step(
    "upload",
    stored.sha256 === expectedSha256,
    stored.alreadyPresent
      ? `already present at ${stored.key}`
      : `written to ${stored.key}`,
  );

  // ---- 4 & 5. authenticated read-back, re-hashed -------------------------
  const verification = await verifyMaster(
    masterKey(expectedSha256, "mp4"),
    expectedSha256,
  );
  step(
    "authenticated download",
    verification.bytes === expectedBytes,
    `${verification.bytes.toLocaleString("en-US")} bytes read back`,
  );
  step("remote sha-256", verification.matches, verification.actual);

  // ---- 6. the negative --------------------------------------------------
  const key = masterKey(expectedSha256, "mp4");
  const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_PRIVATE_BUCKET_NAME}/${key}`;
  const anonymous = await statusWithoutCredentials(endpoint);
  step(
    "anonymous S3 GET refused",
    anonymous !== "200",
    `HTTP ${anonymous} (a 2xx here would be a public bucket)`,
  );

  const publicBase = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (publicBase) {
    const viaCdn = await statusWithoutCredentials(
      `${publicBase.replace(/\/$/, "")}/${key}`,
    );
    step(
      "not served by the public CDN",
      viaCdn !== "200",
      `HTTP ${viaCdn} on the public bucket's domain`,
    );
  }

  console.log(
    failed
      ? "\nThe master is NOT preserved. Do not record it as preserved."
      : "\nMaster preserved and verified by authenticated read-back.",
  );

  /**
   * Set the code and let the loop drain rather than calling `process.exit`.
   * Tearing down mid-flight while the S3 client still holds keep-alive sockets
   * makes libuv abort on Windows, which prints a crash at the end of a run that
   * actually succeeded — the worst possible ending for a script whose whole job
   * is to say truthfully whether something worked.
   */
  process.exitCode = failed ? 1 : 0;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
