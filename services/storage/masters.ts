import "server-only";

import { createHash } from "node:crypto";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { env } from "@/lib/env";

/**
 * Provider masters, kept privately and addressed by their own hash.
 *
 * ## Why a second bucket rather than a prefix in the first
 *
 * The public bucket is fronted by `NEXT_PUBLIC_R2_PUBLIC_URL`. Everything in
 * it is reachable by anyone who learns the key, which is correct for a
 * customer's finished asset and wrong for a master: the 44 MB original of the
 * home page hero still carries its C2PA manifest and SynthID metadata, and it
 * is evidence rather than content. A prefix in a public bucket is a naming
 * convention, not a boundary — one misconfigured rule and it is served.
 *
 * Separate credentials too. The token that serves the website cannot read or
 * write masters, and the token that writes masters cannot touch anything a
 * visitor sees.
 *
 * ## Content-addressed, deliberately
 *
 * The object key **is** the SHA-256 of the bytes. That makes the store
 * idempotent — uploading the same master twice writes the same object — and it
 * makes verification total: a file that hashes to its own key cannot have been
 * silently replaced or corrupted, and `docs/MEDIA-PROVENANCE.md` can name a
 * derivative's origin by a value anybody can recompute.
 *
 * ## Verified by reading it back, not by trusting the ETag
 *
 * R2's ETag is an MD5 for single-part uploads and something else entirely for
 * multipart, so it answers a different question from the one that matters.
 * `verifyMaster` downloads the whole object through an authenticated client
 * and hashes the bytes that actually came back.
 *
 * ## Fail closed
 *
 * Absent credentials are not an error to work around. Every function here
 * refuses with a typed state, and nothing falls back to the public bucket —
 * a master written to the wrong bucket is the exact accident this module
 * exists to prevent.
 */

export type MasterStoreState =
  | { configured: true }
  | { configured: false; reason: "private_storage_not_configured" };

/** Whether a private master store is available at all. */
export function masterStoreState(): MasterStoreState {
  const ready =
    Boolean(env.R2_ACCOUNT_ID) &&
    Boolean(env.R2_PRIVATE_BUCKET_NAME) &&
    Boolean(env.R2_PRIVATE_ACCESS_KEY_ID) &&
    Boolean(env.R2_PRIVATE_SECRET_ACCESS_KEY);

  return ready
    ? { configured: true }
    : { configured: false, reason: "private_storage_not_configured" };
}

class MasterStoreUnavailable extends Error {
  readonly code = "private_storage_not_configured";
  constructor() {
    super("The private master store is not configured.");
    this.name = "MasterStoreUnavailable";
  }
}

/**
 * A client scoped to the private bucket.
 *
 * Built per call rather than module-level so that adding the credentials to a
 * running deployment takes effect without a rebuild, and so importing this
 * module never constructs anything when the store is unconfigured.
 */
function client(): S3Client {
  if (!masterStoreState().configured) throw new MasterStoreUnavailable();

  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_PRIVATE_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_PRIVATE_SECRET_ACCESS_KEY!,
    },
  });
}

/** The key a master lives at. The hash is the address. */
export function masterKey(sha256: string, extension: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("A master key needs a lowercase hex SHA-256.");
  }
  const ext = extension.replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9]{2,5}$/.test(ext)) {
    throw new Error("A master key needs a simple file extension.");
  }
  return `masters/sha256/${sha256}.${ext}`;
}

export function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface StoredMaster {
  key: string;
  sha256: string;
  bytes: number;
  /** True when the object was already there with the same key. */
  alreadyPresent: boolean;
}

/**
 * Put a master in the private bucket, addressed by its own hash.
 *
 * The caller passes the bytes it intends to preserve; the hash is computed
 * here rather than accepted, so a mismatched pair cannot be stored under a key
 * that lies about its contents.
 */
export async function storeMaster(
  bytes: Buffer,
  extension: string,
): Promise<StoredMaster> {
  const sha256 = sha256Of(bytes);
  const key = masterKey(sha256, extension);
  const s3 = client();
  const Bucket = env.R2_PRIVATE_BUCKET_NAME!;

  // Content-addressed, so a re-upload of identical bytes is a no-op worth
  // skipping — 44 MB is not free to send twice.
  try {
    await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    return { key, sha256, bytes: bytes.byteLength, alreadyPresent: true };
  } catch {
    // Not there. Fall through and write it.
  }

  await s3.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body: bytes,
      ContentType:
        extension === "mp4" ? "video/mp4" : "application/octet-stream",
      /**
       * No ACL, and no public-read of any kind. R2 buckets are private unless
       * a public binding is attached, and this one must never have one — the
       * absence is the control, so it is stated rather than assumed.
       */
      Metadata: { "atheos-role": "provider-master" },
    }),
  );

  return { key, sha256, bytes: bytes.byteLength, alreadyPresent: false };
}

export interface MasterVerification {
  key: string;
  expected: string;
  actual: string;
  matches: boolean;
  bytes: number;
}

/**
 * Read the object back and hash what arrives.
 *
 * Deliberately a full authenticated download rather than a `HeadObject`: an
 * ETag is an MD5 for a single-part upload and a hash-of-hashes for a
 * multipart one, so comparing it to a SHA-256 would be comparing two different
 * questions and calling them the same answer.
 */
export async function verifyMaster(
  key: string,
  expectedSha256: string,
): Promise<MasterVerification> {
  const s3 = client();
  const result = await s3.send(
    new GetObjectCommand({ Bucket: env.R2_PRIVATE_BUCKET_NAME!, Key: key }),
  );

  const body = result.Body as AsyncIterable<Uint8Array> | undefined;
  if (!body) throw new Error(`No body returned for ${key}.`);

  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of body) {
    hash.update(chunk);
    bytes += chunk.byteLength;
  }

  const actual = hash.digest("hex");
  return {
    key,
    expected: expectedSha256,
    actual,
    matches: actual === expectedSha256,
    bytes,
  };
}
