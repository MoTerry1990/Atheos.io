"use client";

import {
  ArrowLeft,
  EyeOff,
  Flag,
  Heart,
  MessageCircle,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/state";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiError,
  type PublicComment,
  type PublicPost,
} from "@/features/community/lib/api";
import { useCommunityApi } from "@/features/community/lib/api-context";
import { assetUrl } from "@/features/studio/lib/job-mapper";
import { formatRelativeTime } from "@/utils/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * One post.
 *
 * ## The prompt is shown only if the author said so
 *
 * `post.prompt` is null when they opted out, and the panel omits the section
 * entirely rather than showing an empty box that advertises there is something
 * being withheld.
 *
 * ## Deleted comments leave a tombstone
 *
 * "This comment was removed" rather than the row vanishing. A thread with a
 * hole in it reads as broken; a thread that says something was removed reads as
 * moderated, which is what happened.
 *
 * ## Reporting says what it does
 *
 * There is no automated moderation. The confirmation says a person will look,
 * because a report button that implies review nobody performs is worse than no
 * button — it tells somebody the problem is handled when it is queued.
 */
export function PostView({
  slug,
  signedIn = false,
}: {
  slug: string;
  signedIn?: boolean;
}) {
  const api = useCommunityApi();

  const [post, setPost] = useState<PublicPost | null>(null);
  const [comments, setComments] = useState<PublicComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ post: loaded }, { comments: loadedComments }] =
        await Promise.all([api.loadPost(slug), api.loadComments(slug)]);
      setPost(loaded);
      setComments(loadedComments);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "Could not load that post.",
      );
    }
  }, [api, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function like() {
    if (!post) return;
    if (!signedIn) {
      toast.info("Sign in to like", "Likes are tied to your account.");
      return;
    }

    const next = !post.liked;
    setPost({
      ...post,
      liked: next,
      likeCount: Math.max(0, post.likeCount + (next ? 1 : -1)),
    });

    try {
      await api.actOnPost(slug, next ? "like" : "unlike");
    } catch (cause) {
      setPost(post);
      toast.error("Could not update that", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    }
  }

  async function submitComment() {
    const body = draft.trim();
    if (!body || posting) return;

    setPosting(true);
    try {
      const { comment } = await api.addComment(slug, body);
      setComments((current) => [...current, comment]);
      setDraft("");
      setPost((current) =>
        current
          ? { ...current, commentCount: current.commentCount + 1 }
          : current,
      );
    } catch (cause) {
      toast.error("Could not post that", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    } finally {
      setPosting(false);
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load that post"
        description={error}
        onRetry={() => void load()}
        action={
          <Button variant="ghost" asChild>
            <Link href="/explore">Back to Explore</Link>
          </Button>
        }
      />
    );
  }

  if (!post) {
    return (
      <div className="space-y-4">
        <Skeleton className="aspect-video w-full rounded-xl" />
        <Skeleton className="h-6 w-64" />
      </div>
    );
  }

  const url = assetUrl(post.asset.storageKey);
  const isVideo = post.asset.mimeType.startsWith("video/");

  return (
    <div className="space-y-6">
      {/* The page had no `h1` at all — only two `h2`s, so a screen reader's
          heading list opened on "Prompt". A post's caption is its title, and
          when there is none the author is the next best answer.

          Visually hidden because the image is the headline here; a repeated
          text title above it would be noise for sighted users and the only
          landmark for everybody else. */}
      <h1 className="sr-only">
        {post.caption ?? `Post by ${post.author.displayName}`}
      </h1>

      <Button variant="ghost" size="sm" asChild>
        <Link href="/explore">
          <ArrowLeft />
          Explore
        </Link>
      </Button>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-3">
          <figure
            className="overflow-hidden rounded-xl border border-border bg-muted"
            style={{
              aspectRatio: `${post.asset.width ?? 1} / ${post.asset.height ?? 1}`,
            }}
          >
            {url ? (
              isVideo ? (
                <video
                  src={url}
                  controls
                  loop
                  muted
                  playsInline
                  className="size-full object-contain"
                />
              ) : (
                /* `priority`, uniquely in this codebase.
                   This is the LCP element of a public, indexable page — the one
                   image a visitor came to see. Everything else in the product
                   is in a grid and lazy-loads; this one must not wait for the
                   intersection observer. */
                <Image
                  src={url}
                  alt={post.caption ?? ""}
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 768px"
                  className="size-full object-contain"
                />
              )
            ) : null}
          </figure>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={post.liked ? "glow" : "outline"}
              size="sm"
              onClick={() => void like()}
              aria-pressed={post.liked}
            >
              <Heart className={post.liked ? "fill-current" : undefined} />
              {post.likeCount}
            </Button>

            <span className="flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
              <MessageCircle className="size-4" aria-hidden />
              {post.commentCount}
            </span>

            {post.featured ? (
              <Badge variant="gradient" size="sm">
                Featured
              </Badge>
            ) : null}

            {post.mine ? (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-muted-foreground"
                onClick={() =>
                  void (async () => {
                    try {
                      await api.actOnPost(slug, "unpublish");
                      toast.success(
                        "Taken down",
                        "Your likes and comments are kept if you publish it again.",
                      );
                      await load();
                    } catch (cause) {
                      toast.error("Could not take that down", {
                        description:
                          cause instanceof ApiError
                            ? cause.message
                            : "Please try again.",
                      });
                    }
                  })()
                }
              >
                <EyeOff />
                Take down
              </Button>
            ) : null}
          </div>
        </div>

        <aside className="space-y-5">
          <Link
            href={`/u/${post.author.handle}`}
            className="flex items-center gap-3 rounded-lg p-1 transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <Avatar className="size-10 shrink-0">
              {post.author.imageUrl ? (
                <AvatarImage src={post.author.imageUrl} alt="" />
              ) : null}
              <AvatarFallback>
                {post.author.displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {post.author.displayName}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                @{post.author.handle}
              </span>
            </span>
          </Link>

          {post.caption ? (
            <p className="text-sm leading-relaxed">{post.caption}</p>
          ) : null}

          {/* Omitted entirely when withheld. An empty "Prompt" box would
              advertise that something is being kept back, which is worse for
              both sides than saying nothing. */}
          {post.prompt ? (
            <div className="space-y-1.5">
              <h2 className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
                Prompt
              </h2>
              <p className="rounded-lg border border-border p-3 font-mono text-xs leading-relaxed">
                {post.prompt}
              </p>
            </div>
          ) : null}

          <p className="text-2xs text-muted-foreground">
            Published {formatRelativeTime(post.publishedAt)}
          </p>

          <section className="space-y-3" aria-labelledby="comments-heading">
            <h2 id="comments-heading" className="text-sm font-medium">
              Comments
              <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">
                {comments.filter((entry) => !entry.deleted).length}
              </span>
            </h2>

            {signedIn ? (
              <div className="space-y-2">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Say something useful."
                  rows={3}
                  maxLength={2000}
                />
                <Button
                  size="sm"
                  loading={posting}
                  disabled={!draft.trim()}
                  onClick={() => void submitComment()}
                >
                  Comment
                </Button>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                <Link href="/sign-in" className="underline underline-offset-2">
                  Sign in
                </Link>{" "}
                to comment.
              </p>
            )}

            {comments.length === 0 ? (
              <p className="text-xs text-muted-foreground">No comments yet.</p>
            ) : (
              <ul className="space-y-3">
                {comments.map((comment) => (
                  <li key={comment.id} className="flex gap-2.5">
                    <Avatar className="size-7 shrink-0">
                      {comment.author.imageUrl ? (
                        <AvatarImage src={comment.author.imageUrl} alt="" />
                      ) : null}
                      <AvatarFallback className="text-2xs">
                        {comment.author.displayName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline gap-2 text-xs">
                        <span className="truncate font-medium">
                          {comment.author.displayName}
                        </span>
                        <span className="shrink-0 text-2xs text-muted-foreground">
                          {formatRelativeTime(comment.createdAt)}
                        </span>
                      </p>

                      {comment.deleted ? (
                        <p className="mt-0.5 text-xs text-muted-foreground italic">
                          This comment was removed.
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs leading-relaxed break-words">
                          {comment.body}
                        </p>
                      )}

                      {!comment.deleted && signedIn ? (
                        <div className="mt-1 flex gap-1">
                          {comment.mine || post.mine ? (
                            <button
                              type="button"
                              onClick={() =>
                                void removeComment(comment, api, setComments)
                              }
                              className={actionClass}
                            >
                              <Trash2 className="size-3" aria-hidden />
                              Remove
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void flagComment(comment.id, api)}
                              className={actionClass}
                            >
                              <Flag className="size-3" aria-hidden />
                              Report
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

const actionClass = cn(
  "flex min-h-6 items-center gap-1 rounded px-1 text-2xs text-muted-foreground transition-colors",
  "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
);

async function removeComment(
  comment: PublicComment,
  api: ReturnType<typeof useCommunityApi>,
  setComments: React.Dispatch<React.SetStateAction<PublicComment[]>>,
) {
  try {
    await api.deleteComment(comment.id);
    // Replaced with a tombstone locally rather than removed, matching what the
    // server now returns — a hole in the thread reads as broken.
    setComments((current) =>
      current.map((entry) =>
        entry.id === comment.id ? { ...entry, deleted: true, body: "" } : entry,
      ),
    );
  } catch (cause) {
    toast.error("Could not remove that", {
      description:
        cause instanceof ApiError ? cause.message : "Please try again.",
    });
  }
}

async function flagComment(
  id: string,
  api: ReturnType<typeof useCommunityApi>,
) {
  try {
    await api.reportComment(id);
    toast.success(
      "Reported",
      "A person will review it. There is no automated moderation, so this is a queue rather than an instant removal.",
    );
  } catch (cause) {
    toast.error("Could not report that", {
      description:
        cause instanceof ApiError ? cause.message : "Please try again.",
    });
  }
}
