import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Now make this image a video" — whose image, and how we know.
 *
 * ## The generation this replaces
 *
 * The audited follow-up (`cmt6cwu0f…zxl89o`) recorded:
 *
 *   operation      : TEXT_TO_VIDEO
 *   inputImageUrls : []
 *   parentId       : null
 *   model          : replicate/video-gen  (wan-2.2-t2v-fast — no image input)
 *
 * No picture was sent, no link was kept, and the model could not have accepted
 * one. So the entire "it does not preserve the dragon or the castle" complaint
 * was never about model quality.
 *
 * ## What is actually under test
 *
 * Ownership, and the refusal to accept a URL. Everything else about this
 * feature is a convenience; these two are the ones that, if wrong, let one
 * customer spend their credits animating another customer's picture.
 */

const findFirst = vi.fn();
const findMany = vi.fn();
const presigned = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { asset: { findFirst, findMany } },
}));

vi.mock("@/services/storage/assets", () => ({
  presignedDownloadUrl: (...args: unknown[]) => presigned(...args),
}));

// Imported after the mocks, which vitest hoists above it.
const { AnimationSourceError, resolveAnimationSource } =
  await import("@/services/ai/animate-source");

const OWNED = {
  id: "asset_owned",
  storageKey: "generated/user_alice/dragon.png",
  mimeType: "image/png",
  width: 2048,
  height: 1152,
  generationId: "gen_dragon",
};

beforeEach(() => {
  findFirst.mockReset();
  findMany.mockReset();
  presigned.mockReset().mockResolvedValue("https://signed.example/x?sig=…");
});

describe("8. ownership is enforced in the query, not after it", () => {
  it("scopes the lookup by userId", async () => {
    findFirst.mockResolvedValue(OWNED);

    await resolveAnimationSource({
      userId: "user_alice",
      assetId: "asset_owned",
    });

    /**
     * The assertion is about *where* the check is, not merely that it happened.
     * A check written as an `if` after the read is one early return away from
     * being skipped; written as a predicate, a foreign asset simply does not
     * exist.
     */
    const where = findFirst.mock.calls[0][0].where;
    expect(where.userId).toBe("user_alice");
    expect(where.kind).toBe("IMAGE");
    expect(where.deletedAt).toBeNull();
  });

  it("26. refuses another user's asset as a 404, not a 403", async () => {
    // Prisma returns nothing because the userId predicate excluded it.
    findFirst.mockResolvedValue(null);

    await expect(
      resolveAnimationSource({
        userId: "user_mallory",
        assetId: "asset_owned",
      }),
    ).rejects.toThrow(AnimationSourceError);

    try {
      await resolveAnimationSource({
        userId: "user_mallory",
        assetId: "asset_owned",
      });
    } catch (error) {
      // 404 and not 403: telling a caller that an id exists but is not theirs
      // turns the endpoint into an existence oracle for other people's work.
      expect((error as InstanceType<typeof AnimationSourceError>).status).toBe(
        404,
      );
      expect((error as InstanceType<typeof AnimationSourceError>).code).toBe(
        "asset_not_found",
      );
    }
  });

  it("narrows to a project when one is given", async () => {
    findFirst.mockResolvedValue(OWNED);
    await resolveAnimationSource({
      userId: "user_alice",
      assetId: "asset_owned",
      collectionId: "col_1",
    });
    expect(findFirst.mock.calls[0][0].where.collections).toEqual({
      some: { collectionId: "col_1" },
    });
  });
});

describe("the signed URL is minted here, after the check", () => {
  it("returns a URL only for an asset that passed", async () => {
    findFirst.mockResolvedValue(OWNED);
    const source = await resolveAnimationSource({
      userId: "user_alice",
      assetId: "asset_owned",
    });

    expect(source.status).toBe("resolved");
    expect(presigned).toHaveBeenCalledWith(OWNED.storageKey, "reference");
    if (source.status !== "resolved") throw new Error("unreachable");
    expect(source.url).toMatch(/^https:\/\//);
  });

  it("never mints one for a rejected asset", async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      resolveAnimationSource({ userId: "user_mallory", assetId: "x" }),
    ).rejects.toThrow();
    expect(presigned).not.toHaveBeenCalled();
  });

  it("carries the parent generation, so the link can be written", async () => {
    // `Generation.parentId` has existed since Sprint 4; nothing wrote it on
    // this path, which is why the audited record shows parentId: null.
    findFirst.mockResolvedValue(OWNED);
    const source = await resolveAnimationSource({
      userId: "user_alice",
      assetId: "asset_owned",
    });
    if (source.status !== "resolved") throw new Error("unreachable");
    expect(source.parentGenerationId).toBe("gen_dragon");
  });
});

describe("9. resolving the active image when none was named", () => {
  it("uses the only recent image without asking", async () => {
    findMany.mockResolvedValue([
      { ...OWNED, createdAt: new Date(1), generation: { prompt: "a dragon" } },
    ]);
    findFirst.mockResolvedValue(OWNED);

    const source = await resolveAnimationSource({ userId: "user_alice" });
    expect(source.status).toBe("resolved");
  });

  it("asks when more than one could be meant", async () => {
    findMany.mockResolvedValue([
      {
        id: "a",
        width: 2048,
        height: 1152,
        createdAt: new Date(2),
        generationId: "g1",
        generation: { prompt: "a red dragon on a castle" },
      },
      {
        id: "b",
        width: 1024,
        height: 1024,
        createdAt: new Date(1),
        generationId: "g2",
        generation: { prompt: "a red car" },
      },
    ]);

    const source = await resolveAnimationSource({ userId: "user_alice" });
    expect(source.status).toBe("choose");
    if (source.status !== "choose") throw new Error("unreachable");
    expect(source.candidates.map((c) => c.assetId)).toEqual(["a", "b"]);
    // Labels, not storage keys and not URLs.
    expect(source.candidates[0].label).toMatch(/dragon/);
    expect(JSON.stringify(source.candidates)).not.toMatch(/https?:\/\//);
    // And nothing was signed just to render a picker.
    expect(presigned).not.toHaveBeenCalled();
  });

  it("10. asks for an upload when there is nothing at all", async () => {
    findMany.mockResolvedValue([]);
    const source = await resolveAnimationSource({ userId: "user_alice" });
    expect(source.status).toBe("none");
    if (source.status !== "none") throw new Error("unreachable");
    expect(source.reason).toMatch(/generate one first|upload/i);
  });

  it("scopes the candidate search by user", async () => {
    findMany.mockResolvedValue([]);
    await resolveAnimationSource({ userId: "user_alice" });
    expect(findMany.mock.calls[0][0].where.userId).toBe("user_alice");
    expect(findMany.mock.calls[0][0].where.kind).toBe("IMAGE");
  });
});
