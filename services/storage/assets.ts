import "server-only";

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

/** Smaller than the generated-output ceiling: inbound bytes are paid for by us
 *  and there is no reason to accept a 50MB reference image.
 *
 *  Exported because the route enforces it *before* reading the body — see the
 *  note there. The check below remains as the backstop for any other caller. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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

export const UPLOAD_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/**
 * Identify an image by its leading bytes.
 *
 * ## Why the declared type is not enough
 *
 * `file.type` in a multipart upload is whatever the client wrote. An allowlist
 * checked against it is an allowlist checked against attacker input: rename
 * anything to `.png`, claim `image/png`, and it passes.
 *
 * Magic numbers are not a complete defence — a polyglot file can satisfy a
 * signature check and still be something else — but they close the trivial
 * case, and combined with the allowlist they mean a stored object's extension
 * and content agree. That matters because these objects are served from a
 * public bucket: a file that is really HTML, served with a sniffable type,
 * would be stored XSS on our storage origin.
 *
 * Returns null when nothing matches, which the caller treats as a rejection.
 * Deliberately narrow — it recognises only the three types we accept.
 */
export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // WebP: "RIFF" .... "WEBP" — the size field sits between the two markers.
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Store a file the user uploaded.
 *
 * Separate from `storeGeneratedAsset` because the trust model is different.
 * Generated output comes from a provider we chose; this comes from whoever is
 * signed in, so the MIME type is not taken from the request — it is checked
 * against a list, and anything else is refused before a byte reaches the
 * bucket. A public bucket that will store whatever it is handed is a file host
 * for someone else's malware.
 *
 * The key prefix is `uploads/` rather than `generations/` so the two can be
 * listed, priced and expired independently. Uploads are input; a user who
 * deletes a generation does not expect their source image to vanish with it.
 */
export async function storeUploadedAsset(options: {
  userId: string;
  bytes: Buffer;
  mimeType: string;
}): Promise<StoredAsset> {
  if (!UPLOAD_MIME_TYPES.has(options.mimeType)) {
    throw new Error(`Unsupported upload type: ${options.mimeType}`);
  }
  if (options.bytes.byteLength === 0) {
    throw new Error("The uploaded file was empty");
  }
  if (options.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("The uploaded file was too large");
  }

  const storageKey = `users/${options.userId}/uploads/${randomUUID()}.${extensionFor(options.mimeType)}`;

  await r2Client().send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: storageKey,
      Body: options.bytes,
      ContentType: options.mimeType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return {
    storageKey,
    url: r2PublicUrl(storageKey),
    mimeType: options.mimeType,
    sizeBytes: options.bytes.byteLength,
    checksum: createHash("sha256").update(options.bytes).digest("hex"),
  };
}

/**
 * A short-lived URL that downloads an object as a file.
 *
 * ## Why not just link to the public URL
 *
 * Two reasons, and the second is the expensive one.
 *
 * The `download` attribute on an anchor is **ignored cross-origin**, so a link
 * to the CDN navigates to the file instead of saving it — a video plays in the
 * tab, an image replaces the app. Fetching it as a blob would fix the naming
 * but requires CORS on the bucket, and a 50MB video would be pulled into the
 * page's memory to be handed straight back to the disk.
 *
 * A presigned GET with `ResponseContentDisposition` makes R2 itself send the
 * attachment header. The browser saves the file with the name we chose, and
 * the bytes never pass through our server — which is the whole reason for
 * picking a zero-egress bucket in the first place.
 *
 * Fifteen minutes: long enough to survive a slow start, short enough that a URL
 * copied out of the network tab stops working before it is worth sharing.
 */
export async function presignedDownloadUrl(
  storageKey: string,
  filename: string,
): Promise<string> {
  return getSignedUrl(
    r2Client(),
    new GetObjectCommand({
      Bucket: r2Bucket(),
      Key: storageKey,
      // Quoted and escaped: an unquoted filename containing a space truncates
      // the header, and a quote in it would let the caller inject one.
      ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\]/g, "")}"`,
    }),
    { expiresIn: 900 },
  );
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
