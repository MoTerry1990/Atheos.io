import "server-only";

import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProjectError, createProject } from "@/services/projects";

/**
 * Collections — what the interface calls **projects** — as the *studio* needs
 * them: list the ones a result can be filed into, create one inline, file a
 * result. Everything else about a project lives in `services/projects.ts`.
 *
 * Split by caller rather than by entity, deliberately. The studio's needs here
 * are narrow and unlikely to change; handing it the management surface would
 * put rename, archive and delete one import away from a dropdown whose only job
 * is to save a picture.
 *
 * A named group of assets. The schema has carried `Collection` and the join
 * table since Sprint 0, and the generation pipeline has been able to file
 * results into one since Sprint 6, but nothing could create one — so the
 * feature existed everywhere except where a user could reach it. This closes
 * that.
 *
 * ## Why a join table and not a folder
 *
 * An asset belongs to as many projects as the user likes. A clip generated for
 * a client pitch is also in "things that worked"; a still is in a moodboard and
 * in the sequence it was cut from. A parent-id column would force a choice that
 * has no correct answer and would make "add to a second project" a copy.
 *
 * ## Ownership is checked on every call, not assumed
 *
 * Each function starts from the signed-in user and filters by `userId` in the
 * same query that finds the row. Fetching first and comparing afterwards is the
 * same logic with one more place to forget it.
 */

export class CollectionError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly code: string = "invalid_request",
  ) {
    super(message);
    this.name = "CollectionError";
  }
}

export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  assetCount: number;
  updatedAt: number;
}

/**
 * This user's projects, most recently touched first.
 *
 * `_count` rather than loading the join rows: the picker shows a number, and
 * fetching every membership to call `.length` on it would read the whole
 * library to render a dropdown.
 */
export async function listCollections(): Promise<CollectionSummary[]> {
  const user = await requireApiUser();

  const rows = await prisma.collection.findMany({
    // Archived projects are excluded. Archiving means "stop showing me this",
    // and a picker that keeps offering one has not honoured that.
    where: { userId: user.id, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    // This feeds the studio's save-to-project picker — a dropdown. Ordered by
    // most recently touched, so the bound removes exactly the projects a user
    // is least likely to be saving into right now.
    take: 100,
    select: {
      id: true,
      name: true,
      description: true,
      updatedAt: true,
      _count: { select: { assets: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    assetCount: row._count.assets,
    updatedAt: row.updatedAt.getTime(),
  }));
}

/**
 * Create a project from the studio's inline field.
 *
 * Delegates to `services/projects.ts` rather than issuing its own insert, so
 * there is one definition of what a new project is. Two inserts would have been
 * two places to forget a default — and the projects page and the studio would
 * quietly produce different rows.
 *
 * `ProjectError` is re-wrapped as a `CollectionError` so this module's callers
 * still see one error type. The status and code pass through unchanged, which
 * is what the API route actually reads.
 */
export async function createCollection(input: {
  name: string;
  description?: string;
}): Promise<CollectionSummary> {
  try {
    const project = await createProject(input);
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      assetCount: project.assetCount,
      updatedAt: project.updatedAt,
    };
  } catch (error) {
    if (error instanceof ProjectError) {
      throw new CollectionError(error.message, error.status, error.code);
    }
    throw error;
  }
}

/**
 * File assets into a project.
 *
 * ## Both sides are checked
 *
 * The collection must be this user's, and so must every asset. Checking only
 * the collection would let someone add another user's asset to their own
 * project — which does not expose the file (the id is needed to name it) but
 * does put a row in our database claiming a relationship that should not exist.
 *
 * ## Duplicates are skipped, not an error
 *
 * `createMany({ skipDuplicates })` against the composite primary key. Saving
 * something twice is a thing people do, and the second attempt should be a
 * no-op rather than a red banner about a constraint they have never heard of.
 */
export async function addAssetsToCollection(
  collectionId: string,
  assetIds: string[],
): Promise<{ added: number; assetCount: number }> {
  const user = await requireApiUser();

  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, userId: user.id },
    select: { id: true },
  });
  if (!collection) {
    throw new CollectionError("That project was not found.", 404, "not_found");
  }

  const owned = await prisma.asset.findMany({
    where: { id: { in: assetIds }, userId: user.id, deletedAt: null },
    select: { id: true },
  });
  if (owned.length === 0) {
    throw new CollectionError(
      "None of those results could be saved.",
      404,
      "not_found",
    );
  }

  const result = await prisma.collectionAsset.createMany({
    data: owned.map((asset) => ({ collectionId, assetId: asset.id })),
    skipDuplicates: true,
  });

  // Touch the collection so "most recently used" in the picker means what it
  // says. `updatedAt` only moves on its own when a column changes, and adding a
  // membership changes no column on this row.
  const updated = await prisma.collection.update({
    where: { id: collectionId },
    data: { updatedAt: new Date() },
    select: { _count: { select: { assets: true } } },
  });

  return { added: result.count, assetCount: updated._count.assets };
}
