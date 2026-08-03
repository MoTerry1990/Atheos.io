import "server-only";

import { randomUUID } from "node:crypto";

import { getCurrentUser, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/prisma-errors";
import {
  HANDLE_MESSAGES,
  normaliseHandle,
  slugify,
  validateHandle,
} from "@/services/community/handles";
import type {
  GalleryOrder,
  PublicAuthor,
  PublicCollection,
  PublicComment,
  PublicPost,
  PublicProfile,
} from "@/services/community/types";

/**
 * Community.
 *
 * ## Two rules everything here obeys
 *
 * **Nothing is public unless somebody published it.** A `Post` row exists only
 * because a person pressed Publish. Every read filters on `publishedAt`, and a
 * shared collection shows only the assets inside it that were *themselves*
 * published — the intersection is enforced here, not assumed from the
 * collection's own visibility.
 *
 * **A public author is a projection.** `toAuthor` returns a handle, a display
 * name and an avatar. The `User` row carries an email, a Clerk id, a credit
 * balance and a Stripe customer id, and none of it may travel to a page anybody
 * can load. Over-sharing requires writing new code rather than forgetting to
 * strip a field.
 *
 * ## Counts are denormalised and written transactionally
 *
 * `likeCount` and `commentCount` on the post, `followerCount` on the user. A
 * gallery of twenty-four cards would otherwise be twenty-four counting
 * subqueries. Every write that changes a count does so in the same transaction
 * as the row it counts, so the two cannot drift.
 */

export class CommunityError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly code: string = "invalid_request",
  ) {
    super(message);
    this.name = "CommunityError";
  }
}

/**
 * Publishing requires a handle.
 *
 * Not a technical constraint — a post with no author page is a dead end for
 * anyone who wants to see more. Asking for it at the moment of publishing is
 * also the only time the reason is obvious.
 */
async function requirePublisher() {
  const user = await requireApiUser();

  if (!user.handle) {
    throw new CommunityError(
      "Choose a public handle before publishing.",
      409,
      "handle_required",
    );
  }

  return user as typeof user & { handle: string };
}

// ---------------------------------------------------------------- shaping ---

type AuthorRow = {
  handle: string | null;
  displayName: string | null;
  name: string | null;
  imageUrl: string | null;
};

function toAuthor(row: AuthorRow, following: boolean): PublicAuthor {
  return {
    handle: row.handle ?? "",
    // `displayName` first, then Clerk's `name`, then the handle. The fallback
    // order matters: `name` is often a real legal name, so a user who set a
    // display name has actively chosen something else and that choice wins.
    displayName: row.displayName ?? row.name ?? row.handle ?? "Unknown",
    imageUrl: row.imageUrl,
    following,
  };
}

const POST_SELECT = {
  slug: true,
  caption: true,
  showPrompt: true,
  publishedAt: true,
  featuredAt: true,
  likeCount: true,
  commentCount: true,
  userId: true,
  user: {
    select: { handle: true, displayName: true, name: true, imageUrl: true },
  },
  asset: {
    select: {
      storageKey: true,
      mimeType: true,
      width: true,
      height: true,
      durationMs: true,
    },
  },
} as const;

/**
 * Which of these posts the viewer has liked, and which authors they follow.
 *
 * Two queries for a whole page rather than two per card. The alternative —
 * checking inside the map — is the N+1 that makes a gallery feel broken.
 */
async function viewerContext(
  viewerId: string | null,
  postSlugs: string[],
  authorIds: string[],
) {
  if (!viewerId)
    return { liked: new Set<string>(), following: new Set<string>() };

  const [likes, follows] = await Promise.all([
    postSlugs.length
      ? prisma.postLike.findMany({
          where: { userId: viewerId, post: { slug: { in: postSlugs } } },
          select: { post: { select: { slug: true } } },
        })
      : [],
    authorIds.length
      ? prisma.follow.findMany({
          where: { followerId: viewerId, followingId: { in: authorIds } },
          select: { followingId: true },
        })
      : [],
  ]);

  return {
    liked: new Set(likes.map((row) => row.post.slug)),
    following: new Set(follows.map((row) => row.followingId)),
  };
}

// --------------------------------------------------------------- gallery ----

/**
 * The public gallery.
 *
 * ## Trending is computed, not curated, and not invented
 *
 * Engagement within a window, ordered by likes then comments then recency. It
 * is deliberately simple: a weighted decay score would look more sophisticated
 * and would be untestable against a dataset that does not exist yet. When there
 * is real traffic, this is the function to replace — and its signature will not
 * change.
 *
 * With nothing published, trending returns nothing. It does not fall back to
 * "recent" dressed up as trending, because a gallery that invents momentum is
 * lying about the only thing the ranking claims to measure.
 *
 * ## Featured is editorial
 *
 * `featuredAt` is set by us, never derived from popularity. Two different
 * claims — "many people liked this" and "we think this is worth seeing" — and
 * conflating them would make the second one worthless.
 */
export async function listPosts(
  options: {
    order?: GalleryOrder;
    handle?: string;
    /** Only posts the viewer follows the author of. */
    following?: boolean;
    limit?: number;
    cursor?: string;
  } = {},
): Promise<{ posts: PublicPost[]; nextCursor: string | null }> {
  const viewer = await getCurrentUser();
  const order = options.order ?? "recent";
  const take = Math.min(options.limit ?? 24, 60);

  // Seven days. Long enough that a quiet week still has a trending page, short
  // enough that it means "now" rather than "ever".
  const trendingSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  let followingIds: string[] | undefined;
  if (options.following) {
    if (!viewer) return { posts: [], nextCursor: null };
    const follows = await prisma.follow.findMany({
      where: { followerId: viewer.id },
      orderBy: { createdAt: "desc" },
      // Loads the viewer's entire following list to build an `IN` clause. A
      // user following 50,000 accounts would have loaded 50,000 rows on every
      // page of their feed — and then handed Postgres a 50,000-element `IN`,
      // which is its own problem.
      //
      // 2,000 most-recently-followed is the ceiling. Past that the feed silently
      // omits the oldest follows, which is the least bad failure available
      // without restructuring this as a join. Noted in PERFORMANCE_REPORT.md.
      take: 2_000,
      select: { followingId: true },
    });
    followingIds = follows.map((row) => row.followingId);
    if (followingIds.length === 0) return { posts: [], nextCursor: null };
  }

  const rows = await prisma.post.findMany({
    where: {
      publishedAt: { not: null },
      ...(order === "featured" ? { featuredAt: { not: null } } : {}),
      ...(order === "trending" ? { publishedAt: { gte: trendingSince } } : {}),
      ...(options.handle ? { user: { handle: options.handle } } : {}),
      ...(followingIds ? { userId: { in: followingIds } } : {}),
      // A deleted asset leaves a post pointing at nothing. Cascade handles the
      // hard-delete case; this covers the soft one.
      asset: { deletedAt: null },
    },
    orderBy:
      order === "trending"
        ? [
            { likeCount: "desc" },
            { commentCount: "desc" },
            { publishedAt: "desc" },
          ]
        : order === "featured"
          ? [{ featuredAt: "desc" }]
          : [{ publishedAt: "desc" }],
    // Cursor pagination rather than offset: the gallery is ordered by recency
    // and new posts arrive while somebody is scrolling, which shifts every
    // offset and duplicates rows across pages.
    ...(options.cursor ? { cursor: { slug: options.cursor }, skip: 1 } : {}),
    take: take + 1,
    select: POST_SELECT,
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  const context = await viewerContext(
    viewer?.id ?? null,
    page.map((row) => row.slug),
    page.map((row) => row.userId),
  );

  return {
    posts: page.map((row) => shapePost(row, viewer?.id ?? null, context)),
    nextCursor: hasMore ? page[page.length - 1].slug : null,
  };
}

type PostRow = {
  slug: string;
  caption: string | null;
  showPrompt: boolean;
  publishedAt: Date | null;
  featuredAt: Date | null;
  likeCount: number;
  commentCount: number;
  userId: string;
  user: AuthorRow;
  asset: {
    storageKey: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  };
};

function shapePost(
  row: PostRow,
  viewerId: string | null,
  context: { liked: Set<string>; following: Set<string> },
  prompt?: string | null,
): PublicPost {
  return {
    slug: row.slug,
    caption: row.caption,
    // Withheld unless the author opted in. The prompt is the part people most
    // want and the part a professional is most likely to consider their method.
    prompt: row.showPrompt ? (prompt ?? null) : null,
    publishedAt: row.publishedAt?.getTime() ?? 0,
    featured: row.featuredAt !== null,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    liked: context.liked.has(row.slug),
    mine: viewerId === row.userId,
    author: toAuthor(row.user, context.following.has(row.userId)),
    asset: row.asset,
  };
}

/** One post, with the prompt resolved when the author allowed it. */
export async function getPost(slug: string): Promise<PublicPost> {
  const viewer = await getCurrentUser();

  const row = await prisma.post.findFirst({
    where: { slug, publishedAt: { not: null }, asset: { deletedAt: null } },
    select: {
      slug: true,
      caption: true,
      showPrompt: true,
      publishedAt: true,
      featuredAt: true,
      likeCount: true,
      commentCount: true,
      userId: true,
      user: {
        select: { handle: true, displayName: true, name: true, imageUrl: true },
      },
      asset: {
        select: {
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          durationMs: true,
          // Reached through the asset rather than copied onto the post, so a
          // post can never misquote the prompt that produced it.
          generation: { select: { prompt: true } },
        },
      },
    },
  });

  if (!row) {
    throw new CommunityError("That post is not available.", 404, "not_found");
  }

  const context = await viewerContext(
    viewer?.id ?? null,
    [row.slug],
    [row.userId],
  );

  const { generation, ...asset } = row.asset;

  return shapePost(
    { ...row, asset },
    viewer?.id ?? null,
    context,
    generation?.prompt ?? null,
  );
}

// ------------------------------------------------------------ publishing ----

/**
 * Publish one asset.
 *
 * Idempotent on the asset: publishing something already published updates the
 * caption rather than creating a second post. Two posts of the same image is
 * not a state anyone wants, and the double-submit that produces it is common.
 */
export async function publishAsset(input: {
  assetId: string;
  caption?: string;
  showPrompt?: boolean;
}): Promise<{ slug: string }> {
  const user = await requirePublisher();

  const asset = await prisma.asset.findFirst({
    where: { id: input.assetId, userId: user.id, deletedAt: null },
    select: { id: true },
  });

  if (!asset) {
    throw new CommunityError("That result was not found.", 404, "not_found");
  }

  const existing = await prisma.post.findFirst({
    where: { assetId: asset.id, userId: user.id },
    select: { slug: true },
  });

  const caption = input.caption?.trim() || null;
  const showPrompt = input.showPrompt ?? true;

  if (existing) {
    await prisma.post.update({
      where: { slug: existing.slug },
      data: { caption, showPrompt, publishedAt: new Date() },
    });
    return { slug: existing.slug };
  }

  // Random rather than derived from the caption. A slug from a title leaks the
  // caption into the URL and has to be de-duplicated; a random one is stable
  // through edits and reveals nothing.
  const slug = randomUUID().replace(/-/g, "").slice(0, 12);

  await prisma.post.create({
    data: {
      slug,
      userId: user.id,
      assetId: asset.id,
      caption,
      showPrompt,
      publishedAt: new Date(),
    },
  });

  return { slug };
}

/**
 * Take a post down.
 *
 * `publishedAt = null` rather than a delete. The likes and comments belong to
 * the people who left them, and a republish should restore the conversation
 * rather than start a new one from zero.
 */
export async function unpublishPost(slug: string): Promise<void> {
  const user = await requireApiUser();

  const result = await prisma.post.updateMany({
    where: { slug, userId: user.id },
    data: { publishedAt: null },
  });

  if (result.count === 0) {
    throw new CommunityError("That post was not found.", 404, "not_found");
  }
}

// ----------------------------------------------------------------- likes ----

/**
 * Like or unlike.
 *
 * The count and the row move together, in one transaction. A count that can
 * drift from the rows it counts is a number nobody can ever trust again, and
 * reconciling it later means a full table scan per post.
 *
 * Liking twice is a double-click, not an error: the composite primary key
 * rejects it and the count is left alone.
 */
export async function setLike(
  slug: string,
  liked: boolean,
): Promise<{ liked: boolean; likeCount: number }> {
  const user = await requireApiUser();

  const post = await prisma.post.findFirst({
    where: { slug, publishedAt: { not: null } },
    select: { id: true },
  });

  if (!post) {
    throw new CommunityError("That post is not available.", 404, "not_found");
  }

  const count = await prisma.$transaction(async (tx) => {
    if (liked) {
      const created = await tx.postLike.createMany({
        data: { postId: post.id, userId: user.id },
        skipDuplicates: true,
      });
      if (created.count === 0) {
        const current = await tx.post.findUniqueOrThrow({
          where: { id: post.id },
          select: { likeCount: true },
        });
        return current.likeCount;
      }
      const updated = await tx.post.update({
        where: { id: post.id },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      });
      return updated.likeCount;
    }

    const removed = await tx.postLike.deleteMany({
      where: { postId: post.id, userId: user.id },
    });
    if (removed.count === 0) {
      const current = await tx.post.findUniqueOrThrow({
        where: { id: post.id },
        select: { likeCount: true },
      });
      return current.likeCount;
    }
    const updated = await tx.post.update({
      where: { id: post.id },
      // Floored at zero. A negative like count is impossible by construction
      // and catastrophic to look at, so the guard is worth the clause.
      data: { likeCount: { decrement: 1 } },
      select: { likeCount: true },
    });
    return Math.max(0, updated.likeCount);
  });

  return { liked, likeCount: count };
}

// -------------------------------------------------------------- comments ----

export async function listComments(
  slug: string,
  limit = 50,
): Promise<PublicComment[]> {
  const viewer = await getCurrentUser();

  const rows = await prisma.comment.findMany({
    where: { post: { slug, publishedAt: { not: null } } },
    orderBy: { createdAt: "asc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      body: true,
      deletedAt: true,
      createdAt: true,
      userId: true,
      user: {
        select: { handle: true, displayName: true, name: true, imageUrl: true },
      },
    },
  });

  const context = await viewerContext(
    viewer?.id ?? null,
    [],
    rows.map((row) => row.userId),
  );

  return rows.map((row) => ({
    id: row.id,
    // The tombstone replaces the body on the way out. A deleted comment whose
    // text is still in the payload has not been deleted in any sense the person
    // who deleted it would recognise.
    body: row.deletedAt ? "" : row.body,
    createdAt: row.createdAt.getTime(),
    author: toAuthor(row.user, context.following.has(row.userId)),
    mine: viewer?.id === row.userId,
    deleted: row.deletedAt !== null,
  }));
}

export async function addComment(
  slug: string,
  body: string,
): Promise<PublicComment> {
  const user = await requireApiUser();

  const trimmed = body.trim();
  if (!trimmed) {
    throw new CommunityError("Write something first.", 400, "empty");
  }

  const post = await prisma.post.findFirst({
    where: { slug, publishedAt: { not: null } },
    select: { id: true },
  });
  if (!post) {
    throw new CommunityError("That post is not available.", 404, "not_found");
  }

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: { postId: post.id, userId: user.id, body: trimmed },
      select: {
        id: true,
        body: true,
        createdAt: true,
        user: {
          select: {
            handle: true,
            displayName: true,
            name: true,
            imageUrl: true,
          },
        },
      },
    });

    await tx.post.update({
      where: { id: post.id },
      data: { commentCount: { increment: 1 } },
    });

    return created;
  });

  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt.getTime(),
    author: toAuthor(comment.user, false),
    mine: true,
    deleted: false,
  };
}

/**
 * Delete a comment.
 *
 * The author of the comment **or** the author of the post. Somebody has to be
 * able to remove abuse from under their own work without waiting for us, and
 * there is no moderation queue staffed to do it for them.
 */
export async function deleteComment(id: string): Promise<void> {
  const user = await requireApiUser();

  const comment = await prisma.comment.findUnique({
    where: { id },
    select: { id: true, userId: true, postId: true, deletedAt: true },
  });

  if (!comment || comment.deletedAt) {
    throw new CommunityError("That comment was not found.", 404, "not_found");
  }

  const post = await prisma.post.findUnique({
    where: { id: comment.postId },
    select: { userId: true },
  });

  if (comment.userId !== user.id && post?.userId !== user.id) {
    throw new CommunityError(
      "You can only remove your own comments.",
      403,
      "forbidden",
    );
  }

  await prisma.$transaction([
    prisma.comment.update({
      where: { id },
      data: { deletedAt: new Date() },
    }),
    prisma.post.update({
      where: { id: comment.postId },
      data: { commentCount: { decrement: 1 } },
    }),
  ]);
}

/**
 * Report a comment.
 *
 * Sets a timestamp for a human to review. There is no automated moderation and
 * the interface says so — a report button that implies review nobody performs
 * is worse than no button, because it tells somebody the problem is handled.
 */
export async function reportComment(id: string): Promise<void> {
  await requireApiUser();

  const result = await prisma.comment.updateMany({
    where: { id, reportedAt: null },
    data: { reportedAt: new Date() },
  });

  if (result.count === 0) {
    // Already reported, or gone. Both are fine outcomes for the reporter and
    // neither is worth an error that invites them to try again.
    return;
  }
}

// --------------------------------------------------------------- follows ----

export async function setFollow(
  handle: string,
  following: boolean,
): Promise<{ following: boolean; followerCount: number }> {
  const user = await requireApiUser();

  const target = await prisma.user.findUnique({
    where: { handle: normaliseHandle(handle) },
    select: { id: true, followerCount: true },
  });

  if (!target) {
    throw new CommunityError("That profile was not found.", 404, "not_found");
  }
  if (target.id === user.id) {
    throw new CommunityError("You cannot follow yourself.", 400, "self_follow");
  }

  const count = await prisma.$transaction(async (tx) => {
    if (following) {
      const created = await tx.follow.createMany({
        data: { followerId: user.id, followingId: target.id },
        skipDuplicates: true,
      });
      if (created.count === 0) return target.followerCount;

      // Three counters, one transaction: the follow row, the target's
      // followers, the actor's following. Any two of the three without the
      // third is a number that will be wrong forever.
      const [updated] = await Promise.all([
        tx.user.update({
          where: { id: target.id },
          data: { followerCount: { increment: 1 } },
          select: { followerCount: true },
        }),
        tx.user.update({
          where: { id: user.id },
          data: { followingCount: { increment: 1 } },
        }),
      ]);
      return updated.followerCount;
    }

    const removed = await tx.follow.deleteMany({
      where: { followerId: user.id, followingId: target.id },
    });
    if (removed.count === 0) return target.followerCount;

    const [updated] = await Promise.all([
      tx.user.update({
        where: { id: target.id },
        data: { followerCount: { decrement: 1 } },
        select: { followerCount: true },
      }),
      tx.user.update({
        where: { id: user.id },
        data: { followingCount: { decrement: 1 } },
      }),
    ]);
    return Math.max(0, updated.followerCount);
  });

  return { following, followerCount: count };
}

// -------------------------------------------------------------- profiles ----

export async function getProfile(rawHandle: string): Promise<PublicProfile> {
  const viewer = await getCurrentUser();
  const handle = normaliseHandle(rawHandle);

  const row = await prisma.user.findUnique({
    where: { handle },
    select: {
      id: true,
      handle: true,
      displayName: true,
      name: true,
      imageUrl: true,
      bio: true,
      website: true,
      followerCount: true,
      followingCount: true,
      featuredAt: true,
      createdAt: true,
      _count: {
        select: { posts: { where: { publishedAt: { not: null } } } },
      },
    },
  });

  if (!row) {
    throw new CommunityError("That profile was not found.", 404, "not_found");
  }

  const following = viewer
    ? (await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: viewer.id,
            followingId: row.id,
          },
        },
        select: { followerId: true },
      })) !== null
    : false;

  return {
    ...toAuthor(row, following),
    bio: row.bio,
    website: row.website,
    followerCount: row.followerCount,
    followingCount: row.followingCount,
    postCount: row._count.posts,
    joinedAt: row.createdAt.getTime(),
    featured: row.featuredAt !== null,
    mine: viewer?.id === row.id,
  };
}

/**
 * Claim or change a handle.
 *
 * The uniqueness check and the write are not atomic, so the constraint is what
 * actually prevents a collision — the pre-check exists to produce a good
 * message, not to be the guard.
 */
export async function updateProfile(input: {
  handle?: string;
  displayName?: string | null;
  bio?: string | null;
  website?: string | null;
}): Promise<PublicProfile> {
  const user = await requireApiUser();

  let handle: string | undefined;
  if (input.handle !== undefined) {
    const problem = validateHandle(input.handle);
    if (problem) {
      throw new CommunityError(HANDLE_MESSAGES[problem], 400, problem);
    }
    handle = normaliseHandle(input.handle);
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(handle ? { handle } : {}),
        ...(input.displayName !== undefined
          ? { displayName: input.displayName?.trim() || null }
          : {}),
        ...(input.bio !== undefined ? { bio: input.bio?.trim() || null } : {}),
        ...(input.website !== undefined
          ? { website: normaliseWebsite(input.website) }
          : {}),
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CommunityError(
        "That handle is already taken.",
        409,
        "handle_taken",
      );
    }
    throw error;
  }

  const finalHandle = handle ?? user.handle;
  if (!finalHandle) {
    throw new CommunityError(
      "Choose a handle to create your public profile.",
      409,
      "handle_required",
    );
  }

  return getProfile(finalHandle);
}

/**
 * Featured creators.
 *
 * Editorial: `featuredAt` is set by us. Never derived from follower count,
 * because "we think this person's work is worth seeing" and "this person has
 * many followers" are different claims and merging them makes the first
 * meaningless.
 *
 * Returns an empty list until somebody has actually been featured. The
 * interface says so rather than quietly showing the most-followed accounts
 * under a heading that claims editorial judgement.
 */
export async function listFeaturedCreators(
  limit = 8,
): Promise<PublicProfile[]> {
  const viewer = await getCurrentUser();

  const rows = await prisma.user.findMany({
    where: { featuredAt: { not: null }, handle: { not: null } },
    orderBy: { featuredAt: "desc" },
    take: Math.min(limit, 24),
    select: {
      id: true,
      handle: true,
      displayName: true,
      name: true,
      imageUrl: true,
      bio: true,
      website: true,
      followerCount: true,
      followingCount: true,
      featuredAt: true,
      createdAt: true,
      _count: {
        select: { posts: { where: { publishedAt: { not: null } } } },
      },
    },
  });

  const context = await viewerContext(
    viewer?.id ?? null,
    [],
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    ...toAuthor(row, context.following.has(row.id)),
    bio: row.bio,
    website: row.website,
    followerCount: row.followerCount,
    followingCount: row.followingCount,
    postCount: row._count.posts,
    joinedAt: row.createdAt.getTime(),
    featured: true,
    mine: viewer?.id === row.id,
  }));
}

// ----------------------------------------------------- shared collections ---

/** Share a project publicly, or stop sharing it. */
export async function setCollectionShared(
  collectionId: string,
  shared: boolean,
): Promise<{ shared: boolean; publicSlug: string | null }> {
  const user = await requirePublisher();

  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, userId: user.id },
    select: { id: true, name: true, publicSlug: true },
  });

  if (!collection) {
    throw new CommunityError("That project was not found.", 404, "not_found");
  }

  if (!shared) {
    await prisma.collection.update({
      where: { id: collection.id },
      // The slug survives, so re-sharing restores the same URL rather than
      // breaking every link that was already sent.
      data: { sharedAt: null },
    });
    return { shared: false, publicSlug: collection.publicSlug };
  }

  const publicSlug =
    collection.publicSlug ??
    (await freeCollectionSlug(user.id, slugify(collection.name)));

  await prisma.collection.update({
    where: { id: collection.id },
    data: { sharedAt: new Date(), publicSlug },
  });

  return { shared: true, publicSlug };
}

/**
 * A shared project, as the public sees it.
 *
 * **Only published assets.** Sharing a project does not publish everything
 * inside it — the two decisions are separate, and a collection that leaked
 * unpublished work would be the single worst bug in this file. The intersection
 * is a join condition here, not a filter somebody has to remember downstream.
 */
export async function getSharedCollection(
  rawHandle: string,
  publicSlug: string,
): Promise<{ collection: PublicCollection; posts: PublicPost[] }> {
  const viewer = await getCurrentUser();
  const handle = normaliseHandle(rawHandle);

  const collection = await prisma.collection.findFirst({
    where: {
      publicSlug,
      sharedAt: { not: null },
      user: { handle },
    },
    select: {
      id: true,
      name: true,
      description: true,
      sharedAt: true,
      userId: true,
      user: {
        select: { handle: true, displayName: true, name: true, imageUrl: true },
      },
    },
  });

  if (!collection) {
    throw new CommunityError("That project is not shared.", 404, "not_found");
  }

  const rows = await prisma.post.findMany({
    where: {
      publishedAt: { not: null },
      userId: collection.userId,
      asset: {
        deletedAt: null,
        collections: { some: { collectionId: collection.id } },
      },
    },
    orderBy: { publishedAt: "desc" },
    take: 60,
    select: POST_SELECT,
  });

  const context = await viewerContext(
    viewer?.id ?? null,
    rows.map((row) => row.slug),
    [collection.userId, ...rows.map((row) => row.userId)],
  );

  return {
    collection: {
      slug: publicSlug,
      name: collection.name,
      description: collection.description,
      sharedAt: collection.sharedAt?.getTime() ?? 0,
      author: toAuthor(
        collection.user,
        context.following.has(collection.userId),
      ),
      postCount: rows.length,
    },
    posts: rows.map((row) => shapePost(row, viewer?.id ?? null, context)),
  };
}

// --------------------------------------------------------------- helpers ----

async function freeCollectionSlug(
  userId: string,
  base: string,
): Promise<string> {
  const taken = await prisma.collection.findMany({
    where: { userId, publicSlug: { startsWith: base } },
    // Only used to find the first free `base-N` suffix, so the bound is the
    // number of collisions worth resolving. Past 500 the caller gets a random
    // suffix instead, which is correct behaviour and not worth a scan.
    take: 500,
    select: { publicSlug: true },
  });

  const used = new Set(taken.map((row) => row.publicSlug));
  if (!used.has(base)) return base;

  let counter = 2;
  while (used.has(`${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}

/**
 * Accept a bare domain, store an absolute URL, and refuse anything that is not
 * http(s).
 *
 * `javascript:` in a profile field that a page renders as a link is stored XSS
 * with extra steps. Parsing and re-serialising is what makes the scheme check
 * reliable — a string comparison against "javascript:" misses
 * `java\tscript:` and a dozen other encodings.
 */
function normaliseWebsite(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
