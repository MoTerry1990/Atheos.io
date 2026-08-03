"use client";

import { createContext, useContext, type ReactNode } from "react";

import * as api from "@/features/marketplace/lib/api";

/**
 * The marketplace client, injectable.
 *
 * Third time this pattern has earned its keep — projects in Sprint 8, billing
 * in Sprint 9, and now here. The default value is the real module, so nothing
 * changes in production and no call site passes anything; `/marketplace-preview`
 * substitutes an in-memory implementation so the browse, search, favourite and
 * install interactions can actually be clicked without a database.
 */

export interface MarketplaceApi {
  loadMarketplace: typeof api.loadMarketplace;
  actOnItem: typeof api.actOnItem;
  loadInstalled: typeof api.loadInstalled;
}

const REAL: MarketplaceApi = {
  loadMarketplace: api.loadMarketplace,
  actOnItem: api.actOnItem,
  loadInstalled: api.loadInstalled,
};

const MarketplaceApiContext = createContext<MarketplaceApi>(REAL);

export function useMarketplaceApi(): MarketplaceApi {
  return useContext(MarketplaceApiContext);
}

export function MarketplaceApiProvider({
  value,
  children,
}: {
  value: MarketplaceApi;
  children: ReactNode;
}) {
  return (
    <MarketplaceApiContext.Provider value={value}>
      {children}
    </MarketplaceApiContext.Provider>
  );
}
