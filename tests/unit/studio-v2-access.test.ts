import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who gets Studio V2, and who cannot talk their way into it.
 *
 * ## Two conditions, and why neither is enough alone
 *
 * The flag alone would expose an unfinished interface to every signed-in user
 * the moment it is set in an environment. The admin check alone would ship V2
 * the instant the code merged. Requiring both means neither a deploy nor a
 * config change can release it by accident.
 *
 * ## Why there is nothing here about a query parameter
 *
 * Because there is no query parameter. The decision is made on the server
 * before anything renders, and a client-readable toggle would announce the
 * interface exists and invite attempts to reach it.
 */

const isAdmin = vi.fn();
vi.mock("@/services/admin/auth", () => ({
  isAdmin: (...a: unknown[]) => isAdmin(...a),
}));

const { canUseStudioV2, studioV2FlagEnabled } =
  await import("@/services/studio/v2-access");

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ENABLE_STUDIO_V2_OWNER_BETA;
});

describe("both conditions are required", () => {
  it("gives V2 to an admin when the flag is on", async () => {
    process.env.ENABLE_STUDIO_V2_OWNER_BETA = "1";
    isAdmin.mockResolvedValue(true);

    expect(await canUseStudioV2()).toBe(true);
  });

  it("refuses an admin when the flag is off", async () => {
    // The code merging must not be what ships the interface.
    isAdmin.mockResolvedValue(true);
    expect(await canUseStudioV2()).toBe(false);
  });

  it("refuses a non-admin when the flag is on", async () => {
    /**
     * The failure that matters commercially: setting the flag in an
     * environment must not hand an unfinished Studio to paying customers.
     */
    process.env.ENABLE_STUDIO_V2_OWNER_BETA = "1";
    isAdmin.mockResolvedValue(false);

    expect(await canUseStudioV2()).toBe(false);
  });

  it("refuses a signed-out visitor", async () => {
    process.env.ENABLE_STUDIO_V2_OWNER_BETA = "1";
    isAdmin.mockResolvedValue(false);

    expect(await canUseStudioV2()).toBe(false);
  });
});

describe("the flag is read at call time", () => {
  it("notices a value that changed after module load", async () => {
    /**
     * `createEnv` snapshots `process.env` once, which is right for a connection
     * string and wrong for a flag: a flag is runtime state a deploy flips, and
     * a cached copy keeps serving the old answer for the life of the process.
     */
    isAdmin.mockResolvedValue(true);
    expect(await canUseStudioV2()).toBe(false);

    process.env.ENABLE_STUDIO_V2_OWNER_BETA = "1";
    expect(await canUseStudioV2()).toBe(true);
  });

  it("treats any value other than 1 as off", async () => {
    // "true", "yes" and "0" are all off. One spelling, so a typo fails closed.
    isAdmin.mockResolvedValue(true);

    for (const value of ["true", "yes", "0", ""]) {
      process.env.ENABLE_STUDIO_V2_OWNER_BETA = value;
      expect(await canUseStudioV2(), value).toBe(false);
    }
  });
});

describe("the diagnostic helper never decides what a customer sees", () => {
  it("reports the flag without asking who is calling", () => {
    process.env.ENABLE_STUDIO_V2_OWNER_BETA = "1";

    expect(studioV2FlagEnabled()).toBe(true);
    // And it did not consult the admin check, which is why it must never be
    // used to gate the interface.
    expect(isAdmin).not.toHaveBeenCalled();
  });
});
