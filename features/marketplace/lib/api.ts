import { ApiError, request } from "@/lib/http";
import type { MarketplaceItem } from "@/services/marketplace/types";
import type { MarketplaceKind } from "@/lib/generated/prisma/enums";

/**
 * The marketplace client.
 *
 * Types come from `services/marketplace/types` — a pure module with no `env`
 * and no `server-only`, for the same reason the billing catalogue was split in
 * Sprint 9: this reaches client components, and a server variable read in a
 * client bundle is a production runtime error and nothing in development.
 */

export { ApiError };
export type { MarketplaceItem, MarketplaceKind };

export interface MarketplaceListing extends MarketplaceItem {
  favorited: boolean;
  installed: boolean;
  updateAvailable: boolean;
}

export type MarketplaceView = "all" | "favorites" | "installed";

export interface InstalledItem {
  slug: string;
  kind: MarketplaceKind;
  title: string;
  snapshot: unknown;
  installedAt: number;
}

export function loadMarketplace(options: {
  kind?: MarketplaceKind;
  category?: string;
  search?: string;
  view?: MarketplaceView;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  if (options.kind) params.set("kind", options.kind);
  if (options.category) params.set("category", options.category);
  if (options.view && options.view !== "all") params.set("view", options.view);
  if (options.search?.trim()) params.set("q", options.search.trim());

  return request<{
    items: MarketplaceListing[];
    categories: Record<string, number>;
    view: MarketplaceView;
  }>(`/api/marketplace?${params}`, { signal: options.signal });
}

export function actOnItem(
  slug: string,
  action: "favorite" | "unfavorite" | "install" | "uninstall",
) {
  return request<{ favorited?: boolean; installed?: boolean }>(
    `/api/marketplace/${slug}`,
    { method: "POST", body: JSON.stringify({ action }) },
  );
}

export function loadInstalled() {
  return request<{ installed: InstalledItem[] }>("/api/marketplace/installed");
}
