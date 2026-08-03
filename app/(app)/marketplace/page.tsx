import type { Metadata } from "next";

import { MarketplaceBrowser } from "@/features/marketplace/components/marketplace-browser";

export const metadata: Metadata = { title: "Marketplace" };

/**
 * The marketplace route.
 *
 * Inside the authenticated group, because favouriting and downloading both need
 * an account — even though browsing itself does not. Putting the browse page
 * outside the gate and the actions inside it would mean a signed-out visitor
 * discovers the requirement only after clicking, which is the worse order.
 *
 * A thin wrapper around a client component: the page is one long interaction
 * where every filter refetches, so server-rendering the first grid would buy
 * one paint and cost a second data path to keep in agreement with the first.
 */
export default function MarketplacePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
      <MarketplaceBrowser />
    </div>
  );
}
