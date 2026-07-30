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
        disallow: ["/api/", "/design-system"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
