import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

/**
 * robots.txt.
 *
 * The disallow list is a **crawl-budget** instruction, not a security control.
 * Anything genuinely private is protected by authentication; robots.txt is
 * public, so listing a secret path here advertises it.
 *
 * `/design-system` is excluded because it is internal documentation that would
 * otherwise compete with the real pages in search results.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Internal tooling and authenticated surfaces. All of these also carry
        // `noindex` — robots.txt saves the crawl, the meta tag is what actually
        // keeps them out of the index if a link to one leaks.
        disallow: [
          "/api/",
          // Internal tooling. Every preview route added since Sprint 4 —
          // listing them individually was already a maintenance trap by the
          // fifth one, so the pattern covers any future `*-preview`.
          "/design-system",
          "/dashboard-preview",
          "/studio-preview",
          "/projects-preview",
          "/billing-preview",
          "/marketplace-preview",
          "/community-preview",
          "/admin-preview",
          "/dev/",
          // Authenticated surfaces. All carry `noindex` as well; this only
          // saves the crawl.
          "/studio",
          "/dashboard",
          "/projects",
          "/marketplace",
          "/profile",
          "/settings",
          // Deliberately **not** listed: `/admin`. It returns 404 to everyone
          // who is not an admin (§ 38), and naming it here would advertise a
          // path that is otherwise indistinguishable from a typo — the exact
          // thing robots.txt being public makes a bad idea.
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
