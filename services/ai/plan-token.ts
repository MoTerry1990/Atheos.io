import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import { COMPILER_VERSION } from "@/services/ai/compile-for-model";
import type { CreativeBrief } from "@/services/ai/creative-brief";
import type { ImageBrief } from "@/services/ai/image-brief";

/**
 * The confirmation, in a form the client cannot forge or edit.
 *
 * ## What this replaces
 *
 * The old path let the client decide what the provider received:
 * `assemblePrompt(params, installedStyles)` was built in the browser and sent
 * as-is. Anything the browser could construct, anyone could construct — model
 * choice, duration, and the prompt itself were all client authority.
 *
 * A plan token carries only what the server needs to *reload and re-derive*
 * the decision: who confirmed it, what they confirmed, which model, what it
 * costs, and when it stops being valid. The compiled prompt is **not** in the
 * token, because the server recompiles from the brief every time — a token that
 * carried the prompt would be a token that could be edited to change it.
 *
 * ## Why HMAC rather than a database row
 *
 * A row would work and would need a migration. This sprint is not permitted one
 * without demonstrating necessity, and it is not necessary: the payload is
 * small, self-describing and short-lived. If plans later need listing or
 * revoking, a row becomes the right answer and this becomes its cache.
 */

/** Ten minutes. Long enough to read a confirmation panel, short enough to matter. */
export const PLAN_TTL_SECONDS = 600;

export interface PlanPayload {
  /** Bound to one account. A plan is not transferable. */
  userId: string;
  briefVersion: number;
  /** So a changed prompt invalidates the confirmation. */
  originalPromptHash: string;
  /** So an edited brief invalidates it too. */
  briefHash: string;
  modelId: string;
  /** Which capability table judged this. */
  capabilityVersion: number;
  compilerVersion: number;
  quotedCredits: number;
  audioStrategy: string;
  referenceIds: string[];
  issuedAtMs: number;
  expiresAtMs: number;
}

export const CAPABILITY_VERSION = 1;

/** Stable hash of an object, independent of key order. */
export function stableHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/**
 * Structural problems with the signing configuration.
 *
 * Checked rather than merely "present": the placeholder that shipped in
 * `.env.example` and sat in production for three sprints looking like a
 * configured Stripe key is exactly the failure a presence check misses. A weak
 * or placeholder signing secret is worse than none, because tokens still verify
 * — for anyone who can guess it.
 */
export function creativePlanConfigProblems(): string[] {
  const problems: string[] = [];
  const secret = env.CREATIVE_PLAN_SIGNING_SECRET;

  if (!secret) {
    problems.push("CREATIVE_PLAN_SIGNING_SECRET is not set");
    return problems;
  }
  if (/placeholder|changeme|secret|example|test|your[_-]?/i.test(secret)) {
    problems.push("CREATIVE_PLAN_SIGNING_SECRET looks like a placeholder");
  }
  // 32 characters of real entropy is the floor for an HMAC key that guards
  // money; below that a determined guess is cheaper than an attack.
  if (secret.length < 32) {
    problems.push(
      `CREATIVE_PLAN_SIGNING_SECRET is ${secret.length} characters; at least 32 are required`,
    );
  }
  if (secret !== secret.trim() || /^["']|["']$/.test(secret)) {
    problems.push(
      "CREATIVE_PLAN_SIGNING_SECRET has stray whitespace or quotes",
    );
  }
  return problems;
}

/** Whether the Director can run: flag on *and* signing configured. */
export function creativeDirectorReady(): {
  enabled: boolean;
  configured: boolean;
  ready: boolean;
} {
  /**
   * The flag is read at call time, not from the validated snapshot.
   *
   * `createEnv` captures `process.env` once at module load, which is right for
   * a connection string and wrong for a feature flag: a flag is runtime state
   * that a deploy flips, and a cached copy would keep serving the old answer
   * for the life of the process. The secret below still goes through the
   * validated snapshot, because its *shape* is what matters there.
   */
  const enabled = process.env.ENABLE_CREATIVE_DIRECTOR === "1";
  const configured = creativePlanConfigProblems().length === 0;
  // Fails closed: the flag alone does not turn it on.
  return { enabled, configured, ready: enabled && configured };
}

/**
 * The signing key.
 *
 * Its own secret, not Clerk's or Stripe's. Reusing one of those would mean
 * rotating an auth or payment credential silently invalidates every outstanding
 * plan, and it widens what a single leaked value is good for.
 *
 * A missing or malformed secret is a refusal, not a fallback to an empty
 * string — an unsigned token is worse than no token, because it looks signed.
 */
function signingKey(): Buffer {
  const problems = creativePlanConfigProblems();
  if (problems.length > 0) {
    throw new Error(`refusing to sign creative plans: ${problems.join("; ")}`);
  }
  return createHash("sha256")
    .update(`atheos:creative-plan:${env.CREATIVE_PLAN_SIGNING_SECRET}`)
    .digest();
}

function sign(body: string): string {
  return createHmac("sha256", signingKey()).update(body).digest("base64url");
}

/**
 * Anything the token can sign.
 *
 * The image brief has no `audioStrategy` and the video brief has no `kind`, so
 * the payload takes what each actually has. Widened here rather than forcing an
 * image plan to carry a silent-audio field nobody chose — a meaningless value
 * inside the hash is a value the user is nonetheless held to.
 */
/**
 * A sequence request, normalised, in a shape this signer can hash.
 *
 * Not a `CreativeBrief`: a sequence is several clips of one model rather than
 * one shot, so it has no shot list to confirm and no clarifications to answer.
 * What it does have is a settings tuple that must not change between the quote
 * and the confirmation, and `briefHash` covers the whole object — so listing
 * the settings here is what binds them.
 *
 * `version` and `originalPrompt` are named to match the other briefs because
 * `issuePlanToken` reads them directly; the rest is hashed wholesale.
 */
export interface SequenceSignable {
  version: number;
  originalPrompt: string;
  audioStrategy?: undefined;
  kind: "sequence";
  /** Public id. A catalogue path must never reach a signed payload. */
  publicModelId: string;
  mode: string;
  durationSeconds: number;
  outputs: number;
  clips: number;
}

export type SignableBrief =
  | CreativeBrief
  | (ImageBrief & { audioStrategy?: undefined })
  | SequenceSignable;

/** Issue a token for a confirmed brief. */
export function issuePlanToken(input: {
  userId: string;
  brief: SignableBrief;
  modelId: string;
  quotedCredits: number;
  referenceIds?: string[];
  nowMs: number;
}): { token: string; payload: PlanPayload } {
  const payload: PlanPayload = {
    userId: input.userId,
    briefVersion: input.brief.version,
    originalPromptHash: stableHash(input.brief.originalPrompt),
    briefHash: stableHash(input.brief),
    modelId: input.modelId,
    capabilityVersion: CAPABILITY_VERSION,
    compilerVersion: COMPILER_VERSION,
    quotedCredits: input.quotedCredits,
    // "none" for a still. Not omitted: the field is inside the signature, and
    // an absent field and a field meaning "no audio" must not hash the same.
    audioStrategy: input.brief.audioStrategy?.value ?? "none",
    referenceIds: input.referenceIds ?? [],
    issuedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + PLAN_TTL_SECONDS * 1000,
  };

  const body = Buffer.from(canonical(payload), "utf8").toString("base64url");
  return { token: `${body}.${sign(body)}`, payload };
}

export type PlanRejection =
  | "malformed"
  | "bad_signature"
  | "expired"
  | "wrong_user"
  | "brief_changed"
  | "prompt_changed"
  | "stale_capabilities"
  | "stale_compiler";

export interface PlanVerification {
  ok: boolean;
  payload?: PlanPayload;
  reason?: PlanRejection;
}

/**
 * Verify a token against the brief the client sent back with it.
 *
 * Both halves are checked. A valid signature over a payload proves the *plan*
 * was ours; comparing `briefHash` against the brief in hand proves the client
 * did not swap the brief afterwards. Checking only the signature would let
 * somebody confirm a cheap plan and submit an expensive one.
 */
export function verifyPlanToken(input: {
  token: string;
  userId: string;
  brief: SignableBrief;
  nowMs: number;
}): PlanVerification {
  const [body, signature] = input.token.split(".");
  if (!body || !signature) return { ok: false, reason: "malformed" };

  let expected: string;
  try {
    expected = sign(body);
  } catch {
    return { ok: false, reason: "bad_signature" };
  }

  // Constant time: a fast rejection leaks which prefix was right.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: PlanPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (input.nowMs > payload.expiresAtMs)
    return { ok: false, reason: "expired" };
  if (payload.userId !== input.userId)
    return { ok: false, reason: "wrong_user" };

  if (payload.originalPromptHash !== stableHash(input.brief.originalPrompt)) {
    return { ok: false, reason: "prompt_changed" };
  }
  if (payload.briefHash !== stableHash(input.brief)) {
    return { ok: false, reason: "brief_changed" };
  }

  // A plan confirmed under an older capability table or compiler is not a plan
  // for what would be produced now, and quietly honouring it would mean the
  // quote and the output disagree.
  if (payload.capabilityVersion !== CAPABILITY_VERSION) {
    return { ok: false, reason: "stale_capabilities" };
  }
  if (payload.compilerVersion !== COMPILER_VERSION) {
    return { ok: false, reason: "stale_compiler" };
  }

  return { ok: true, payload };
}
