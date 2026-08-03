"use client";

import { Compass, Flame, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SkeletonGrid } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { PostTile } from "@/features/community/components/post-tile";
import {
  ApiError,
  type GalleryOrder,
  type PublicPost,
  type PublicProfile,
} from "@/features/community/lib/api";
import { useCommunityApi } from "@/features/community/lib/api-context";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Explore.
 *
 * ## Trending returning nothing is the correct behaviour
 *
 * Nothing has been published yet, so trending is empty — and it says so rather
 * than falling back to "recent" wearing a Flame icon. Ranking that invents
 * momentum is lying about the only thing it claims to measure, and it is the
 * lie a user catches first.
 *
 * The same applies to Featured creators: editorial, empty until somebody has
 * actually been featured, and the panel explains that instead of quietly
 * showing whoever has the most followers.
 *
 * ## Following needs an account, and the empty state says which
 *
 * Signed out, "Following" is empty because there is no viewer. Signed in with
 * no follows, it is empty for a different reason. Two different sentences,
 * because "nothing here" would leave a signed-out visitor thinking the product
 * is broken.
 */

const TABS: {
  id: GalleryOrder | "following";
  label: string;
  icon: typeof Compass;
}[] = [
  { id: "recent", label: "Recent", icon: Compass },
  { id: "trending", label: "Trending", icon: Flame },
  { id: "featured", label: "Featured", icon: Sparkles },
  { id: "following", label: "Following", icon: Users },
];

export function Explore({ signedIn = false }: { signedIn?: boolean }) {
  const api = useCommunityApi();

  const [tab, setTab] = useState<GalleryOrder | "following">("recent");
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [creators, setCreators] = useState<PublicProfile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;

    setLoading(true);
    setError(null);

    try {
      const data = await api.loadGallery({
        order: tab === "following" ? "recent" : tab,
        following: tab === "following",
        signal: next.signal,
      });
      setPosts(data.posts);
      setCursor(data.nextCursor);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not load the gallery.",
      );
    } finally {
      setLoading(false);
    }
  }, [api, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    api
      .loadFeaturedCreators()
      .then((data) => setCreators(data.creators))
      // Never fatal. The gallery is the page; the creators panel is beside it.
      .catch(() => setCreators([]));
  }, [api]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api.loadGallery({
        order: tab === "following" ? "recent" : tab,
        following: tab === "following",
        cursor,
      });
      setPosts((current) => [...current, ...data.posts]);
      setCursor(data.nextCursor);
    } catch (cause) {
      toast.error("Could not load more", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    } finally {
      setLoadingMore(false);
    }
  }

  async function like(post: PublicPost) {
    if (!signedIn) {
      toast.info("Sign in to like", "Likes are tied to your account.");
      return;
    }

    const next = !post.liked;
    setPosts((current) =>
      current.map((entry) =>
        entry.slug === post.slug
          ? {
              ...entry,
              liked: next,
              likeCount: Math.max(0, entry.likeCount + (next ? 1 : -1)),
            }
          : entry,
      ),
    );

    try {
      await api.actOnPost(post.slug, next ? "like" : "unlike");
    } catch (cause) {
      setPosts((current) =>
        current.map((entry) =>
          entry.slug === post.slug
            ? { ...entry, liked: post.liked, likeCount: post.likeCount }
            : entry,
        ),
      );
      toast.error("Could not update that", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-pressed={tab === entry.id}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
              tab === entry.id
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <entry.icon className="size-3.5" aria-hidden />
            {entry.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0 space-y-4">
          {error ? (
            <ErrorState
              title="Could not load the gallery"
              description={error}
              onRetry={() => void load()}
            />
          ) : loading ? (
            <SkeletonGrid count={6} />
          ) : posts.length === 0 ? (
            <EmptyState
              icon={TABS.find((entry) => entry.id === tab)?.icon ?? Compass}
              title={emptyTitle(tab, signedIn)}
              description={emptyDescription(tab, signedIn)}
            />
          ) : (
            <>
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {posts.map((post) => (
                  <li key={post.slug} className="min-w-0 card-defer">
                    <PostTile
                      post={post}
                      onLike={(entry) => void like(entry)}
                    />
                  </li>
                ))}
              </ul>

              {cursor ? (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    loading={loadingMore}
                    onClick={() => void loadMore()}
                  >
                    Load more
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>

        <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <h2 className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
            Featured creators
          </h2>

          {creators === null ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : creators.length === 0 ? (
            /* Editorial, and empty. Said plainly rather than backfilled with
               the most-followed accounts under a heading that claims judgement
               nobody has exercised. */
            <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              Nobody is featured yet. This is an editorial list, chosen by us —
              it is not the most-followed accounts, so it stays empty until
              there is work worth pointing at.
            </p>
          ) : (
            <ul className="space-y-1">
              {creators.map((creator) => (
                <li key={creator.handle}>
                  <Link
                    href={`/u/${creator.handle}`}
                    className="flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                  >
                    <Avatar className="size-8 shrink-0">
                      {creator.imageUrl ? (
                        <AvatarImage src={creator.imageUrl} alt="" />
                      ) : null}
                      <AvatarFallback className="text-2xs">
                        {creator.displayName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        {creator.displayName}
                      </span>
                      <span className="block text-2xs text-muted-foreground tabular-nums">
                        {creator.postCount} published
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function emptyTitle(tab: string, signedIn: boolean): string {
  if (tab === "following")
    return signedIn ? "You follow nobody yet" : "Sign in to follow people";
  if (tab === "trending") return "Nothing is trending";
  if (tab === "featured") return "Nothing is featured yet";
  return "Nothing published yet";
}

function emptyDescription(tab: string, signedIn: boolean): string {
  if (tab === "following") {
    return signedIn
      ? "Follow someone and their work appears here."
      : "Following is tied to your account.";
  }
  if (tab === "trending") {
    return "Trending is computed from likes and comments over the last week. With nothing published, there is nothing to rank — this stays empty rather than showing recent work under a heading that would be untrue.";
  }
  if (tab === "featured") {
    return "Featured posts are chosen by us, not by popularity.";
  }
  return "Publish something from the studio and it appears here.";
}
