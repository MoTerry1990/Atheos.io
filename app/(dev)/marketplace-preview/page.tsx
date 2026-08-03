"use client";

import { useState } from "react";

import { MarketplaceBrowser } from "@/features/marketplace/components/marketplace-browser";
import {
  MarketplaceApiProvider,
  type MarketplaceApi,
} from "@/features/marketplace/lib/api-context";
import {
  type MarketplaceListing,
  type MarketplaceView,
} from "@/features/marketplace/lib/api";
import { CATALOGUE } from "@/services/marketplace/catalogue";
import { CATEGORIES } from "@/services/marketplace/types";
import type { MarketplaceKind } from "@/lib/generated/prisma/enums";

/**
 * Marketplace preview.
 *
 * The production `MarketplaceBrowser` over the **real catalogue**, with
 * favourites and installs held in memory instead of Postgres. Same pattern as
 * the studio, projects and billing previews.
 *
 * Unlike those, the data here is not invented: the catalogue is code, so the
 * preview browses exactly what production would. Only the per-user state — what
 * is starred, what is downloaded — is faked, because that is the only part that
 * needs a database.
 *
 * `noindex` via the `(dev)` layout, and excluded from Clerk's middleware
 * matcher so the development handshake does not intercept it.
 */

const LATENCY_MS = 180;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function createFixtureApi(): MarketplaceApi {
  const favorites = new Set<string>(["film-stocks"]);
  const installs = new Map<string, unknown>([
    ["brand-launch-prompts", CATALOGUE[3].payload],
  ]);

  function enrich(item: (typeof CATALOGUE)[number]): MarketplaceListing {
    return {
      ...item,
      favorited: favorites.has(item.slug),
      installed: installs.has(item.slug),
      // Deliberately always false here. "Update available" needs a snapshot
      // that has drifted from the catalogue, and nothing in a fresh preview
      // can produce one honestly.
      updateAvailable: false,
    };
  }

  return {
    async loadMarketplace(options) {
      const query = options.search?.trim().toLowerCase();

      const items = CATALOGUE.filter((item) => {
        if (options.kind && item.kind !== options.kind) return false;
        if (options.category && item.category !== options.category) {
          return false;
        }
        if (options.view === "favorites" && !favorites.has(item.slug)) {
          return false;
        }
        if (options.view === "installed" && !installs.has(item.slug)) {
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
      }).map(enrich);

      const categories: Record<string, number> = {};
      for (const item of CATALOGUE) {
        if (options.kind && item.kind !== options.kind) continue;
        categories[item.category] = (categories[item.category] ?? 0) + 1;
      }

      return delay({
        items,
        categories,
        view: (options.view ?? "all") as MarketplaceView,
      });
    },

    async actOnItem(slug, action) {
      const item = CATALOGUE.find((entry) => entry.slug === slug);

      switch (action) {
        case "favorite":
          favorites.add(slug);
          return delay({ favorited: true });
        case "unfavorite":
          favorites.delete(slug);
          return delay({ favorited: false });
        case "install":
          if (item) installs.set(slug, item.payload);
          return delay({ installed: true });
        case "uninstall":
          installs.delete(slug);
          return delay({ installed: false });
      }
    },

    async loadInstalled() {
      return delay({
        installed: [...installs.entries()].map(([slug, snapshot]) => {
          const item = CATALOGUE.find((entry) => entry.slug === slug);
          return {
            slug,
            kind: (item?.kind ?? "TEMPLATE") as MarketplaceKind,
            title: item?.title ?? slug,
            snapshot,
            installedAt: 0,
          };
        }),
      });
    },
  };
}

export default function MarketplacePreviewPage() {
  // Created once. A fresh fixture on every render would discard the favourites
  // and installs the user just made.
  const [api] = useState(() => createFixtureApi());

  return (
    <MarketplaceApiProvider value={api}>
      <div className="flex min-h-dvh flex-col">
        <p className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs">
          <span className="font-medium">Preview route.</span>{" "}
          <span className="text-muted-foreground">
            The catalogue is real — it is code, not database rows. Favourites
            and downloads are held in memory and reset on reload. Categories
            available: {CATEGORIES.join(", ")}.
          </span>
        </p>

        <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
          <MarketplaceBrowser />
        </div>
      </div>
    </MarketplaceApiProvider>
  );
}
