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

/**
 * What is structurally wrong with the R2 configuration, if anything.
 *
 * ## Why this exists
 *
 * For three sprints, production could not store a single generated image.
 * `R2_ACCESS_KEY_ID` in Vercel held a 55-character non-hex value and
 * `R2_SECRET_ACCESS_KEY` held a 32-hex value with a trailing newline — neither
 * is a credential of the right shape, and both were plainly wrong on sight.
 *
 * Nothing looked. The only check was `isStorageConfigured()`, which asked
 * whether the variables were *present*. They were present, so `/api/health`
 * reported storage healthy while every upload was rejected, and the failure
 * surfaced only as `400 InvalidArgument` from R2 — a status that says nothing
 * about which of five variables is malformed. Diagnosing it took a purpose-built
 * probe deployed to production.
 *
 * A length-and-charset check would have named it in seconds. That is all this
 * is, and it is worth far more than its size.
 *
 * ## Why it does not throw at import
 *
 * Bad credentials must not take the site down. This is a *report*: the storage
 * layer refuses to run and generation refuses to start — which is the correct
 * blast radius — while the marketing pages, sign-in and dashboard keep serving.
 *
 * ## Values are trimmed on the way in
 *
 * A trailing newline from a copy-paste is the single most likely defect in a
 * dashboard-entered secret, and it is invisible in every UI that displays one.
 * Trimming is always safe: no R2 credential has meaningful leading or trailing
 * whitespace.
 */
export interface R2ConfigProblem {
  variable: string;
  /** Names the defect. Never contains the value. */
  problem: string;
}

/** A Cloudflare R2 S3 credential: fixed-length, lowercase hex. */
const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;

function inspect(
  variable: string,
  raw: string | undefined,
  expected: RegExp,
  description: string,
): R2ConfigProblem | null {
  if (!raw || raw.trim() === "") {
    return { variable, problem: "is missing" };
  }

  const trimmed = raw.trim();

  // Reported separately from the format check even though trimming fixes it:
  // whitespace in a stored secret means the value was pasted carelessly, and
  // the next person to edit it should know that.
  if (raw !== trimmed) {
    return {
      variable,
      problem:
        "has leading or trailing whitespace — re-paste it without a newline",
    };
  }

  if (/^["']|["']$/.test(trimmed)) {
    return { variable, problem: "is wrapped in quotes — store the bare value" };
  }

  if (!expected.test(trimmed)) {
    return {
      variable,
      problem: `is not ${description} (it is ${trimmed.length} characters)`,
    };
  }

  return null;
}

/** Every structural defect in the current R2 configuration. Empty means valid. */
export function r2ConfigProblems(): R2ConfigProblem[] {
  const problems: R2ConfigProblem[] = [];

  const checks: [string, string | undefined, RegExp, string][] = [
    [
      "R2_ACCOUNT_ID",
      env.R2_ACCOUNT_ID,
      HEX_32,
      "32 lowercase hexadecimal characters",
    ],
    [
      "R2_ACCESS_KEY_ID",
      env.R2_ACCESS_KEY_ID,
      HEX_32,
      "32 lowercase hexadecimal characters",
    ],
    [
      "R2_SECRET_ACCESS_KEY",
      env.R2_SECRET_ACCESS_KEY,
      HEX_64,
      "64 lowercase hexadecimal characters",
    ],
    // A bucket name is not hex; only the S3 naming rules apply.
    [
      "R2_BUCKET_NAME",
      env.R2_BUCKET_NAME,
      /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
      "a valid bucket name (lowercase letters, digits, dots and hyphens)",
    ],
  ];

  for (const [variable, raw, expected, description] of checks) {
    const problem = inspect(variable, raw, expected, description);
    if (problem) problems.push(problem);
  }

  const publicUrl = env.NEXT_PUBLIC_R2_PUBLIC_URL?.trim();
  if (!publicUrl) {
    problems.push({
      variable: "NEXT_PUBLIC_R2_PUBLIC_URL",
      problem: "is missing",
    });
  } else if (!/^https:\/\/[^\s]+$/.test(publicUrl)) {
    problems.push({
      variable: "NEXT_PUBLIC_R2_PUBLIC_URL",
      problem: "is not an https URL",
    });
  }

  return problems;
}

function requireR2Config() {
  const problems = r2ConfigProblems();

  if (problems.length > 0) {
    // Names the variable and the defect, never the value — this message reaches
    // logs, and a secret in a log is a secret that has left the building.
    throw new Error(
      "R2 is misconfigured: " +
        problems.map((p) => `${p.variable} ${p.problem}`).join("; ") +
        ". See .env.example.",
    );
  }

  // Trimmed, so a pasted newline can never reach a hostname or a signature.
  return {
    accountId: env.R2_ACCOUNT_ID!.trim(),
    accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
    bucket: env.R2_BUCKET_NAME!.trim(),
  };
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

    /**
     * Do not attach integrity checksums unless an operation requires them.
     *
     * **This is not what fixed the delivery outage**, and the comment that used
     * to sit here said it was. Sprint 5C.3 saw `400 InvalidArgument` from R2,
     * matched it to the SDK's `WHEN_SUPPORTED` default adding a CRC32 header,
     * and shipped this setting as the cure without testing the counterfactual.
     * Sprint 5C.4 ran it: a Buffer upload succeeds under *both* settings. The
     * real cause was malformed credentials in Vercel — see `r2ConfigProblems`.
     *
     * It is kept because it is correct on its own terms — R2 does not need the
     * header, and not sending it is one less thing to negotiate — but it earns
     * no credit for the fix, and the record should say so.
     *
     * Integrity is unaffected: every request is TLS and SigV4-signed over the
     * payload hash, the object key contains the SHA-256 of its content, and
     * `assets.checksum` records the same digest.
     */
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
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
