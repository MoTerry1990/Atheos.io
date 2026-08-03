import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

import { env } from "@/lib/env";

/**
 * Cloudflare R2 — where generated media lives.
 *
 * ## Why R2 and not S3
 *
 * Egress. A platform whose product is generated video pays more to *deliver*
 * bytes than to store them: on S3 a single 50MB video viewed a thousand times
 * costs more in bandwidth than a month of storage. R2 charges zero for egress,
 * which removes the largest and least predictable line item in the hosting
 * bill, and it removes the perverse incentive to make the product stingier
 * about letting people watch their own work.
 *
 * ## Why the AWS SDK
 *
 * R2 is S3-compatible, so this is the standard client pointed at a different
 * endpoint. That also keeps the exit door open: switching to S3, B2 or MinIO
 * is an endpoint change, not a rewrite.
 *
 * ## One storage system, not two
 *
 * Sprint 0 planned a split: UploadThing for *inbound* browser uploads, R2 for
 * *outbound* generated media (§ 4). It never happened. When `/api/uploads` was
 * built in Sprint 7 it took multipart form data and wrote straight here, which
 * turned out to be the whole job — the plumbing UploadThing was meant to save
 * us is about thirty lines when the destination is already S3-compatible.
 *
 * So R2 holds both, `Asset.source` records which path a file came in through,
 * and Sprint 14 removed the unused dependency. See § 46 in `docs/DECISIONS.md`.
 */

function requireR2Config() {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
        "R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME — see .env.example.",
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucket };
}

let cached: S3Client | undefined;

/**
 * Lazily constructed so that importing this module during a build without R2
 * credentials does not throw. Storage is optional until the sprint that needs
 * it; the failure should happen at the call site, not at import time.
 */
export function r2Client(): S3Client {
  if (cached) return cached;

  const { accountId, accessKeyId, secretAccessKey } = requireR2Config();

  cached = new S3Client({
    // R2 has no regions, but the SDK insists on one.
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return cached;
}

export function r2Bucket(): string {
  return requireR2Config().bucket;
}

/**
 * Resolve a stored object key to a public URL.
 *
 * Asset rows store **keys**, never absolute URLs. The hostname in front of the
 * bucket is an operational detail — swapping r2.dev for a custom domain, or
 * putting a different CDN in front — and baking it into the database turns that
 * into a data migration.
 */
export function r2PublicUrl(key: string): string {
  const base = env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_R2_PUBLIC_URL is not set — cannot build a public asset URL.",
    );
  }
  return `${base.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}
