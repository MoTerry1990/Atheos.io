"use client";

import { Heart, MessageCircle, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { PublicPost } from "@/features/community/lib/api";
import { assetUrl } from "@/features/studio/lib/job-mapper";
import { cn } from "@/lib/utils";

/**
 * One published post, in a grid.
 *
 * ## Counts are shown, never rounded up
 *
 * `3`, not "3 likes · trending". There is no traffic yet, and a gallery that
 * dresses up single digits is the same dishonesty as inventing them. When the
 * numbers are real they will look after themselves.
 *
 * ## Video is a muted, controls-free thumbnail
 *
 * `preload="metadata"` so a grid of clips does not pull full files. The post
 * page is where playback happens; here the job is only to be recognisable.
 */
export function PostTile({
  post,
  onLike,
  className,
}: {
  post: PublicPost;
  onLike?: (post: PublicPost) => void;
  className?: string;
}) {
  const url = assetUrl(post.asset.storageKey);
  const isVideo = post.asset.mimeType.startsWith("video/");

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border bg-card",
        "focus-within:border-primary/40 hover:border-border/70",
        className,
      )}
    >
      <div
        className="relative"
        style={{
          aspectRatio: `${post.asset.width ?? 1} / ${post.asset.height ?? 1}`,
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0 bg-muted"
          style={{
            backgroundImage: `linear-gradient(135deg, oklch(0.3 0.06 280 / 0.6), oklch(0.2 0.04 300 / 0.6))`,
          }}
        />

        {url ? (
          isVideo ? (
            <video
              src={url}
              muted
              playsInline
              preload="metadata"
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            /* `sizes` is the whole point of this change.
               Without it, `fill` requests the largest candidate width for every
               tile — so a 24-tile gallery pulled 24 full-size originals. These
               values match the grid: one column on a phone, two on a tablet,
               four from `lg` up, inside a container that maxes out around
               1280px. The browser then picks a ~320px variant for a ~320px
               box instead of a 2048px one. */
            <Image
              src={url}
              alt={post.caption ?? ""}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
              className="absolute inset-0 size-full object-cover"
            />
          )
        ) : null}

        {post.featured ? (
          <Badge variant="gradient" size="sm" className="absolute top-2 left-2">
            <Sparkles className="size-3" aria-hidden />
            Featured
          </Badge>
        ) : null}

        {/* The tile is a link to the post. The author link and the like button
            sit above it in the stacking order — `after:z-[1]` rather than a
            bare pseudo-element, because without a z-index the overlay paints
            beneath later siblings and the middle of the card goes dead. */}
        <Link
          href={`/p/${post.slug}`}
          className="rounded after:absolute after:inset-0 after:z-[1] focus-visible:outline-none"
        >
          <span className="sr-only">
            {post.caption || `Post by ${post.author.displayName}`}
          </span>
        </Link>
      </div>

      <div className="relative z-10 flex items-center gap-2 p-2.5">
        <Link
          href={`/u/${post.author.handle}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <Avatar className="size-6 shrink-0">
            {post.author.imageUrl ? (
              <AvatarImage src={post.author.imageUrl} alt="" />
            ) : null}
            <AvatarFallback className="text-2xs">
              {post.author.displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 truncate text-xs">
            {post.author.displayName}
          </span>
        </Link>

        <button
          type="button"
          onClick={() => onLike?.(post)}
          aria-pressed={post.liked}
          aria-label={post.liked ? "Unlike" : "Like"}
          // 24px minimum. The same WCAG 2.5.8 miss this codebase has now made
          // three times — footer links, tag chips, dialog close buttons.
          className={cn(
            "flex min-h-6 items-center gap-1 rounded px-1 text-2xs tabular-nums transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
            post.liked
              ? "text-destructive"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Heart
            className={cn("size-3.5", post.liked && "fill-current")}
            aria-hidden
          />
          {post.likeCount}
        </button>

        <span className="flex min-h-6 items-center gap-1 px-1 text-2xs text-muted-foreground tabular-nums">
          <MessageCircle className="size-3.5" aria-hidden />
          {post.commentCount}
        </span>
      </div>
    </article>
  );
}
