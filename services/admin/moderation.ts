import "server-only";

import { prisma } from "@/lib/prisma";
import { AdminError, audit, requireAdmin } from "@/services/admin/auth";

/**
 * Moderation.
 *
 * Sprint 11 shipped a report button and said plainly that a person would look
 * at what it queued. This is that person's screen — building the button without
 * it would have made the promise false.
 *
 * ## Dismissing is an outcome, not a no-op
 *
 * "Reviewed, nothing wrong" is a decision worth recording. Clearing
 * `reportedAt` without a log would make a dismissed report indistinguishable
 * from one nobody ever saw, and the difference matters the second time the same
 * comment is reported.
 *
 * ## Removal is the existing soft delete
 *
 * Same tombstone the author's own delete produces, so the thread reads the same
 * either way and nothing in the public view has to know a moderator was
 * involved.
 */

export interface ReportedComment {
  id: string;
  body: string;
  createdAt: number;
  reportedAt: number;
  author: { id: string; email: string; handle: string | null };
  post: { slug: string; caption: string | null; authorHandle: string | null };
}

export async function listReported(limit = 50): Promise<ReportedComment[]> {
  await requireAdmin();

  const rows = await prisma.comment.findMany({
    where: { reportedAt: { not: null }, deletedAt: null },
    orderBy: { reportedAt: "asc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      body: true,
      createdAt: true,
      reportedAt: true,
      user: { select: { id: true, email: true, handle: true } },
      post: {
        select: {
          slug: true,
          caption: true,
          user: { select: { handle: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.getTime(),
    // Non-null by the `where`, but the type does not know that.
    reportedAt: row.reportedAt?.getTime() ?? 0,
    author: row.user,
    post: {
      slug: row.post.slug,
      caption: row.post.caption,
      authorHandle: row.post.user.handle,
    },
  }));
}

/** Oldest first, so nothing rots at the bottom of the queue. */
export async function resolveReport(input: {
  commentId: string;
  action: "remove" | "dismiss";
  reason: string;
}): Promise<{ resolved: true }> {
  const actor = await requireAdmin();

  if (!input.reason.trim()) {
    throw new AdminError("State a reason.", 400, "reason_required");
  }

  const comment = await prisma.comment.findUnique({
    where: { id: input.commentId },
    select: { id: true, postId: true, userId: true, deletedAt: true },
  });

  if (!comment || comment.deletedAt) {
    throw new AdminError("That comment is not in the queue.", 404, "not_found");
  }

  await prisma.$transaction(async (tx) => {
    if (input.action === "remove") {
      await tx.comment.update({
        where: { id: comment.id },
        data: { deletedAt: new Date(), reportedAt: null },
      });
      await tx.post.update({
        where: { id: comment.postId },
        data: { commentCount: { decrement: 1 } },
      });
    } else {
      await tx.comment.update({
        where: { id: comment.id },
        data: { reportedAt: null },
      });
    }

    await audit(
      actor,
      {
        action: `moderation.${input.action}`,
        subjectType: "comment",
        subjectId: comment.id,
        detail: { authorId: comment.userId },
        reason: input.reason.trim(),
      },
      tx,
    );
  });

  return { resolved: true };
}

/**
 * Take a post out of the public gallery.
 *
 * Sets `publishedAt = null` — the same take-down the author can perform, so the
 * post, its caption and its engagement survive. A moderator removing something
 * permanently would destroy other people's comments as collateral.
 */
export async function unpublishPost(input: {
  slug: string;
  reason: string;
}): Promise<{ unpublished: true }> {
  const actor = await requireAdmin();

  if (!input.reason.trim()) {
    throw new AdminError("State a reason.", 400, "reason_required");
  }

  const post = await prisma.post.findUnique({
    where: { slug: input.slug },
    select: { id: true, userId: true, publishedAt: true },
  });

  if (!post || !post.publishedAt) {
    throw new AdminError("That post is not published.", 404, "not_found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.post.update({
      where: { id: post.id },
      data: { publishedAt: null },
    });

    await audit(
      actor,
      {
        action: "moderation.unpublish",
        subjectType: "post",
        subjectId: input.slug,
        detail: { authorId: post.userId },
        reason: input.reason.trim(),
      },
      tx,
    );
  });

  return { unpublished: true };
}

/** Feature or unfeature a post. Editorial, and recorded like any other act. */
export async function setFeatured(input: {
  slug: string;
  featured: boolean;
  reason: string;
}): Promise<{ featured: boolean }> {
  const actor = await requireAdmin();

  const result = await prisma.post.updateMany({
    where: { slug: input.slug, publishedAt: { not: null } },
    data: { featuredAt: input.featured ? new Date() : null },
  });

  if (result.count === 0) {
    throw new AdminError("That post is not published.", 404, "not_found");
  }

  await audit(actor, {
    action: "moderation.feature",
    subjectType: "post",
    subjectId: input.slug,
    detail: { featured: input.featured },
    reason: input.reason.trim() || undefined,
  });

  return { featured: input.featured };
}
