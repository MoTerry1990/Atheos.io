import "server-only";
import { API_KEY_PREFIX } from "@/services/api-keys/prefix";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/prisma";
// Prisma 7 names generated model types with a `Model` suffix.
import type { UserModel } from "@/lib/generated/prisma/models";

/**
 * API keys — how a program acts as a user.
 *
 * Everything outside the browser authenticates with one of these: the MCP
 * server that Claude and ChatGPT talk to, a custom GPT action, an automation
 * platform, somebody's own script. A Clerk session cannot serve any of them,
 * because none has a browser to hold a cookie.
 *
 * ## The token is 256 bits of randomness with a readable prefix
 *
 *   atk_live_7f3a9c2e…            (32 bytes, base64url)
 *   └┬─┘ └┬─┘ └────┬────┘
 *    │    │        └── secret
 *    │    └── environment, so a test key pasted into production is obvious
 *    └── "Atheos key", so a leaked string is greppable and attributable
 *
 * The prefix matters more than it looks. GitHub, GitGuardian and friends scan
 * public repositories for known credential shapes; a distinctive prefix is what
 * lets a leak be caught by somebody other than an attacker.
 *
 * ## Verification is one indexed read
 *
 * The hash column is unique, so checking a key is a single lookup — not a scan
 * comparing every row. That matters on a path every API request takes.
 *
 * SHA-256, not bcrypt or argon2. Those exist to make *guessing* expensive, and
 * are worth ~100ms per attempt against a human-chosen password. This is 256
 * random bits: there is nothing to guess, no dictionary, no rainbow table. All
 * a slow hash would buy here is 100ms on every request.
 *
 * ## Plaintext is shown once and then unrecoverable
 *
 * By construction, not by policy. Only the hash is stored, so a database dump
 * yields no working credentials and no support conversation can ever recover
 * somebody's key. Losing it means issuing a new one.
 */

// Re-exported from its own module so `lib/request-identity.ts` can recognise a
// bearer token without importing Prisma. See `./prefix.ts`.
const PREFIX = API_KEY_PREFIX;
/** How much of the key is stored in clear, for display. */
const VISIBLE = 12;

export interface IssuedKey {
  id: string;
  name: string;
  /** **Shown once.** Never retrievable again. */
  key: string;
  prefix: string;
  createdAt: Date;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Mint a key for a user.
 *
 * `randomBytes` rather than `Math.random` or a uuid: this is a credential, and
 * the other two are predictable enough to enumerate given a starting point.
 */
export async function createApiKey(
  userId: string,
  name: string,
  live = true,
): Promise<IssuedKey> {
  const secret = randomBytes(32).toString("base64url");
  const key = `${PREFIX}_${live ? "live" : "test"}_${secret}`;

  const record = await prisma.apiKey.create({
    data: {
      userId,
      name: name.trim().slice(0, 80) || "Untitled key",
      prefix: key.slice(0, VISIBLE),
      hash: hashKey(key),
    },
    select: { id: true, name: true, prefix: true, createdAt: true },
  });

  return { ...record, key };
}

/**
 * Resolve the user a key belongs to, or null.
 *
 * Returns null for every failure — malformed, unknown, revoked — and says which
 * only in the log. Distinguishing "no such key" from "revoked key" in the
 * response tells an attacker holding a stolen key that it was real, and when it
 * stopped working.
 */
export async function resolveApiKey(
  raw: string | null | undefined,
): Promise<UserModel | null> {
  if (!raw) return null;

  const key = raw.startsWith("Bearer ") ? raw.slice(7).trim() : raw.trim();
  if (!key.startsWith(`${PREFIX}_`)) return null;

  const record = await prisma.apiKey.findUnique({
    where: { hash: hashKey(key) },
    include: { user: true },
  });

  if (!record || record.revokedAt) return null;

  // Constant-time, even though the lookup above already succeeded on an exact
  // hash match. Cheap, and it keeps the comparison correct if this is ever
  // refactored into a fetch-then-compare.
  const expected = Buffer.from(record.hash, "hex");
  const actual = Buffer.from(hashKey(key), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  // Fire-and-forget: a failed timestamp write must not fail the request the
  // caller actually made. Coarse to the minute would be cheaper, but "when was
  // this key last used" is the first question asked after a leak and it is
  // worth an exact answer.
  void prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return record.user;
}

/** A user's keys, without anything that could authenticate. */
export async function listApiKeys(userId: string) {
  return prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
}

/**
 * Revoke, scoped to the owner.
 *
 * `updateMany` with `userId` in the filter rather than `update` by id: an
 * `update` would revoke any key whose id somebody could guess or observe. The
 * ownership check belongs in the query, not in a separate read the caller might
 * forget.
 */
export async function revokeApiKey(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const { count } = await prisma.apiKey.updateMany({
    where: { id: keyId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return count > 0;
}
