/**
 * Confirm the preserved private objects still exist — metadata only.
 *
 *   npx vercel env run -e production -- npx tsx scripts/verify-private-objects.ts
 *
 * `HeadObject`, never `GetObject`. The hero master is 44 MB and downloading it
 * to prove it exists is a waste of bandwidth and time; the point of the check is
 * presence, size and identity, all of which are in the metadata.
 *
 * Prints the key, status, size, ETag and last-modified date. It never prints a
 * URL, a credential or a signed link.
 */
import "server-only";

import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "@/lib/env";
import { masterKey, masterStoreState } from "@/services/storage/masters";

const KEYS = [
  masterKey(
    "69d021198d72596bd2319a37ca752cb84c223f36636327bf6cbbfff6a76dfa48",
    "mp4",
  ),
];

async function main(): Promise<void> {
  const state = masterStoreState();
  if (!state.configured) {
    console.error(`private store: ${state.reason}`);
    process.exit(1);
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_PRIVATE_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_PRIVATE_SECRET_ACCESS_KEY!,
    },
  });

  for (const Key of KEYS) {
    try {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: env.R2_PRIVATE_BUCKET_NAME!, Key }),
      );
      console.log(`  key           ${Key}`);
      console.log(`  status        200 OK`);
      console.log(`  size          ${head.ContentLength} bytes`);
      console.log(`  etag          ${head.ETag}`);
      console.log(`  lastModified  ${head.LastModified?.toISOString()}`);
    } catch (error) {
      console.log(`  key           ${Key}`);
      console.log(
        `  status        FAILED ${error instanceof Error ? error.message : error}`,
      );
      process.exitCode = 1;
    }
  }
}

void main();
