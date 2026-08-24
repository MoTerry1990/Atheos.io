import "server-only";

import { AssetKind } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { presignedDownloadUrl } from "@/services/storage/assets";

/**
 * "Now make this image a video" — which image, and whose.
 *
 * ## What actually happened
 *
 * The audited benchmark pair says it plainly. The image generation
 * (`cmt6cqxlb…snbmi8`) produced a PNG. The follow-up video
 * (`cmt6cwu0f…zxl89o`) recorded:
 *
 *   operation      : TEXT_TO_VIDEO
 *   inputImageUrls : []
 *   parentId       : null
 *   model          : replicate/video-gen  (wan-2.2-t2v-fast, no image input)
 *
 * The image was never sent. It could not have been: Motion 1 is a text-to-video
 * model whose schema has no `image` field at all. So "make *this* image a video"
 * ran a fresh text-to-video from the same stale prompt, and the result shares
 * nothing with the picture the user was looking at — not the dragon, not the
 * castle, not the light. That is the entire "does not preserve the reference"
 * complaint, and it was never a model-quality problem.
 *
 * ## The rules this module exists to enforce
 *
 * The browser sends an **asset id**, never a URL. A URL from a client is an
 * instruction to fetch whatever the client likes, on our credentials and our
 * bill; an id is a claim we can check. Everything else follows from that:
 * ownership is verified against the row, the signed URL is minted here, and it
 * is minted only after the check passes.
 *
 * ## No migration
 *
 * A first-class `Project` model does not exist — `/projects` is `Collection`.
 * Rather than add one, this resolves against what is already durable:
 * `Asset.userId` for ownership, `Collection`/`CollectionAsset` for grouping, and
 * `Generation.parentId` for the parent-child link, which has existed since
 * Sprint 4 and was simply never written on this path.
 */

/** Never widened to accept a URL. That is the point of the type. */
export interface AnimationSourceRequest {
  userId: string;
  /** Opaque, owned. The only thing the browser may name. */
  assetId?: string;
  /** Optional narrowing to one project (a Collection). */
  collectionId?: string;
}

export interface AnimationCandidate {
  assetId: string;
  /** For the picker. Never a storage key and never a bare URL. */
  label: string;
  width: number | null;
  height: number | null;
  createdAt: number;
  generationId: string | null;
}

export type AnimationSource =
  | {
      status: "resolved";
      assetId: string;
      /** Minted here, after the ownership check. Short-lived. */
      url: string;
      mimeType: string;
      width: number | null;
      height: number | null;
      /** The generation that produced it, for the parent-child link. */
      parentGenerationId: string | null;
    }
  | {
      /** More than one plausible image. Ask; never guess. */
      status: "choose";
      candidates: AnimationCandidate[];
    }
  | {
      status: "none";
      reason: string;
    };

export class AnimationSourceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AnimationSourceError";
  }
}

/** How many recent images count as "active" before we ask which one. */
const ACTIVE_WINDOW = 6;

/**
 * Resolve what to animate.
 *
 * Three outcomes and no fourth: a specific owned image, a question, or nothing.
 * There is deliberately no "best guess" branch — animating the wrong picture
 * costs the same as animating the right one and is discovered only after the
 * money is gone.
 */
export async function resolveAnimationSource(
  request: AnimationSourceRequest,
): Promise<AnimationSource> {
  if (request.assetId) {
    const asset = await prisma.asset.findFirst({
      where: {
        id: request.assetId,
        /**
         * Ownership in the `where`, not in an `if` after the read.
         *
         * A check written as a conditional is one early return away from being
         * skipped. Written as a predicate, a foreign asset simply does not
         * exist — and the 404 below tells an attacker nothing about whether it
         * does.
         */
        userId: request.userId,
        kind: AssetKind.IMAGE,
        deletedAt: null,
        ...(request.collectionId
          ? { collections: { some: { collectionId: request.collectionId } } }
          : {}),
      },
      select: {
        id: true,
        storageKey: true,
        mimeType: true,
        width: true,
        height: true,
        generationId: true,
      },
    });

    if (!asset) {
      // Not "forbidden". A 404 for someone else's asset and a 404 for a
      // non-existent one are the same answer, which is what stops the endpoint
      // being an existence oracle for other people's work.
      throw new AnimationSourceError(
        "That image is not available.",
        404,
        "asset_not_found",
      );
    }

    return {
      status: "resolved",
      assetId: asset.id,
      url: await presignedDownloadUrl(asset.storageKey, "reference"),
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      parentGenerationId: asset.generationId,
    };
  }

  // No id given — find what the user is plausibly looking at.
  const recent = await prisma.asset.findMany({
    where: {
      userId: request.userId,
      kind: AssetKind.IMAGE,
      deletedAt: null,
      ...(request.collectionId
        ? { collections: { some: { collectionId: request.collectionId } } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: ACTIVE_WINDOW,
    select: {
      id: true,
      width: true,
      height: true,
      createdAt: true,
      generationId: true,
      generation: { select: { prompt: true } },
    },
  });

  if (recent.length === 0) {
    return {
      status: "none",
      reason:
        "There is no image to animate yet. Generate one first, or upload the picture you want to bring to life.",
    };
  }

  /**
   * Exactly one recent image is unambiguous; more than one is not.
   *
   * Silently taking the newest would be right most of the time, and the times
   * it is wrong are a paid video of the wrong picture. The brief says ask, and
   * asking is cheap.
   */
  if (recent.length === 1) {
    return resolveAnimationSource({ ...request, assetId: recent[0].id });
  }

  return {
    status: "choose",
    candidates: recent.map((a) => ({
      assetId: a.id,
      label: a.generation?.prompt
        ? a.generation.prompt.slice(0, 70)
        : "Uploaded image",
      width: a.width,
      height: a.height,
      createdAt: a.createdAt.getTime(),
      generationId: a.generationId,
    })),
  };
}
