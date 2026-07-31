import "server-only";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash, randomUUID } from "node:crypto";

import { r2Bucket, r2Client, r2PublicUrl } from "@/lib/r2";
import { env } from "@/lib/env";

/**
 * Moving generated output into our own storage.
 *
 * ## Why this is not optional
 *
 * Providers serve results from URLs that expire — Replicate's within an hour.
 * Storing a vendor URL and calling it an asset produces a library full of dead
 * links within a day, which is the single most damaging bug this product could
 * ship: the user's work appears to exist and then does not.
 *
 * So every output is copied into R2 before the job is marked succeeded. That
 * copy is the point at which a generation becomes something the user owns.
 *
 * ## Both URL shapes
 *
 * Replicate returns `https://…`; OpenAI returns base64, which its adapter emits
 * as a `data:` URL. Handling both here means neither adapter needs its own
 * storage path.
 */

/** Guard against a provider handing back something implausible. */
const MAX_BYTES = 50 * 1024 * 1024;

export interface StoredAsset {
  storageKey: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("svg")) return "svg";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "bin";
}

async function readSource(
  sourceUrl: string,
  declaredMime: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  if (sourceUrl.startsWith("data:")) {
    // [\s\S] rather than the `s` (dotAll) flag: the payload can contain
    // newlines, and this works regardless of the compile target.
    const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(sourceUrl);
    if (!match) throw new Error("Malformed data URL from provider");

    const [, mimeType, isBase64, payload] = match;
    const bytes = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");

    return { bytes, mimeType: mimeType || declaredMime };
  }

  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `Could not fetch provider output (${response.status} ${response.statusText})`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    bytes,
    mimeType: response.headers.get("content-type") ?? declaredMime,
  };
}

/**
 * Copy one provider output into R2.
 *
 * The key is `users/{userId}/generations/{generationId}/{uuid}.{ext}` — user
 * first, so a per-user prefix can be listed, exported or deleted without a
 * database query, which is what a GDPR erasure request actually needs.
 */
export async function storeGeneratedAsset(options: {
  userId: string;
  generationId: string;
  sourceUrl: string;
  mimeType: string;
}): Promise<StoredAsset> {
  const { bytes, mimeType } = await readSource(
    options.sourceUrl,
    options.mimeType,
  );

  if (bytes.byteLength === 0) {
    throw new Error("Provider returned an empty file");
  }
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error("Provider output exceeded the maximum asset size");
  }

  const storageKey = `users/${options.userId}/generations/${options.generationId}/${randomUUID()}.${extensionFor(mimeType)}`;

  await r2Client().send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: storageKey,
      Body: bytes,
      ContentType: mimeType,
      // Immutable by construction: a key is never rewritten, so a long cache is
      // safe and every subsequent view is served from the edge.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return {
    storageKey,
    url: r2PublicUrl(storageKey),
    mimeType,
    sizeBytes: bytes.byteLength,
    // Content hash, for deduplication and integrity checks later.
    checksum: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * Whether object storage is usable.
 *
 * Checked before submitting rather than after generating. Discovering that
 * storage is misconfigured *after* spending the user's credits and burning
 * provider time is the expensive order to find out.
 */
export function isStorageConfigured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET_NAME &&
    env.NEXT_PUBLIC_R2_PUBLIC_URL,
  );
}
