import type { MetadataRoute } from "next";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

/**
 * Sitemap.
 *
 * Only genuinely indexable pages belong here. Listing a URL that carries
 * `noindex` sends a contradictory signal — the design-system gallery, every
 * preview route and every authenticated surface are deliberately absent.
 *
 * ## Public community pages are included, and they are real rows
 *
 * Sprint 11 added `/explore`, `/u/{handle}` and `/p/{slug}`, all public and
 * worth indexing. They are read from the database rather than guessed, and the
 * query filters on `publishedAt` — the same condition the page itself uses. A
 * sitemap listing a withdrawn post would send a crawler to a 404 and, worse,
 * would name work somebody deliberately took down.
 *
 * ## `lastModified` is real, per entry
 *
 * Build time for the static marketing page, because that genuinely is when it
 * changes. Row timestamps for everything else. Faking a daily timestamp to look
 * fresh is a well-known way to have sitemap dates ignored entirely.
 *
 * ## It degrades rather than fails
 *
 * With no database — a preview deployment, or a build before the migration has
 * run — the query throws. A sitemap that 500s takes the route down; one that
 * returns the marketing pages alone is correct and quiet. The failure is logged.
 */

/**
 * Regenerated hourly, not baked at build.
 *
 * Without this, Next prerenders `sitemap.xml` as static content — the build log
 * says so — and the post list freezes at deploy time. A database-backed sitemap
 * that cannot see anything published since the last deploy is worse than a
 * static one, because it looks live and is silently stale.
 *
 * An hour rather than `force-dynamic`: crawlers hit this file often, each hit
 * would otherwise cost two unbounded queries, and no crawler acts on a sitemap
 * within an hour of it changing.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;
  const lastModified = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified, changeFrequency: "weekly", priority: 1 },
    {
      url: `${baseUrl}/explore`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.8,
    },
  ];

  try {
    const [posts, profiles] = await Promise.all([
      prisma.post.findMany({
        where: { publishedAt: { not: null }, asset: { deletedAt: null } },
        orderBy: { publishedAt: "desc" },
        // Capped. A sitemap file may hold 50,000 URLs; past that it needs an
        // index, and this is not the sprint to build one for a gallery that is
        // currently empty.
        take: 5_000,
        select: { slug: true, updatedAt: true },
      }),
      prisma.user.findMany({
        where: {
          handle: { not: null },
          posts: { some: { publishedAt: { not: null } } },
        },
        take: 5_000,
        select: { handle: true, updatedAt: true },
      }),
    ]);

    return [
      ...staticRoutes,
      ...posts.map((post) => ({
        url: `${baseUrl}/p/${post.slug}`,
        lastModified: post.updatedAt,
        changeFrequency: "monthly" as const,
        priority: 0.5,
      })),
      ...profiles.map((profile) => ({
        url: `${baseUrl}/u/${profile.handle}`,
        lastModified: profile.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ];
  } catch (error) {
    console.error("Sitemap: could not read community pages", error);
    return staticRoutes;
  }
}
