import "server-only";

import { getCurrentUser, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CATALOGUE, itemFor } from "@/services/marketplace/catalogue";
import type { MarketplaceItem } from "@/services/marketplace/types";
import type { MarketplaceKind } from "@/lib/generated/prisma/enums";

/**
 * The marketplace.
 *
 * ## Filtering happens in memory, and that is the right call
 *
 * The catalogue is a code array of a few dozen items. Loading it into Postgres
 * so it could be `WHERE`d would add a seed step to every environment and a
 * migration to every copy edit, to make a linear scan over sixteen objects
 * marginally faster. When third-party publishing arrives and the catalogue is
 * genuinely a table, this function changes and its signature does not.
 *
 * Only the per-user facts — favourites and installs — are database rows, and
 * those are read with one query each rather than one per card.
 *
 * ## Installing copies the payload
 *
 * An install stores a snapshot rather than a reference. Editing a pack in the
 * repository must not silently change work somebody has already built on: a
 * prompt that shifts under a user is worse than one that is out of date. The
 * snapshot is what makes "update available" a thing the interface can offer
 * rather than something that happens to them.
 */

export class MarketplaceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly code: string = "invalid_request",
  ) {
    super(message);
    this.name = "MarketplaceError";
  }
}

export type MarketplaceView = "all" | "favorites" | "installed";

export interface MarketplaceListing extends MarketplaceItem {
  favorited: boolean;
  installed: boolean;
  /** Set when the catalogue has moved on since this was installed. */
  updateAvailable: boolean;
}

/**
 * Browse.
 *
 * Search covers title, summary, description and tags. Sequential and
 * case-insensitive, which is correct over a catalogue this size — and the
 * moment it is not, the fix is an index rather than a different design.
 */
export async function listItems(
  options: {
    kind?: MarketplaceKind;
    category?: string;
    search?: string;
    view?: MarketplaceView;
  } = {},
): Promise<MarketplaceListing[]> {
  // Browsing is public. Signing in adds favourites and installs to the result,
  // it is not a condition of seeing what is on offer — a marketplace nobody can
  // look at before registering is a marketplace nobody registers for.
  const user = await getCurrentUser();

  const [favorites, installs] = user
    ? await Promise.all([
        prisma.marketplaceFavorite.findMany({
          where: { userId: user.id },
          select: { itemSlug: true },
        }),
        prisma.marketplaceInstall.findMany({
          where: { userId: user.id },
          select: { itemSlug: true, snapshot: true },
        }),
      ])
    : [[], []];

  const favoriteSlugs = new Set(favorites.map((row) => row.itemSlug));
  const installedBySlug = new Map(
    installs.map((row) => [row.itemSlug, row.snapshot]),
  );

  const query = options.search?.trim().toLowerCase();

  return CATALOGUE.filter((item) => {
    if (options.kind && item.kind !== options.kind) return false;
    if (options.category && item.category !== options.category) return false;

    if (options.view === "favorites" && !favoriteSlugs.has(item.slug)) {
      return false;
    }
    if (options.view === "installed" && !installedBySlug.has(item.slug)) {
      return false;
    }

    if (query) {
      const haystack = [
        item.title,
        item.summary,
        item.description,
        item.category,
        ...item.tags,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  }).map((item) => ({
    ...item,
    favorited: favoriteSlugs.has(item.slug),
    installed: installedBySlug.has(item.slug),
    updateAvailable: installedBySlug.has(item.slug)
      ? !sameSnapshot(installedBySlug.get(item.slug), item.payload)
      : false,
  }));
}

/**
 * One item, with this user's favourite and install state.
 *
 * Built from `listItems` rather than duplicating the enrichment. Over a
 * catalogue this size the filter is free, and the alternative is two places
 * that decide what `updateAvailable` means.
 */
export async function getItem(slug: string): Promise<MarketplaceListing> {
  const found = (await listItems()).find((entry) => entry.slug === slug);

  if (!found) {
    throw new MarketplaceError("That item does not exist.", 404, "not_found");
  }

  return found;
}

/** Add or remove a favourite. Returns the state it ended in. */
export async function setFavorite(
  slug: string,
  favorited: boolean,
): Promise<{ favorited: boolean }> {
  const user = await requireApiUser();

  if (!itemFor(slug)) {
    throw new MarketplaceError("That item does not exist.", 404, "not_found");
  }

  if (favorited) {
    // Upsert rather than create: favouriting something already favourited is a
    // double-click, not an error worth showing anyone.
    await prisma.marketplaceFavorite.upsert({
      where: { userId_itemSlug: { userId: user.id, itemSlug: slug } },
      create: { userId: user.id, itemSlug: slug },
      update: {},
    });
  } else {
    await prisma.marketplaceFavorite.deleteMany({
      where: { userId: user.id, itemSlug: slug },
    });
  }

  return { favorited };
}

/**
 * Install an item — "Download" in the interface.
 *
 * Unusable items install too. A voice pack cannot do anything until audio
 * generation exists, and the honest handling is to let somebody keep it and say
 * plainly that it is waiting — not to disable the button and leave them
 * guessing whether the item is broken or the product is.
 */
export async function installItem(
  slug: string,
): Promise<{ installed: true; kind: MarketplaceKind }> {
  const user = await requireApiUser();

  const item = itemFor(slug);
  if (!item) {
    throw new MarketplaceError("That item does not exist.", 404, "not_found");
  }

  await prisma.marketplaceInstall.upsert({
    where: { userId_itemSlug: { userId: user.id, itemSlug: slug } },
    create: {
      userId: user.id,
      itemSlug: slug,
      kind: item.kind,
      snapshot: item.payload as never,
    },
    // Re-installing takes the current version. That is what the "update
    // available" badge points at.
    update: { snapshot: item.payload as never, installedAt: new Date() },
  });

  return { installed: true, kind: item.kind };
}

export async function uninstallItem(
  slug: string,
): Promise<{ installed: false }> {
  const user = await requireApiUser();

  await prisma.marketplaceInstall.deleteMany({
    where: { userId: user.id, itemSlug: slug },
  });

  return { installed: false };
}

/**
 * What this user has installed, as the studio needs it.
 *
 * Returns the **snapshots**, not the current catalogue, for the reason above:
 * the composer should show what the user installed, not what the repository has
 * since become.
 */
export async function listInstalled(userId: string): Promise<
  {
    slug: string;
    kind: MarketplaceKind;
    title: string;
    snapshot: unknown;
    installedAt: number;
  }[]
> {
  const rows = await prisma.marketplaceInstall.findMany({
    where: { userId },
    orderBy: { installedAt: "desc" },
    select: {
      itemSlug: true,
      kind: true,
      snapshot: true,
      installedAt: true,
    },
  });

  return rows.map((row) => ({
    slug: row.itemSlug,
    kind: row.kind,
    // The title comes from the catalogue rather than the snapshot: a renamed
    // pack is still the same pack, and showing a stale name would be confusing
    // in a way that showing stale *contents* is not.
    title: itemFor(row.itemSlug)?.title ?? row.itemSlug,
    snapshot: row.snapshot,
    installedAt: row.installedAt.getTime(),
  }));
}

/** How many items sit in each category, for the filter row. */
export function categoryCounts(kind?: MarketplaceKind): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of CATALOGUE) {
    if (kind && item.kind !== kind) continue;
    counts[item.category] = (counts[item.category] ?? 0) + 1;
  }

  return counts;
}

/** Cheap structural comparison. Both sides are our own JSON, never user input. */
function sameSnapshot(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
