import "server-only";

import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/prisma-errors";

/**
 * Projects and folders.
 *
 * `Collection` in storage, **project** everywhere a user can see. The storage
 * name predates the product language and renaming it would be a migration that
 * buys nothing; the seam is here, in one file, rather than scattered as an
 * inconsistency across the interface.
 *
 * `services/collections.ts` holds the two operations the *studio* needs — list
 * and file-a-result. This file holds management: everything reachable from the
 * projects page. They are split by caller rather than by entity because the
 * studio's needs are narrow and stable, and giving it the whole management
 * surface would let a picker delete something.
 *
 * ## Deleting a project never deletes work
 *
 * The most destructive mistake this codebase could make is having "delete
 * project" remove generations. It does not, and neither does deleting a folder.
 * Both cascade only across the join rows that describe membership:
 *
 *   delete folder   → its projects become unfiled  (`onDelete: SetNull`)
 *   delete project  → its memberships go, assets stay  (`onDelete: Cascade`
 *                     on CollectionAsset, which *is* the membership)
 *
 * Archive exists so that "make this go away" has an answer that is not
 * deletion, which is what makes a hard delete acceptable for the case where
 * someone genuinely means it.
 *
 * ## Ownership is a filter, not a check
 *
 * Every query carries `userId` in its `where`. Fetching a row and comparing
 * afterwards is the same logic with one more place to forget it.
 */

export class ProjectError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly code: string = "invalid_request",
  ) {
    super(message);
    this.name = "ProjectError";
  }
}

// ---------------------------------------------------------------- shapes ---

export interface FolderSummary {
  id: string;
  name: string;
  hue: number;
  /** What opening the folder would show — archived projects excluded. */
  projectCount: number;
  /**
   * Everything inside, archived included.
   *
   * Two counts because they answer different questions and using one for both
   * produces a visible contradiction: the delete confirmation would promise to
   * unfile two projects and the result would report three. The badge is about
   * what you would see; this is about what would move.
   */
  totalCount: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  hue: number;
  folderId: string | null;
  isFavorite: boolean;
  isArchived: boolean;
  assetCount: number;
  /** Storage key of the cover, resolved to a URL on the client. */
  coverKey: string | null;
  /** The cover's asset id. Carried alongside the key so the detail view can
   *  mark which tile is currently the cover without a second lookup. */
  coverAssetId: string | null;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
}

export interface ProjectDetail extends ProjectSummary {
  notes: string | null;
  assets: {
    id: string;
    storageKey: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    sizeBytes: number;
    addedAt: number;
  }[];
  /** Summed from the assets, so the metadata panel needs no second query. */
  totalBytes: number;
}

export type ProjectView = "all" | "recent" | "favorites" | "archived";

// --------------------------------------------------------------- folders ---

export async function listFolders(): Promise<FolderSummary[]> {
  const user = await requireApiUser();

  // Two queries rather than one, because a relation can carry only one
  // `_count` and these two need different filters. A `groupBy` over the whole
  // rail is one round trip regardless of how many folders there are — far
  // cheaper than selecting every project id to count them in memory.
  const [rows, visible] = await Promise.all([
    prisma.folder.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      // A rail, not a list. Nobody navigates 500 folders from a sidebar, and an
      // unbounded query here is one row per folder on every projects page load.
      take: 200,
      select: {
        id: true,
        name: true,
        hue: true,
        _count: { select: { projects: true } },
      },
    }),
    prisma.collection.groupBy({
      by: ["folderId"],
      where: { userId: user.id, folderId: { not: null }, archivedAt: null },
      _count: { _all: true },
    }),
  ]);

  const visibleByFolder = new Map(
    visible.map((group) => [group.folderId, group._count._all]),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    hue: row.hue,
    projectCount: visibleByFolder.get(row.id) ?? 0,
    totalCount: row._count.projects,
  }));
}

export async function createFolder(input: {
  name: string;
  hue?: number;
}): Promise<FolderSummary> {
  const user = await requireApiUser();

  const name = input.name.trim();
  if (!name)
    throw new ProjectError("A folder needs a name.", 400, "invalid_name");

  try {
    const created = await prisma.folder.create({
      data: { userId: user.id, name, hue: input.hue ?? 268 },
      select: { id: true, name: true, hue: true },
    });
    return { ...created, projectCount: 0, totalCount: 0 };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ProjectError(
        `You already have a folder called “${name}”.`,
        409,
        "duplicate_name",
      );
    }
    throw error;
  }
}

export async function updateFolder(
  id: string,
  patch: { name?: string; hue?: number },
): Promise<FolderSummary> {
  const user = await requireApiUser();

  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) {
    throw new ProjectError("A folder needs a name.", 400, "invalid_name");
  }

  // `updateMany` scoped by userId rather than `update` by id: it makes
  // ownership part of the write itself, so there is no window between checking
  // and updating.
  try {
    const result = await prisma.folder.updateMany({
      where: { id, userId: user.id },
      data: {
        ...(name ? { name } : {}),
        ...(patch.hue !== undefined ? { hue: patch.hue } : {}),
      },
    });
    if (result.count === 0) {
      throw new ProjectError("That folder was not found.", 404, "not_found");
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ProjectError(
        `You already have a folder called “${name}”.`,
        409,
        "duplicate_name",
      );
    }
    throw error;
  }

  const folders = await listFolders();
  const folder = folders.find((entry) => entry.id === id);
  if (!folder)
    throw new ProjectError("That folder was not found.", 404, "not_found");
  return folder;
}

/**
 * Delete a folder. Its projects survive, unfiled.
 *
 * The schema does this with `onDelete: SetNull`, so it holds even for a delete
 * issued outside this function — a psql session, a future admin tool. A rule
 * enforced only in application code is a rule that is one script away from
 * being broken.
 */
export async function deleteFolder(id: string): Promise<{ unfiled: number }> {
  const user = await requireApiUser();

  const unfiled = await prisma.collection.count({
    where: { folderId: id, userId: user.id },
  });

  const result = await prisma.folder.deleteMany({
    where: { id, userId: user.id },
  });
  if (result.count === 0) {
    throw new ProjectError("That folder was not found.", 404, "not_found");
  }

  return { unfiled };
}

// -------------------------------------------------------------- projects ---

const SUMMARY_SELECT = {
  id: true,
  name: true,
  description: true,
  tags: true,
  hue: true,
  folderId: true,
  isFavorite: true,
  archivedAt: true,
  coverAssetId: true,
  createdAt: true,
  updatedAt: true,
  lastOpenedAt: true,
  _count: { select: { assets: true } },
} as const;

type SummaryRow = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  hue: number;
  folderId: string | null;
  isFavorite: boolean;
  archivedAt: Date | null;
  coverAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastOpenedAt: Date | null;
  _count: { assets: number };
};

function toSummary(row: SummaryRow, coverKey: string | null): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tags: row.tags,
    hue: row.hue,
    folderId: row.folderId,
    isFavorite: row.isFavorite,
    isArchived: row.archivedAt !== null,
    assetCount: row._count.assets,
    coverKey,
    coverAssetId: row.coverAssetId,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    lastOpenedAt: row.lastOpenedAt?.getTime() ?? null,
  };
}

/**
 * Resolve cover images for a page of projects in one query.
 *
 * The obvious implementation looks up each cover inside the map, which is a
 * query per card — twenty-four round trips to render a grid. One `IN` is the
 * difference between a page that loads and a page that feels broken.
 */
async function coverKeysFor(
  rows: SummaryRow[],
  userId: string,
): Promise<Map<string, string>> {
  const ids = rows
    .map((row) => row.coverAssetId)
    .filter((id): id is string => Boolean(id));

  if (ids.length === 0) return new Map();

  const assets = await prisma.asset.findMany({
    where: { id: { in: ids }, userId, deletedAt: null },
    select: { id: true, storageKey: true },
  });

  return new Map(assets.map((asset) => [asset.id, asset.storageKey]));
}

/**
 * List projects for a view.
 *
 * ## Archived is a view, not a filter you can forget
 *
 * Every view except `archived` excludes archived projects, and `archived` shows
 * only them. Making it a property of the view rather than an optional flag is
 * what stops an archived project reappearing in a search — which is precisely
 * the thing archiving was meant to prevent.
 *
 * ## Search covers name, description and tags
 *
 * Case-insensitive `contains`, which is a sequential scan. Correct at the scale
 * a person's own project list reaches; a trigram index or full-text search is
 * the answer if that ever stops being true, and both are additive.
 */
export async function listProjects(
  options: {
    view?: ProjectView;
    folderId?: string | null;
    search?: string;
    limit?: number;
  } = {},
): Promise<ProjectSummary[]> {
  const user = await requireApiUser();

  const view = options.view ?? "all";
  const search = options.search?.trim();

  const rows = (await prisma.collection.findMany({
    where: {
      userId: user.id,
      ...(view === "archived"
        ? { archivedAt: { not: null } }
        : { archivedAt: null }),
      ...(view === "favorites" ? { isFavorite: true } : {}),
      ...(view === "recent" ? { lastOpenedAt: { not: null } } : {}),
      ...(options.folderId !== undefined ? { folderId: options.folderId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              {
                description: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              // Postgres array containment. Exact per element, so this matches
              // a whole tag rather than part of one — which is what a tag is.
              { tags: { has: search.toLowerCase() } },
            ],
          }
        : {}),
    },
    orderBy:
      view === "recent"
        ? { lastOpenedAt: "desc" }
        : view === "archived"
          ? { archivedAt: "desc" }
          : [{ isFavorite: "desc" }, { updatedAt: "desc" }],
    take: options.limit ?? 200,
    select: SUMMARY_SELECT,
  })) as SummaryRow[];

  const covers = await coverKeysFor(rows, user.id);

  return rows.map((row) =>
    toSummary(
      row,
      row.coverAssetId ? (covers.get(row.coverAssetId) ?? null) : null,
    ),
  );
}

/**
 * Create a project.
 *
 * The one definition of what a new project is. `services/collections.ts`
 * delegates here rather than issuing its own insert, so the studio's inline
 * "new project" and the projects page produce identical rows — including the
 * folder-ownership check, which an inline create would have been an easy place
 * to omit.
 */
export async function createProject(input: {
  name: string;
  description?: string;
  folderId?: string;
}): Promise<ProjectSummary> {
  const user = await requireApiUser();

  const name = input.name.trim();
  if (!name)
    throw new ProjectError("A project needs a name.", 400, "invalid_name");

  if (input.folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: input.folderId, userId: user.id },
      select: { id: true },
    });
    if (!folder) {
      throw new ProjectError("That folder was not found.", 404, "not_found");
    }
  }

  try {
    const created = await prisma.collection.create({
      data: {
        userId: user.id,
        name,
        description: input.description?.trim() || null,
        folderId: input.folderId ?? null,
      },
      select: SUMMARY_SELECT,
    });

    return toSummary(created as SummaryRow, null);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ProjectError(
        `You already have a project called “${name}”.`,
        409,
        "duplicate_name",
      );
    }
    throw error;
  }
}

/**
 * One project, with its assets.
 *
 * `markOpened` makes a read write, which is normally worth resisting. It earns
 * it here: "Recent" has to mean *recently opened*, and the alternatives are a
 * second round trip on every navigation, or reusing `updatedAt` — which moves
 * when a bulk archive touches the row, and would fill Recent with projects
 * nobody looked at.
 */
export async function getProject(
  id: string,
  options: { markOpened?: boolean } = {},
): Promise<ProjectDetail> {
  const user = await requireApiUser();

  const row = (await prisma.collection.findFirst({
    where: { id, userId: user.id },
    select: { ...SUMMARY_SELECT, notes: true },
  })) as (SummaryRow & { notes: string | null }) | null;

  if (!row)
    throw new ProjectError("That project was not found.", 404, "not_found");

  const memberships = await prisma.collectionAsset.findMany({
    where: { collectionId: id, asset: { deletedAt: null } },
    orderBy: { addedAt: "desc" },
    // The detail page renders every asset it is given, so an unbounded query
    // here was two problems at once: a query proportional to project size, and
    // a DOM proportional to it. A project with 10,000 generations would have
    // loaded all 10,000 rows and rendered 10,000 tiles.
    //
    // 500 is a ceiling, not pagination — that is the honest description. The
    // detail view has no "load more", so a project past this shows its 500
    // most recent assets. Cursor pagination here is follow-up work; a bounded
    // page that renders is better than an unbounded one that does not.
    take: 500,
    select: {
      addedAt: true,
      asset: {
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          durationMs: true,
          sizeBytes: true,
        },
      },
    },
  });

  if (options.markOpened) {
    // Not awaited into the response and deliberately tolerant of failure:
    // "recently opened" bookkeeping must never be the reason a project fails
    // to open.
    await prisma.collection
      .update({ where: { id }, data: { lastOpenedAt: new Date() } })
      .catch(() => undefined);
  }

  const covers = await coverKeysFor([row], user.id);

  return {
    ...toSummary(
      row,
      row.coverAssetId ? (covers.get(row.coverAssetId) ?? null) : null,
    ),
    notes: row.notes,
    assets: memberships.map((membership) => ({
      ...membership.asset,
      addedAt: membership.addedAt.getTime(),
    })),
    totalBytes: memberships.reduce(
      (total, membership) => total + membership.asset.sizeBytes,
      0,
    ),
  };
}

export interface ProjectPatch {
  name?: string;
  description?: string | null;
  notes?: string | null;
  tags?: string[];
  hue?: number;
  coverAssetId?: string | null;
  folderId?: string | null;
  isFavorite?: boolean;
  archived?: boolean;
}

/**
 * Update a project.
 *
 * One function for rename, metadata, favourite, archive and move, because they
 * are one row and the autosaving editor sends whichever fields changed. Five
 * endpoints would mean five round trips for one edit and five places to repeat
 * the ownership filter.
 *
 * References to other rows — the folder, the cover asset — are verified to
 * belong to this user before they are written. Without that, a crafted request
 * could file a project into someone else's folder.
 */
export async function updateProject(
  id: string,
  patch: ProjectPatch,
): Promise<ProjectSummary> {
  const user = await requireApiUser();

  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) {
    throw new ProjectError("A project needs a name.", 400, "invalid_name");
  }

  if (patch.folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: patch.folderId, userId: user.id },
      select: { id: true },
    });
    if (!folder) {
      throw new ProjectError("That folder was not found.", 404, "not_found");
    }
  }

  if (patch.coverAssetId) {
    const asset = await prisma.asset.findFirst({
      where: { id: patch.coverAssetId, userId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!asset) {
      throw new ProjectError(
        "That cover image was not found.",
        404,
        "not_found",
      );
    }
  }

  try {
    const result = await prisma.collection.updateMany({
      where: { id, userId: user.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description || null }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes || null } : {}),
        // Normalised and de-duplicated here rather than trusted: tags are
        // matched exactly, so "Client" and "client" being different tags would
        // make search quietly useless.
        ...(patch.tags !== undefined
          ? { tags: normaliseTags(patch.tags) }
          : {}),
        ...(patch.hue !== undefined ? { hue: clampHue(patch.hue) } : {}),
        ...(patch.coverAssetId !== undefined
          ? { coverAssetId: patch.coverAssetId }
          : {}),
        ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
        ...(patch.isFavorite !== undefined
          ? { isFavorite: patch.isFavorite }
          : {}),
        ...(patch.archived !== undefined
          ? { archivedAt: patch.archived ? new Date() : null }
          : {}),
      },
    });

    if (result.count === 0) {
      throw new ProjectError("That project was not found.", 404, "not_found");
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ProjectError(
        `You already have a project called “${name}”.`,
        409,
        "duplicate_name",
      );
    }
    throw error;
  }

  return (await listProjectsById(id, user.id))!;
}

/**
 * Duplicate a project.
 *
 * Copies the row and its **memberships**, not the files. An asset already
 * belongs to as many projects as the user likes, so copying bytes would double
 * their storage bill to express something the join table already expresses.
 *
 * The name is generated rather than asked for, because `(userId, name)` is
 * unique and a dialog that rejects the obvious answer — "Copy of X", which
 * already exists after the second duplicate — is a worse experience than
 * picking a free name and letting them rename it.
 */
export async function duplicateProject(id: string): Promise<ProjectSummary> {
  const user = await requireApiUser();

  const source = await prisma.collection.findFirst({
    where: { id, userId: user.id },
    select: {
      name: true,
      description: true,
      notes: true,
      tags: true,
      hue: true,
      coverAssetId: true,
      folderId: true,
      assets: { select: { assetId: true } },
    },
  });

  if (!source) {
    throw new ProjectError("That project was not found.", 404, "not_found");
  }

  const name = await freeName(user.id, source.name);

  const created = await prisma.$transaction(async (tx) => {
    const copy = await tx.collection.create({
      data: {
        userId: user.id,
        name,
        description: source.description,
        notes: source.notes,
        tags: source.tags,
        hue: source.hue,
        coverAssetId: source.coverAssetId,
        folderId: source.folderId,
        // Not favourited and not "recent": a copy is new work, and inheriting a
        // star would put something nobody has looked at at the top of the list.
      },
      select: { id: true },
    });

    if (source.assets.length > 0) {
      await tx.collectionAsset.createMany({
        data: source.assets.map((membership) => ({
          collectionId: copy.id,
          assetId: membership.assetId,
        })),
      });
    }

    return copy;
  });

  return (await listProjectsById(created.id, user.id))!;
}

/**
 * Delete a project. The work inside it survives.
 *
 * `CollectionAsset` cascades, which removes the *membership* rows and nothing
 * else — the assets keep their own rows, their files and their place in any
 * other project. Archiving exists for the far more common "I don't want to see
 * this" case, which is why this one is allowed to be permanent.
 */
export async function deleteProject(
  id: string,
): Promise<{ id: string; name: string }> {
  const user = await requireApiUser();

  const project = await prisma.collection.findFirst({
    where: { id, userId: user.id },
    select: { id: true, name: true },
  });
  if (!project) {
    throw new ProjectError("That project was not found.", 404, "not_found");
  }

  await prisma.collection.delete({ where: { id } });
  return project;
}

/** Remove results from a project without deleting them. */
export async function removeAssetsFromProject(
  id: string,
  assetIds: string[],
): Promise<{ removed: number }> {
  const user = await requireApiUser();

  const project = await prisma.collection.findFirst({
    where: { id, userId: user.id },
    select: { id: true, coverAssetId: true },
  });
  if (!project) {
    throw new ProjectError("That project was not found.", 404, "not_found");
  }

  const result = await prisma.collectionAsset.deleteMany({
    where: { collectionId: id, assetId: { in: assetIds } },
  });

  // A cover that is no longer in the project would render a card showing an
  // image the project does not contain.
  if (project.coverAssetId && assetIds.includes(project.coverAssetId)) {
    await prisma.collection.update({
      where: { id },
      data: { coverAssetId: null },
    });
  }

  return { removed: result.count };
}

// --------------------------------------------------------------- helpers ---

async function listProjectsById(
  id: string,
  userId: string,
): Promise<ProjectSummary | null> {
  const row = (await prisma.collection.findFirst({
    where: { id, userId },
    select: SUMMARY_SELECT,
  })) as SummaryRow | null;

  if (!row) return null;

  const covers = await coverKeysFor([row], userId);
  return toSummary(
    row,
    row.coverAssetId ? (covers.get(row.coverAssetId) ?? null) : null,
  );
}

/**
 * The first free "<base> (copy)", "<base> (copy 2)", …
 *
 * One query for every name already starting with the base, then a search
 * through them in memory. The alternative — insert, catch the constraint,
 * increment, retry — issues an unbounded number of failing writes, and each
 * failure aborts a transaction.
 */
async function freeName(userId: string, base: string): Promise<string> {
  const existing = await prisma.collection.findMany({
    // Same bound and same reasoning as the public-slug check in
    // services/community: this only needs enough rows to pick a free suffix.
    take: 500,
    where: { userId, name: { startsWith: base } },
    select: { name: true },
  });

  const taken = new Set(existing.map((row) => row.name));

  let candidate = `${base} (copy)`;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base} (copy ${counter})`;
    counter += 1;
  }

  // The name column is unbounded in Postgres but a 400-character project name
  // is nobody's intention; truncating the base keeps repeated duplication from
  // growing a name without limit.
  return candidate.length > 120
    ? `${base.slice(0, 100)} (copy ${counter - 1})`
    : candidate;
}

function normaliseTags(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20),
    ),
  );
}

function clampHue(hue: number): number {
  return ((Math.round(hue) % 360) + 360) % 360;
}
