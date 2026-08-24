"use client";

import { PackageOpen, Star, Store } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { SearchInput } from "@/components/ui/field";
import { SkeletonGrid } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { ItemCard } from "@/features/marketplace/components/item-card";
import { ItemDetail } from "@/features/marketplace/components/item-detail";
import {
  ApiError,
  type MarketplaceListing,
  type MarketplaceView,
} from "@/features/marketplace/lib/api";
import { useMarketplaceApi } from "@/features/marketplace/lib/api-context";
import { KIND_PLURALS } from "@/services/marketplace/types";
import type { MarketplaceKind } from "@/lib/generated/prisma/enums";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * The marketplace.
 *
 * ## Kind is a rail, category is a row, view is a rail
 *
 * Three filters that compose, laid out by how often they change. Kind and view
 * are the persistent choice — what am I looking for, and am I looking at
 * everything or only mine — so they sit in the rail. Category narrows within a
 * kind and changes constantly, so it is a row of chips above the grid that
 * resets when the kind does.
 *
 * ## Favourite is optimistic; install is not
 *
 * A star is clicked repeatedly and has no consequence worth waiting for.
 * Installing changes what the studio offers, so it waits for the server and
 * then reloads — showing "Installed" before it is true would be a promise the
 * composer then fails to keep.
 */

const KINDS: { id: MarketplaceKind | "ALL"; label: string }[] = [
  { id: "ALL", label: "Everything" },
  { id: "TEMPLATE", label: KIND_PLURALS.TEMPLATE },
  { id: "PROMPT_PACK", label: KIND_PLURALS.PROMPT_PACK },
  { id: "STYLE_PACK", label: KIND_PLURALS.STYLE_PACK },
  { id: "CHARACTER", label: KIND_PLURALS.CHARACTER },
  { id: "VOICE_PACK", label: KIND_PLURALS.VOICE_PACK },
];

const VIEWS: { id: MarketplaceView; label: string; icon: typeof Store }[] = [
  { id: "all", label: "Browse", icon: Store },
  { id: "favorites", label: "Favourites", icon: Star },
  { id: "installed", label: "Downloads", icon: PackageOpen },
];

export function MarketplaceBrowser() {
  const api = useMarketplaceApi();

  const [kind, setKind] = useState<MarketplaceKind | "ALL">("ALL");
  const [category, setCategory] = useState<string | null>(null);
  const [view, setView] = useState<MarketplaceView>("all");
  const [search, setSearch] = useState("");

  const [items, setItems] = useState<MarketplaceListing[]>([]);
  const [categories, setCategories] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;

    setError(null);
    try {
      const data = await api.loadMarketplace({
        kind: kind === "ALL" ? undefined : kind,
        category: category ?? undefined,
        view,
        search,
        signal: next.signal,
      });
      setItems(data.items);
      setCategories(data.categories);
    } catch (cause) {
      // An abort is this component superseding its own request, not a failure.
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (cause instanceof ApiError && cause.code === "aborted") return;
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not load the marketplace.",
      );
    } finally {
      setLoading(false);
    }
  }, [api, kind, category, view, search]);

  useEffect(() => {
    setLoading(true);
    // Debounced only while typing. A filter click should feel instant.
    const timer = setTimeout(() => void refresh(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [refresh, search]);

  useEffect(() => () => controller.current?.abort(), []);

  // A category that does not exist within the newly chosen kind would filter
  // everything away and look like an empty marketplace.
  useEffect(() => {
    setCategory(null);
  }, [kind]);

  async function toggleFavorite(item: MarketplaceListing) {
    const next = !item.favorited;

    setItems((current) =>
      current.map((entry) =>
        entry.slug === item.slug ? { ...entry, favorited: next } : entry,
      ),
    );

    try {
      await api.actOnItem(item.slug, next ? "favorite" : "unfavorite");
    } catch (cause) {
      setItems((current) =>
        current.map((entry) =>
          entry.slug === item.slug
            ? { ...entry, favorited: item.favorited }
            : entry,
        ),
      );
      toast.error("Could not update that", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
      return;
    }

    // Only the Favourites view changes membership, so only it needs a reload.
    if (view === "favorites") await refresh();
  }

  async function install(item: MarketplaceListing) {
    // Already installed and current: the button is a no-op rather than a
    // silent reinstall the user did not ask for.
    if (item.installed && !item.updateAvailable) {
      toast.info("Already in your workspace", item.title);
      return;
    }

    setBusySlug(item.slug);
    try {
      await api.actOnItem(item.slug, "install");
      toast.success(
        item.updateAvailable ? "Updated" : "Added to your workspace",
        item.usable
          ? "Available in the studio."
          : (item.unusableReason ?? undefined),
      );
      await refresh();
    } catch (cause) {
      toast.error("Could not download that", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    } finally {
      setBusySlug(null);
    }
  }

  async function uninstall(item: MarketplaceListing) {
    setBusySlug(item.slug);
    try {
      await api.actOnItem(item.slug, "uninstall");
      toast.success("Removed", item.title);
      await refresh();
    } catch (cause) {
      toast.error("Could not remove that", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    } finally {
      setBusySlug(null);
    }
  }

  const open = items.find((entry) => entry.slug === openSlug) ?? null;
  const activeCategories = Object.entries(categories).filter(
    ([, count]) => count > 0,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row">
      <nav
        aria-label="Marketplace sections"
        className="space-y-4 lg:w-52 lg:shrink-0"
      >
        <ul className="space-y-0.5">
          {VIEWS.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => setView(entry.id)}
                aria-current={view === entry.id ? "page" : undefined}
                className={rowClass(view === entry.id)}
              >
                <entry.icon className="size-4 shrink-0" aria-hidden />
                {entry.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="space-y-1">
          {/* A `<p>`, not a heading.

              It sat before the page `<h1>` in DOM order, so the outline opened
              `h2, h1, h3` — a screen reader's heading list led with a group
              label from a sidebar. The `<nav>` around it already carries an
              accessible name, which is what actually makes this region
              navigable; the label is styling. */}
          <p className="px-2.5 text-2xs font-medium tracking-wider text-muted-foreground uppercase">
            Type
          </p>
          <ul className="space-y-0.5">
            {KINDS.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => setKind(entry.id)}
                  aria-current={kind === entry.id ? "page" : undefined}
                  className={rowClass(kind === entry.id)}
                >
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-lg font-semibold tracking-tight">
            {VIEWS.find((entry) => entry.id === view)?.label}
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              {loading ? "" : items.length}
            </span>
          </h1>

          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            {/* The magnifier, the padding it needs and the clear button all
                come from the primitive now. Three screens had three
                hand-placed versions of this, and two of them left the icon
                6px from the first character. */}
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch("")}
              placeholder="Search the marketplace"
              aria-label="Search the marketplace"
            />
          </div>
        </div>

        {activeCategories.length > 1 ? (
          <ul className="flex flex-wrap gap-1.5">
            <li>
              <button
                type="button"
                onClick={() => setCategory(null)}
                aria-pressed={category === null}
                className={chipClass(category === null)}
              >
                All categories
              </button>
            </li>
            {activeCategories.map(([name, count]) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => setCategory(name)}
                  aria-pressed={category === name}
                  className={chipClass(category === name)}
                >
                  {name}
                  <span className="ml-1 text-muted-foreground tabular-nums">
                    {count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Said once, at the top, rather than as a badge on every card. There
            are no third-party publishers yet, and implying otherwise by staying
            silent would be the dishonest option. */}
        {view === "all" && !search && !category ? (
          <p className="text-xs text-muted-foreground">
            Everything here is made by Atheos. Publishing is not open yet, so
            there are no third-party items — and no ratings or download counts,
            because there is nothing real to count.
          </p>
        ) : null}

        {error ? (
          <ErrorState
            title="Could not load the marketplace"
            description={error}
            onRetry={() => void refresh()}
          />
        ) : loading ? (
          <SkeletonGrid count={6} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={view === "installed" ? PackageOpen : Store}
            title={
              search
                ? "Nothing matches that"
                : view === "favorites"
                  ? "No favourites yet"
                  : view === "installed"
                    ? "Nothing downloaded yet"
                    : "Nothing here"
            }
            description={
              search
                ? "Try a different word, or clear the filters."
                : view === "favorites"
                  ? "Star anything you want to come back to."
                  : view === "installed"
                    ? "Downloaded packs appear in the studio composer."
                    : "Nothing in this category yet."
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <li key={item.slug} className="min-w-0 card-defer">
                <ItemCard
                  item={item}
                  busy={busySlug === item.slug}
                  onOpen={(entry) => setOpenSlug(entry.slug)}
                  onToggleFavorite={(entry) => void toggleFavorite(entry)}
                  onInstall={(entry) => void install(entry)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <ItemDetail
        item={open}
        busy={busySlug === open?.slug}
        onClose={() => setOpenSlug(null)}
        onToggleFavorite={(entry) => void toggleFavorite(entry)}
        onInstall={(entry) => void install(entry)}
        onUninstall={(entry) => void uninstall(entry)}
      />
    </div>
  );
}

function rowClass(active: boolean) {
  return cn(
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
    "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
    active
      ? "bg-secondary font-medium text-secondary-foreground"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  );
}

function chipClass(active: boolean) {
  return cn(
    "rounded-full border px-2.5 py-1 text-xs transition-colors",
    "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
    active
      ? "border-primary/40 bg-primary/10 text-foreground"
      : "border-border text-muted-foreground hover:text-foreground",
  );
}
