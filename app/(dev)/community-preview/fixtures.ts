import { ApiError } from "@/features/community/lib/api";
import type { CommunityApi } from "@/features/community/lib/api-context";
import type {
  PublicComment,
  PublicPost,
  PublicProfile,
} from "@/services/community/types";

/**
 * An in-memory community backend.
 *
 * Community is the only surface in this product whose content comes from
 * **other people**, and there are none — no database, no users, nobody who has
 * published anything. Without fixtures there is no populated gallery, no
 * comment thread and no follower count to look at, so the interaction design
 * would ship unreviewed.
 *
 * ## The people here are obviously fictional
 *
 * Handles like `fixture-ada` and a banner on the page. This is a development
 * route; the risk being managed is not that a stranger sees it, but that
 * *we* start reading these numbers as evidence of anything. Nothing here
 * reaches the real gallery, and the real one is empty.
 *
 * ## The empty states matter more than the populated ones
 *
 * `scenario: "empty"` is the honest production state today — nothing
 * published, trending empty, no featured creators — and it is the state most
 * likely to be shipped without anyone having looked at it.
 */

export type Scenario = "populated" | "empty" | "signed-out";

const LATENCY_MS = 180;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function author(
  handle: string,
  displayName: string,
  following = false,
): PublicPost["author"] {
  return { handle, displayName, imageUrl: null, following };
}

export function createFixtureApi(
  now: number,
  scenario: Scenario,
): CommunityApi {
  // "Signed out" is populated too. Whether there is content and whether there
  // is a viewer are independent, and conflating them made the signed-out post
  // view show a 404 — hiding exactly the state it exists to demonstrate.
  const populated = scenario !== "empty";
  const signedIn = scenario !== "signed-out";

  const hour = 3_600_000;

  const posts: PublicPost[] = populated
    ? [
        {
          slug: "fx1",
          caption: "Third attempt. The mist is doing all the work.",
          prompt:
            "wide establishing shot of a coastal settlement at first light, low mist across the ground, long shadows",
          publishedAt: now - 2 * hour,
          featured: true,
          likeCount: 4,
          commentCount: 2,
          liked: false,
          mine: false,
          author: author("fixture-ada", "Ada", false),
          asset: {
            storageKey: "",
            mimeType: "image/png",
            width: 1920,
            height: 1080,
            durationMs: null,
          },
        },
        {
          slug: "fx2",
          caption: null,
          // Author withheld the prompt — the panel omits the section entirely.
          prompt: null,
          publishedAt: now - 9 * hour,
          featured: false,
          likeCount: 2,
          commentCount: 0,
          liked: true,
          mine: false,
          author: author("fixture-lin", "Lin", true),
          asset: {
            storageKey: "",
            mimeType: "image/png",
            width: 1024,
            height: 1536,
            durationMs: null,
          },
        },
        {
          slug: "fx3",
          caption: "Ten seconds, slow push in.",
          prompt: "a paper boat drifting down a rain-slicked street at night",
          publishedAt: now - 26 * hour,
          featured: false,
          likeCount: 1,
          commentCount: 1,
          liked: false,
          mine: true,
          author: author("fixture-you", "You", false),
          asset: {
            storageKey: "",
            mimeType: "video/webm",
            width: 640,
            height: 360,
            durationMs: 3870,
          },
        },
      ]
    : [];

  const comments = new Map<string, PublicComment[]>([
    [
      "fx1",
      populated
        ? [
            {
              id: "c1",
              body: "The scale read is excellent. What gave you the figure?",
              createdAt: now - 90 * 60_000,
              author: author("fixture-lin", "Lin", true),
              mine: false,
              deleted: false,
            },
            {
              id: "c2",
              body: "",
              createdAt: now - 60 * 60_000,
              author: author("fixture-removed", "Someone", false),
              mine: false,
              deleted: true,
            },
          ]
        : [],
    ],
    [
      "fx3",
      populated
        ? [
            {
              id: "c3",
              body: "The reflections hold up much better than I expected.",
              createdAt: now - 20 * hour,
              author: author("fixture-ada", "Ada", false),
              mine: false,
              deleted: false,
            },
          ]
        : [],
    ],
  ]);

  const profiles = new Map<string, PublicProfile>(
    populated
      ? [
          [
            "fixture-ada",
            {
              ...author("fixture-ada", "Ada", false),
              bio: "Concept work, mostly environments. Trying to stop over-lighting things.",
              website: "https://example.com",
              followerCount: 2,
              followingCount: 1,
              postCount: 1,
              joinedAt: now - 40 * 24 * hour,
              featured: false,
              mine: false,
            },
          ],
          [
            "fixture-you",
            {
              ...author("fixture-you", "You", false),
              bio: null,
              website: null,
              followerCount: 1,
              followingCount: 2,
              postCount: 1,
              joinedAt: now - 12 * 24 * hour,
              featured: false,
              mine: true,
            },
          ],
        ]
      : [],
  );

  let myProfile: PublicProfile | null = signedIn
    ? (profiles.get("fixture-you") ?? null)
    : null;

  function requireSignedIn() {
    if (signedIn) return;
    throw new ApiError(
      "You need to be signed in to do that.",
      401,
      "unauthenticated",
    );
  }

  return {
    async loadGallery(options) {
      let page = [...posts];

      if (options.handle) {
        page = page.filter((post) => post.author.handle === options.handle);
      }
      if (options.following) {
        // Signed out means no viewer, so nothing — a different empty state
        // from "you follow nobody", and the interface says which.
        page = signedIn ? page.filter((post) => post.author.following) : [];
      }
      if (options.order === "featured") {
        page = page.filter((post) => post.featured);
      }
      if (options.order === "trending") {
        // Last seven days, then by engagement. Same rule as the service, so
        // the preview cannot teach a ranking the server does not implement.
        page = page
          .filter((post) => post.publishedAt >= now - 7 * 24 * hour)
          .sort(
            (a, b) =>
              b.likeCount - a.likeCount || b.commentCount - a.commentCount,
          );
      }

      return delay({ posts: page, nextCursor: null });
    },

    async loadPost(slug) {
      const post = posts.find((entry) => entry.slug === slug);
      if (!post) {
        throw new ApiError("That post is not available.", 404, "not_found");
      }
      return delay({ post });
    },

    async actOnPost(slug, action) {
      requireSignedIn();
      const post = posts.find((entry) => entry.slug === slug);
      if (!post) {
        throw new ApiError("That post is not available.", 404, "not_found");
      }

      if (action === "unpublish") {
        const index = posts.indexOf(post);
        posts.splice(index, 1);
        return delay({ published: false });
      }

      const liked = action === "like";
      if (liked !== post.liked) {
        post.liked = liked;
        post.likeCount = Math.max(0, post.likeCount + (liked ? 1 : -1));
      }
      return delay({ liked: post.liked, likeCount: post.likeCount });
    },

    async loadComments(slug) {
      return delay({ comments: comments.get(slug) ?? [] });
    },

    async addComment(slug, body) {
      requireSignedIn();
      const comment: PublicComment = {
        id: `c_${Math.random().toString(36).slice(2, 8)}`,
        body,
        createdAt: Date.now(),
        author: author("fixture-you", "You", false),
        mine: true,
        deleted: false,
      };
      comments.set(slug, [...(comments.get(slug) ?? []), comment]);

      const post = posts.find((entry) => entry.slug === slug);
      if (post) post.commentCount += 1;

      return delay({ comment });
    },

    async deleteComment(id) {
      requireSignedIn();
      for (const [slug, list] of comments) {
        const target = list.find((entry) => entry.id === id);
        if (!target) continue;
        target.deleted = true;
        target.body = "";
        const post = posts.find((entry) => entry.slug === slug);
        if (post) post.commentCount = Math.max(0, post.commentCount - 1);
      }
      return delay({ deleted: true as const });
    },

    async reportComment() {
      requireSignedIn();
      return delay({ reported: true as const });
    },

    async loadProfile(handle) {
      const profile = profiles.get(handle);
      if (!profile) {
        throw new ApiError("That profile was not found.", 404, "not_found");
      }
      return delay({
        profile,
        posts: posts.filter((post) => post.author.handle === handle),
        nextCursor: null,
      });
    },

    async setFollow(handle, following) {
      requireSignedIn();
      const profile = profiles.get(handle);
      if (!profile) {
        throw new ApiError("That profile was not found.", 404, "not_found");
      }
      profile.following = following;
      profile.followerCount = Math.max(
        0,
        profile.followerCount + (following ? 1 : -1),
      );
      return delay({ following, followerCount: profile.followerCount });
    },

    async loadMyProfile() {
      requireSignedIn();
      return delay({ profile: myProfile });
    },

    async saveMyProfile(patch) {
      requireSignedIn();
      const handle = patch.handle ?? myProfile?.handle ?? "fixture-you";
      myProfile = {
        handle,
        displayName: patch.displayName ?? myProfile?.displayName ?? handle,
        imageUrl: null,
        following: false,
        bio: patch.bio ?? myProfile?.bio ?? null,
        website: patch.website ?? myProfile?.website ?? null,
        followerCount: myProfile?.followerCount ?? 0,
        followingCount: myProfile?.followingCount ?? 0,
        postCount: myProfile?.postCount ?? 0,
        joinedAt: myProfile?.joinedAt ?? now,
        featured: false,
        mine: true,
      };
      profiles.set(handle, myProfile);
      return delay({ profile: myProfile });
    },

    async loadFeaturedCreators() {
      // Empty even when populated. Featuring is editorial and nobody has been
      // featured — a fixture that invented a featured list would be teaching
      // exactly the thing the real one refuses to do.
      return delay({ creators: [] });
    },

    async publishAsset() {
      requireSignedIn();
      throw new ApiError(
        "Publishing needs the real API — this preview has no assets to publish.",
        503,
        "preview_only",
      );
    },

    async shareCollection() {
      requireSignedIn();
      throw new ApiError("Sharing needs the real API.", 503, "preview_only");
    },
  };
}
