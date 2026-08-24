import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Machine callers, and whose credits they spend.
 *
 * The guard decides whether a request gets in (tests/api/guard.test.ts). This
 * file is about the question that follows: **who is billed**. A key acts as its
 * owner, so a generation started by a script must land in exactly the ledger a
 * generation started in the browser would — same user row, same balance, same
 * audit trail. Anything less makes machine usage unattributable, which is the
 * one thing a paid API cannot be.
 */

const apiKeyFindUnique = vi.fn();
const apiKeyUpdate = vi.fn();
const getUserId = vi.fn();
const getHeader = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiKey: {
      findUnique: (...a: unknown[]) => apiKeyFindUnique(...a),
      update: (...a: unknown[]) => apiKeyUpdate(...a),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => getHeader(name) }),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: getUserId() }),
  currentUser: async () => null,
}));

const { resolveApiKey } = await import("@/services/api-keys");
const { API_KEY_PREFIX } = await import("@/services/api-keys/prefix");

const OWNER = {
  id: "db_owner",
  clerkId: "clerk_owner",
  email: "owner@example.com",
  creditBalance: 5_000,
};

const KEY = `${API_KEY_PREFIX}_live_0123456789abcdef0123456789abcdef`;

/** The stored row for `KEY`, hashed the way the service hashes it. */
async function rowFor(key: string, overrides: Record<string, unknown> = {}) {
  const { createHash } = await import("node:crypto");
  return {
    id: "key_1",
    hash: createHash("sha256").update(key).digest("hex"),
    revokedAt: null,
    user: OWNER,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiKeyFindUnique.mockResolvedValue(null);
  apiKeyUpdate.mockResolvedValue({});
  getUserId.mockReturnValue(null);
  getHeader.mockReturnValue(null);
});

describe("a key resolves to its owner", () => {
  it("returns the owning user row, in full", async () => {
    /**
     * In full, not a stub with an id. Everything downstream that decides what a
     * caller may do — plan tier, credit balance, spend ceiling — reads this row.
     * A trimmed one would silently drop a machine caller onto default limits.
     */
    apiKeyFindUnique.mockResolvedValue(await rowFor(KEY));

    const user = await resolveApiKey(KEY);

    expect(user).toEqual(OWNER);
    expect(apiKeyFindUnique.mock.calls[0][0].include).toEqual({ user: true });
  });

  it("accepts the token with or without the Bearer prefix", async () => {
    apiKeyFindUnique.mockResolvedValue(await rowFor(KEY));

    expect(await resolveApiKey(`Bearer ${KEY}`)).toEqual(OWNER);
    expect(await resolveApiKey(KEY)).toEqual(OWNER);
  });

  it("never stores or looks up the raw key", async () => {
    // The database holds hashes. A leaked backup must not be a leaked key.
    apiKeyFindUnique.mockResolvedValue(await rowFor(KEY));
    await resolveApiKey(KEY);

    const where = apiKeyFindUnique.mock.calls[0][0].where;
    expect(where.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(where)).not.toContain(KEY);
  });

  it("records when the key was last used", async () => {
    // First question asked after a leak.
    apiKeyFindUnique.mockResolvedValue(await rowFor(KEY));
    await resolveApiKey(KEY);

    expect(apiKeyUpdate.mock.calls[0][0].data.lastUsedAt).toBeInstanceOf(Date);
  });
});

describe("every failure looks the same", () => {
  it("refuses a revoked key", async () => {
    apiKeyFindUnique.mockResolvedValue(
      await rowFor(KEY, { revokedAt: new Date() }),
    );
    expect(await resolveApiKey(KEY)).toBeNull();
  });

  it("refuses an unknown key", async () => {
    apiKeyFindUnique.mockResolvedValue(null);
    expect(await resolveApiKey(KEY)).toBeNull();
  });

  it("refuses a foreign token without touching the database", async () => {
    // A Clerk JWT, an OAuth token, anything without our prefix. Cheap rejection
    // keeps a spray of junk headers from costing a lookup each.
    expect(await resolveApiKey("Bearer eyJhbGciOiJIUzI1NiJ9.x.y")).toBeNull();
    expect(await resolveApiKey(null)).toBeNull();
    expect(await resolveApiKey("")).toBeNull();
    expect(apiKeyFindUnique).not.toHaveBeenCalled();
  });

  it("does not tell a caller which failure it was", async () => {
    /**
     * Revoked, unknown and malformed all return the same null. Distinguishing
     * them tells somebody holding a stolen key that it was real, and roughly
     * when it stopped working.
     */
    apiKeyFindUnique.mockResolvedValue(
      await rowFor(KEY, { revokedAt: new Date() }),
    );
    const revoked = await resolveApiKey(KEY);
    apiKeyFindUnique.mockResolvedValue(null);
    const unknown = await resolveApiKey(KEY);

    expect(revoked).toBe(unknown);
  });

  it("survives a failed lastUsedAt write", async () => {
    // Fire-and-forget: a bookkeeping write must not fail the request the caller
    // actually made.
    apiKeyFindUnique.mockResolvedValue(await rowFor(KEY));
    apiKeyUpdate.mockRejectedValue(new Error("write conflict"));

    await expect(resolveApiKey(KEY)).resolves.toEqual(OWNER);
  });
});
