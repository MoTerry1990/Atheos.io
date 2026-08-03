import { ApiError, request } from "@/lib/http";
import type {
  GalleryOrder,
  PublicCollection,
  PublicComment,
  PublicPost,
  PublicProfile,
} from "@/services/community/types";

/**
 * The community client.
 *
 * Types come from `services/community/types` — a pure module with no `env` and
 * no `server-only`, the same split used by the billing catalogue and the
 * marketplace types. A server variable read from a client bundle is a
 * production runtime error and nothing in development.
 */

export { ApiError };
export type {
  GalleryOrder,
  PublicCollection,
  PublicComment,
  PublicPost,
  PublicProfile,
};

export interface Gallery {
  posts: PublicPost[];
  nextCursor: string | null;
}

export function loadGallery(options: {
  order?: GalleryOrder;
  handle?: string;
  following?: boolean;
  cursor?: string;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  if (options.order) params.set("order", options.order);
  if (options.handle) params.set("handle", options.handle);
  if (options.following) params.set("following", "1");
  if (options.cursor) params.set("cursor", options.cursor);

  return request<Gallery>(`/api/community/posts?${params}`, {
    signal: options.signal,
  });
}

export function loadPost(slug: string) {
  return request<{ post: PublicPost }>(`/api/community/posts/${slug}`);
}

export function actOnPost(
  slug: string,
  action: "like" | "unlike" | "unpublish",
) {
  return request<{ liked?: boolean; likeCount?: number; published?: boolean }>(
    `/api/community/posts/${slug}`,
    { method: "POST", body: JSON.stringify({ action }) },
  );
}

export function loadComments(slug: string) {
  return request<{ comments: PublicComment[] }>(
    `/api/community/posts/${slug}/comments`,
  );
}

export function addComment(slug: string, body: string) {
  return request<{ comment: PublicComment }>(
    `/api/community/posts/${slug}/comments`,
    { method: "POST", body: JSON.stringify({ body }) },
  );
}

export function deleteComment(id: string) {
  return request<{ deleted: true }>(`/api/community/comments/${id}`, {
    method: "DELETE",
  });
}

export function reportComment(id: string) {
  return request<{ reported: true }>(`/api/community/comments/${id}`, {
    method: "POST",
    body: JSON.stringify({ action: "report" }),
  });
}

export function loadProfile(handle: string) {
  return request<{ profile: PublicProfile } & Gallery>(
    `/api/community/profiles/${handle}`,
  );
}

export function setFollow(handle: string, following: boolean) {
  return request<{ following: boolean; followerCount: number }>(
    `/api/community/profiles/${handle}`,
    {
      method: "POST",
      body: JSON.stringify({ action: following ? "follow" : "unfollow" }),
    },
  );
}

export function loadMyProfile() {
  return request<{ profile: PublicProfile | null }>("/api/community/profile");
}

export function saveMyProfile(patch: {
  handle?: string;
  displayName?: string | null;
  bio?: string | null;
  website?: string | null;
}) {
  return request<{ profile: PublicProfile }>("/api/community/profile", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function loadFeaturedCreators() {
  return request<{ creators: PublicProfile[] }>("/api/community/creators");
}

export function publishAsset(input: {
  assetId: string;
  caption?: string;
  showPrompt?: boolean;
}) {
  return request<{ slug: string }>("/api/community/publish", {
    method: "POST",
    body: JSON.stringify({ kind: "asset", ...input }),
  });
}

export function shareCollection(collectionId: string, shared: boolean) {
  return request<{ shared: boolean; publicSlug: string | null }>(
    "/api/community/publish",
    {
      method: "POST",
      body: JSON.stringify({ kind: "collection", collectionId, shared }),
    },
  );
}
