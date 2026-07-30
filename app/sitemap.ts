import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

/**
 * Sitemap.
 *
 * Only genuinely indexable pages belong here. Listing a URL that carries
 * `noindex` sends a contradictory signal — the design-system gallery and, later,
 * every authenticated route are deliberately absent.
 *
 * `lastModified` uses build time, which is honest for a static marketing page:
 * the content changes when the site is rebuilt. Faking a daily timestamp to look
 * fresh is a well-known way to have your sitemap dates ignored entirely.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;
  const lastModified = new Date();

  return [
    {
      url: baseUrl,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
