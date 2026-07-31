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
          "/design-system",
          "/dashboard-preview",
          "/dashboard",
          "/profile",
          "/settings",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
