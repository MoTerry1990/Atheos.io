import type { Metadata } from "next";

import { ProfileView } from "@/features/community/components/profile-view";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normaliseHandle } from "@/services/community/handles";
import { env } from "@/lib/env";

/**
 * A public profile at `/u/{handle}`.
 *
 * `/u/` rather than `/@handle`: `@` is reserved for parallel routes in the App
 * Router, so `app/@[handle]` would be read as a slot rather than a page. The
 * prefix is also what makes the reserved-handle list about impersonation rather
 * than about route collisions.
 *
 * ## Real metadata, because this page is indexable
 *
 * Sprint 11 shipped a static "Profile" title, which is fine for a private page
 * and wrong for a public one — a shared link would preview as "Profile" and a
 * search result would say nothing. `generateMetadata` costs one indexed lookup
 * on a page that is cached far more often than it is rendered.
 *
 * The query is deliberately minimal: no posts, no counts, only what the tags
 * need. And it degrades to the static title rather than throwing, so a database
 * outage does not turn every profile into a 500.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;

  try {
    const profile = await prisma.user.findUnique({
      where: { handle: normaliseHandle(handle) },
      select: { handle: true, displayName: true, name: true, bio: true },
    });

    if (!profile) return { title: "Profile not found" };

    const displayName =
      profile.displayName ?? profile.name ?? profile.handle ?? handle;
    const description =
      profile.bio ?? `Work published by ${displayName} on Atheos.`;

    return {
      title: `${displayName} (@${profile.handle})`,
      description,
      alternates: {
        canonical: `${env.NEXT_PUBLIC_APP_URL}/u/${profile.handle}`,
      },
      openGraph: {
        type: "profile",
        title: `${displayName} (@${profile.handle})`,
        description,
        url: `${env.NEXT_PUBLIC_APP_URL}/u/${profile.handle}`,
      },
    };
  } catch {
    return { title: "Profile" };
  }
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const userId = await getUserId();

  return <ProfileView handle={handle} signedIn={Boolean(userId)} />;
}
