import type { Metadata } from "next";

import { PostView } from "@/features/community/components/post-view";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

/**
 * One published post.
 *
 * ## The metadata is what makes a shared link worth sharing
 *
 * This is the page people paste into a chat, and Sprint 11 gave it the title
 * "Post". The caption becomes the title, the author is credited, and the asset
 * itself becomes the preview image.
 *
 * ## The image is only included when it is actually reachable
 *
 * `NEXT_PUBLIC_R2_PUBLIC_URL` is optional, and an `og:image` pointing at an
 * unconfigured bucket produces a broken preview card — worse than none, because
 * a missing image degrades to a text card while a broken one degrades to a grey
 * box with our domain under it.
 *
 * ## Withdrawn posts get a title that says nothing
 *
 * The `where` matches the page's own filter. An unpublished post returns "Post
 * not available" rather than leaking the caption of something taken down.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  try {
    const post = await prisma.post.findFirst({
      where: { slug, publishedAt: { not: null }, asset: { deletedAt: null } },
      select: {
        caption: true,
        user: { select: { handle: true, displayName: true, name: true } },
        asset: { select: { storageKey: true, mimeType: true } },
      },
    });

    if (!post) return { title: "Post not available" };

    const author =
      post.user.displayName ?? post.user.name ?? post.user.handle ?? "Atheos";
    const title = post.caption?.slice(0, 70) ?? `A post by ${author}`;
    const description = `Published by ${author} on Atheos.`;
    const url = `${env.NEXT_PUBLIC_APP_URL}/p/${slug}`;

    const base = env.NEXT_PUBLIC_R2_PUBLIC_URL;
    const isImage = post.asset.mimeType.startsWith("image/");
    const image =
      base && isImage
        ? `${base.replace(/\/$/, "")}/${post.asset.storageKey.replace(/^\//, "")}`
        : undefined;

    return {
      title,
      description,
      alternates: { canonical: url },
      openGraph: {
        type: "article",
        title,
        description,
        url,
        ...(image ? { images: [{ url: image }] } : {}),
      },
      twitter: {
        card: image ? "summary_large_image" : "summary",
        title,
        description,
        ...(image ? { images: [image] } : {}),
      },
    };
  } catch {
    return { title: "Post" };
  }
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const userId = await getUserId();

  return <PostView slug={slug} signedIn={Boolean(userId)} />;
}
