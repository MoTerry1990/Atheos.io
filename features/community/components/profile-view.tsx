"use client";

import { ExternalLink, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonGrid } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { PostTile } from "@/features/community/components/post-tile";
import {
  ApiError,
  type PublicPost,
  type PublicProfile,
} from "@/features/community/lib/api";
import { useCommunityApi } from "@/features/community/lib/api-context";
import { toast } from "@/lib/toast";

/**
 * A public profile.
 *
 * ## Only published work
 *
 * The gallery here is `listPosts({ handle })`, which filters on `publishedAt`.
 * A profile that leaked drafts would be the single worst bug in this feature —
 * the studio holds people's commercial and unfinished work, and this page is
 * loadable by anyone.
 *
 * ## The follow button is optimistic; the count is not guessed
 *
 * The button flips immediately because it is clicked repeatedly and has no
 * consequence worth waiting for. The follower count comes back from the server
 * rather than being incremented locally: it is a number about other people, and
 * a local guess would be wrong the moment two tabs disagree.
 */
export function ProfileView({
  handle,
  signedIn = false,
}: {
  handle: string;
  signedIn?: boolean;
}) {
  const api = useCommunityApi();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.loadProfile(handle);
      setProfile(data.profile);
      setPosts(data.posts);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not load that profile.",
      );
    }
  }, [api, handle]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleFollow() {
    if (!profile) return;
    if (!signedIn) {
      toast.info("Sign in to follow", "Following is tied to your account.");
      return;
    }

    const next = !profile.following;
    setProfile({ ...profile, following: next });
    setBusy(true);

    try {
      const result = await api.setFollow(profile.handle, next);
      // The count is the server's answer, not ours. Incrementing locally would
      // be a guess about other people's actions.
      setProfile((current) =>
        current
          ? {
              ...current,
              following: result.following,
              followerCount: result.followerCount,
            }
          : current,
      );
    } catch (cause) {
      setProfile((current) =>
        current ? { ...current, following: !next } : current,
      );
      toast.error("Could not update that", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Profile not found"
        description={error}
        action={
          <Button variant="ghost" asChild>
            <Link href="/explore">Back to Explore</Link>
          </Button>
        }
      />
    );
  }

  if (!profile) {
    return (
      <div className="space-y-6">
        <div className="flex gap-4">
          <Skeleton className="size-20 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <SkeletonGrid count={6} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start gap-4">
        <Avatar className="size-20 shrink-0">
          {profile.imageUrl ? (
            <AvatarImage src={profile.imageUrl} alt="" />
          ) : null}
          <AvatarFallback className="text-lg">
            {profile.displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            {profile.displayName}
            {profile.featured ? (
              <Badge variant="gradient" size="sm">
                <Sparkles className="size-3" aria-hidden />
                Featured
              </Badge>
            ) : null}
          </h1>
          <p className="text-sm text-muted-foreground">@{profile.handle}</p>

          {profile.bio ? (
            <p className="mt-2 max-w-prose text-sm leading-relaxed">
              {profile.bio}
            </p>
          ) : null}

          {profile.website ? (
            <a
              href={profile.website}
              target="_blank"
              // `noopener noreferrer` on a user-supplied link is not optional:
              // without it the destination gets a handle on our window and the
              // referrer of whoever clicked.
              rel="noopener noreferrer nofollow"
              // `min-h-6` is 24px — WCAG 2.5.8. An inline `text-xs` link lands
              // at about 18, which is the fourth time this codebase has made
              // that exact miss.
              className="mt-1.5 inline-flex min-h-6 items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
            >
              {profile.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}

          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums">
            <div className="flex gap-1">
              <dt className="font-medium">{profile.postCount}</dt>
              <dd className="text-muted-foreground">published</dd>
            </div>
            <div className="flex gap-1">
              <dt className="font-medium">{profile.followerCount}</dt>
              <dd className="text-muted-foreground">
                {profile.followerCount === 1 ? "follower" : "followers"}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt className="font-medium">{profile.followingCount}</dt>
              <dd className="text-muted-foreground">following</dd>
            </div>
          </dl>
        </div>

        {profile.mine ? (
          <Button variant="outline" asChild>
            <Link href="/settings/profile">Edit profile</Link>
          </Button>
        ) : (
          <Button
            variant={profile.following ? "outline" : "gradient"}
            loading={busy}
            onClick={() => void toggleFollow()}
            aria-pressed={profile.following}
          >
            <UserRound />
            {profile.following ? "Following" : "Follow"}
          </Button>
        )}
      </header>

      {posts.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={
            profile.mine
              ? "You have not published anything"
              : "Nothing published yet"
          }
          description={
            profile.mine
              ? "Publish a result from the studio and it appears here. Nothing is public until you choose it."
              : "This profile has no published work."
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {posts.map((post) => (
            <li key={post.slug} className="min-w-0">
              <PostTile post={post} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
