"use client";

import { createContext, useContext, type ReactNode } from "react";

import * as api from "@/features/community/lib/api";

/**
 * The community client, injectable.
 *
 * Fourth use of this pattern — projects, billing, marketplace, now community —
 * and the one where it matters most for a reason the others did not have:
 * community is the only surface whose content comes from *other people*, and
 * there are none. Fixtures are the only way to see a populated gallery, a
 * comment thread or a follower count at all.
 *
 * The default is the real module, so nothing changes in production.
 */

export interface CommunityApi {
  loadGallery: typeof api.loadGallery;
  loadPost: typeof api.loadPost;
  actOnPost: typeof api.actOnPost;
  loadComments: typeof api.loadComments;
  addComment: typeof api.addComment;
  deleteComment: typeof api.deleteComment;
  reportComment: typeof api.reportComment;
  loadProfile: typeof api.loadProfile;
  setFollow: typeof api.setFollow;
  loadMyProfile: typeof api.loadMyProfile;
  saveMyProfile: typeof api.saveMyProfile;
  loadFeaturedCreators: typeof api.loadFeaturedCreators;
  publishAsset: typeof api.publishAsset;
  shareCollection: typeof api.shareCollection;
}

const REAL: CommunityApi = {
  loadGallery: api.loadGallery,
  loadPost: api.loadPost,
  actOnPost: api.actOnPost,
  loadComments: api.loadComments,
  addComment: api.addComment,
  deleteComment: api.deleteComment,
  reportComment: api.reportComment,
  loadProfile: api.loadProfile,
  setFollow: api.setFollow,
  loadMyProfile: api.loadMyProfile,
  saveMyProfile: api.saveMyProfile,
  loadFeaturedCreators: api.loadFeaturedCreators,
  publishAsset: api.publishAsset,
  shareCollection: api.shareCollection,
};

const CommunityApiContext = createContext<CommunityApi>(REAL);

export function useCommunityApi(): CommunityApi {
  return useContext(CommunityApiContext);
}

export function CommunityApiProvider({
  value,
  children,
}: {
  value: CommunityApi;
  children: ReactNode;
}) {
  return (
    <CommunityApiContext.Provider value={value}>
      {children}
    </CommunityApiContext.Provider>
  );
}
