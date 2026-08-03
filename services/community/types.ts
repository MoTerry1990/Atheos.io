/**
 * What the community surfaces return.
 *
 * Pure types, no `server-only`, so the client can import them without dragging
 * Prisma or `env` into the browser bundle — the same split that
 * `services/billing/catalogue.ts` and `services/marketplace/types.ts` use.
 *
 * ## Author is a projection, not a user row
 *
 * A public author is a handle, a display name and an avatar. It is emphatically
 * **not** `User`: that row carries an email, a Clerk id, a credit balance and a
 * Stripe customer id, none of which belong within reach of a page anybody can
 * load. Having a separate shape means over-sharing requires writing new code
 * rather than forgetting to strip a field.
 */

export interface PublicAuthor {
  handle: string;
  displayName: string;
  imageUrl: string | null;
  /** Whether the viewer follows them. False when signed out. */
  following: boolean;
}

export interface PublicPost {
  slug: string;
  caption: string | null;
  /** Null when the author chose not to publish it. */
  prompt: string | null;
  publishedAt: number;
  featured: boolean;
  likeCount: number;
  commentCount: number;
  /** Whether the viewer has liked it. False when signed out. */
  liked: boolean;
  /** True when the viewer is the author — drives edit and take-down controls. */
  mine: boolean;
  author: PublicAuthor;
  asset: {
    storageKey: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  };
}

export interface PublicComment {
  id: string;
  body: string;
  createdAt: number;
  author: PublicAuthor;
  mine: boolean;
  /** A tombstone. The body is replaced, the row stays so replies still read. */
  deleted: boolean;
}

export interface PublicProfile extends PublicAuthor {
  bio: string | null;
  website: string | null;
  followerCount: number;
  followingCount: number;
  postCount: number;
  joinedAt: number;
  featured: boolean;
  /** True when the viewer is looking at their own profile. */
  mine: boolean;
}

export interface PublicCollection {
  slug: string;
  name: string;
  description: string | null;
  sharedAt: number;
  author: PublicAuthor;
  postCount: number;
}

export type GalleryOrder = "trending" | "recent" | "featured";
